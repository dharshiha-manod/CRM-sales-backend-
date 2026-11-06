// Vehicle only: the document checklist of a Delivery / PDI file (Invoice, ID proof, Form 20 ...).
// Documentation turns Complete by itself when every document is Received (or Not Applicable).
import { supabaseAdmin } from './supabase.js';
import { todayLocal } from './ist-date.js';

type Row = Record<string, unknown>;
export type DocStatus = 'Pending' | 'Received' | 'Not Applicable';
export type DeliveryDoc = { name: string; status: DocStatus; received_date: string | null; remarks: string | null; file_path?: string | null; file_name?: string | null; uploaded_at?: string | null };
/** Private bucket (ID proofs are sensitive): files are only reachable through short-lived signed links made by the API. */
export const DOCUMENT_BUCKET = 'vehicle-documents';
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };

let bucketReady = false;
export async function ensureDocumentBucket(): Promise<void> {
  if (bucketReady) return;
  const { error } = await supabaseAdmin.storage.createBucket(DOCUMENT_BUCKET, { public: false, fileSizeLimit: MAX_DOCUMENT_BYTES, allowedMimeTypes: Object.keys(ALLOWED_DOCUMENT_TYPES) });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  bucketReady = true;
}
export const DOC_STATUSES: DocStatus[] = ['Pending', 'Received', 'Not Applicable'];

const doc = (name: string): DeliveryDoc => ({ name, status: 'Pending', received_date: null, remarks: null, file_path: null, file_name: null, uploaded_at: null });

/** Complete only when there is at least one document and none is still Pending. */
export const documentsComplete = (list: DeliveryDoc[]) => list.length > 0 && list.every((d) => d.status !== 'Pending');
export const pendingDocumentNames = (list: DeliveryDoc[]) => list.filter((d) => d.status === 'Pending').map((d) => d.name);

const ORGANISATION_WORDS = ['corporate', 'company', 'business', 'enterprise', 'fleet', 'government', 'govt'];
const isOrganisation = (clientType: unknown) => { const t = String(clientType ?? '').toLowerCase(); return ORGANISATION_WORDS.some((w) => t.includes(w)); };

/** Common Indian showroom documents. A company buyer gives company papers instead of personal ID; finance / insurance add their own. */
export function defaultChecklist(opts: { organisation: boolean; finance: boolean; insurance: boolean }): DeliveryDoc[] {
  const names = ['Tax invoice', 'Signed booking / sales order form'];
  if (opts.organisation) names.push('GST certificate', 'Company PAN card', 'Company address proof', 'Authorisation letter for the signatory');
  else names.push('Customer ID proof', 'Address proof', 'PAN card or Form 60', 'Passport size photographs');
  names.push('Form 20 (registration application)', 'Form 21 (sale certificate)', 'Form 22 (roadworthiness certificate)');
  if (opts.insurance) names.push('Insurance cover note / policy');
  if (opts.finance) names.push('Loan sanction letter', 'Hypothecation form (Form 34)', 'Bank delivery order');
  names.push('Delivery challan / gate pass');
  return names.map(doc);
}

/** Checklist for a delivery file: customer type decides the papers, the booking decides finance / insurance. Never throws. */
export async function defaultChecklistFor(org: string, ind: string, d: Row): Promise<DeliveryDoc[]> {
  try {
    let clientType: unknown = null;
    if (d.client_id) {
      const { data } = await supabaseAdmin.from('clients').select('client_type').eq('organization_id', org).eq('id', String(d.client_id)).maybeSingle();
      clientType = (data as Row | null)?.client_type;
    }
    let finance = d.finance_required; let insurance = d.insurance_required;
    if ((finance === undefined || insurance === undefined) && d.booking_number) {
      const { data } = await supabaseAdmin.from('vehicle_bookings').select('finance_required, insurance_required').eq('organization_id', org).eq('industry_type_id', ind).eq('booking_number', String(d.booking_number)).maybeSingle();
      finance = (data as Row | null)?.finance_required; insurance = (data as Row | null)?.insurance_required;
    }
    const yes = (v: unknown) => ['yes', 'true', 'y'].includes(String(v ?? '').trim().toLowerCase());
    const insuranceNotNeeded = insurance !== undefined && insurance !== null && !yes(insurance); // same rule as the delivery file's insurance status
    return defaultChecklist({ organisation: isOrganisation(clientType), finance: yes(finance), insurance: !insuranceNotNeeded });
  } catch {
    return defaultChecklist({ organisation: false, finance: false, insurance: true });
  }
}

/** Checks what the screen sends. Received gets a date (today when blank); other statuses clear it. */
export function normalizeChecklist(input: unknown, filePrefix = ''): { ok: true; docs: DeliveryDoc[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: 'documents must be a list.' };
  if (input.length > 40) return { ok: false, message: 'A delivery file can have at most 40 documents.' };
  const seen = new Set<string>();
  const docs: DeliveryDoc[] = [];
  for (const raw of input as Row[]) {
    const name = String(raw?.name ?? '').trim();
    if (!name) return { ok: false, message: 'Every document needs a name.' };
    if (name.length > 80) return { ok: false, message: `Document name "${name.slice(0, 20)}..." is too long (max 80 characters).` };
    if (seen.has(name.toLowerCase())) return { ok: false, message: `"${name}" is listed twice.` };
    seen.add(name.toLowerCase());
    let status = String(raw.status ?? 'Pending') as DocStatus;
    if (!DOC_STATUSES.includes(status)) return { ok: false, message: `"${name}": status must be Pending, Received or Not Applicable.` };
    // an attached file is only accepted from this delivery's own folder; a file means the paper is Received
    const rawPath = typeof raw.file_path === 'string' ? raw.file_path : '';
    const file_path = filePrefix && rawPath.startsWith(filePrefix) && !rawPath.includes('..') && rawPath.length <= 300 ? rawPath : null;
    if (file_path && status === 'Pending') status = 'Received';
    const given = String(raw.received_date ?? '').slice(0, 10);
    const received_date = status === 'Received' ? (/^\d{4}-\d{2}-\d{2}$/.test(given) ? given : todayLocal()) : null;
    const remarks = String(raw.remarks ?? '').trim().slice(0, 200) || null;
    const file_name = file_path ? String(raw.file_name ?? '').trim().slice(0, 120) || null : null;
    const uploaded_at = file_path && typeof raw.uploaded_at === 'string' && !Number.isNaN(Date.parse(raw.uploaded_at)) ? raw.uploaded_at : null;
    docs.push({ name, status, received_date, remarks, file_path, file_name, uploaded_at });
  }
  return { ok: true, docs };
}