// Vehicle only: delivery document checklist ticks itself when the system already holds the paper.
//  - "Insurance cover note / policy"  -> Received when an Active / Expiring Soon policy exists for the VIN (Insurance module)
//  - "Loan sanction letter"           -> Received when the finance application is Approved or Disbursed (Finance / Loan module)
// Only Pending -> Received is automatic. A document the user set to Not Applicable / Received by hand is never changed.
// Never throws: a failure here must not break the main save (errors are logged).
import { supabaseAdmin } from './supabase.js';
import { todayLocal } from './ist-date.js';
import { logger } from './logger.js';
import { stageFor } from './vehicle-calc.js';
import { documentsComplete, type DeliveryDoc } from './vehicle-documents.js';
import { enqueueCustomerMessage } from './vehicle-notify.js';

type Row = Record<string, unknown>;
const has = (v: unknown) => v !== null && v !== undefined && v !== '';
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const OPEN_DELIVERY = ['Preparation', 'PDI Pending', 'Documentation Pending', 'Payment Pending', 'Ready for Delivery'];
export const INSURANCE_DOC = 'Insurance cover note / policy';
export const LOAN_DOC = 'Loan sanction letter';
export const TAX_INVOICE_DOC = 'Tax invoice';

export interface DocFacts { insurancePolicy: string | null; loanApplication: string | null; taxInvoice?: string | null }

/** Pure: returns the checklist with the known papers ticked. `changed` is false when nothing needed ticking. */
export function autoTickChecklist(docs: DeliveryDoc[], facts: DocFacts, today: string): { docs: DeliveryDoc[]; changed: boolean } {
  let changed = false;
  const tick = (d: DeliveryDoc, ref: string): DeliveryDoc => {
    changed = true;
    return { ...d, status: 'Received', received_date: today, remarks: d.remarks ?? `Auto: ${ref}` };
  };
  const out = docs.map((d) => {
    if (d.status !== 'Pending') return d;
    if (d.name === INSURANCE_DOC && facts.insurancePolicy) return tick(d, `policy ${facts.insurancePolicy}`);
    if (d.name === LOAN_DOC && facts.loanApplication) return tick(d, `loan ${facts.loanApplication}`);
    if (d.name === TAX_INVOICE_DOC && facts.taxInvoice) return tick(d, `invoice ${facts.taxInvoice}`);
    return d;
  });
  return { docs: out, changed };
}

/** After an insurance policy / finance application is saved (or a delivery file is opened): tick what is known on the open delivery of that VIN. */
export async function syncDeliveryDocuments(org: string, ind: string, vin: unknown): Promise<void> {
  if (!has(vin)) return;
  try {
    const v = String(vin);
    const { data: deliveries, error } = await supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', v).in('status', OPEN_DELIVERY);
    if (error) throw error;
    const open = ((deliveries ?? []) as Row[]).filter((d) => Array.isArray(d.document_checklist) && (d.document_checklist as unknown[]).length > 0);
    if (!open.length) return;

      const [pol, fin, inv] = await Promise.all([   
      supabaseAdmin.from('vehicle_insurance_policies').select('policy_number').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', v).in('status', ['Cover Note Issued', 'Active', 'Expiring Soon']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabaseAdmin.from('vehicle_finance_applications').select('application_number').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', v).in('status', ['Approved', 'Disbursed']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('vehicle_invoices').select('invoice_number').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', v).in('status', ['Issued', 'Paid']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const facts: DocFacts = {
      insurancePolicy: has((pol.data as Row | null)?.policy_number) ? str((pol.data as Row).policy_number) : null,
      loanApplication: has((fin.data as Row | null)?.application_number) ? str((fin.data as Row).application_number) : null,
      taxInvoice: has((inv.data as Row | null)?.invoice_number) ? str((inv.data as Row).invoice_number) : null,
    };
    if (!facts.insurancePolicy && !facts.loanApplication && !facts.taxInvoice) return;

    for (const d of open) {
      const res = autoTickChecklist(d.document_checklist as DeliveryDoc[], facts, todayLocal());
      if (!res.changed) continue;
      const merged = { ...d, document_checklist: res.docs, documentation_status: documentsComplete(res.docs) ? 'Complete' : 'Pending' };
      const status = stageFor(merged);
      const { error: upErr } = await supabaseAdmin.from('vehicle_deliveries').update({ document_checklist: res.docs, documentation_status: merged.documentation_status, status }).eq('id', d.id as string);
      if (upErr) throw upErr;
      await syncRegistrationPapers(org, ind, d.vin, res.docs);
      if (status === 'Ready for Delivery') {
        await enqueueCustomerMessage(org, ind, { key: `dlv:${String(d.id)}:ready`, kind: 'delivery_ready', clientId: d.client_id, subject: 'Your vehicle is ready for delivery', body: `Dear ${str(d.client_name) || 'Customer'}, your vehicle ${str(d.vin)} is ready for delivery. Please contact us to confirm the handover time.` });
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'vehicle-doc-sync: could not tick delivery documents');
  }
}

const yes = (v: unknown) => ['yes', 'true', 'y'].includes(String(v ?? '').trim().toLowerCase());
const AUTO_PAPERS = 'Pending papers: ';

/** The registration file's "Required documents" lists the papers still pending on the delivery checklist. Only a blank / auto-written value is replaced, never one typed by hand. */
export async function syncRegistrationPapers(org: string, ind: string, vin: unknown, checklist: unknown): Promise<void> {
  if (!has(vin) || !Array.isArray(checklist) || !checklist.length) return;
  try {
    const pending = (checklist as DeliveryDoc[]).filter((d) => d.status === 'Pending').map((d) => d.name);
    const { data } = await supabaseAdmin.from('vehicle_registrations').select('id, required_documents, status').eq('organization_id', org).eq('industry_type_id', ind).eq('vin', String(vin)).maybeSingle();
    const reg = data as Row | null;
    if (!reg || reg.status === 'Completed') return;
    const current = str(reg.required_documents);
    if (current && !current.startsWith(AUTO_PAPERS)) return;
    const next = pending.length ? `${AUTO_PAPERS}${pending.join(', ')}` : null;
    if ((next ?? '') !== current) await supabaseAdmin.from('vehicle_registrations').update({ required_documents: next }).eq('id', reg.id as string);
  } catch (error) { logger.error({ err: error }, 'vehicle-doc-sync: could not update the registration papers'); }
}

/** Finance / insurance switched on for a booking AFTER its delivery file was opened: the loan / insurance papers are added to the open checklist (nothing is ever removed). */
export async function addBookingDocuments(org: string, ind: string, booking: Row): Promise<void> {
  if (!has(booking.booking_number)) return;
  try {
    const { data } = await supabaseAdmin.from('vehicle_deliveries').select('*').eq('organization_id', org).eq('industry_type_id', ind).eq('booking_number', String(booking.booking_number)).in('status', OPEN_DELIVERY).limit(1).maybeSingle();
    const d = data as Row | null;
    if (!d || !Array.isArray(d.document_checklist) || !(d.document_checklist as unknown[]).length) return;
    const list = d.document_checklist as DeliveryDoc[];
    const wanted: string[] = [];
    if (yes(booking.finance_required)) wanted.push(LOAN_DOC, 'Hypothecation form (Form 34)', 'Bank delivery order');
    if (yes(booking.insurance_required)) wanted.push(INSURANCE_DOC);
    const have = new Set(list.map((x) => x.name.toLowerCase()));
    const add = wanted.filter((n) => !have.has(n.toLowerCase())).map((name): DeliveryDoc => ({ name, status: 'Pending', received_date: null, remarks: null, file_path: null, file_name: null, uploaded_at: null }));
    const patch: Row = {};
    if (yes(booking.insurance_required) && d.insurance_status === 'Not Applicable') patch.insurance_status = 'Pending';
    let docs = list;
    if (add.length) { docs = [...list, ...add]; patch.document_checklist = docs; }
    if (!Object.keys(patch).length) return;
    const merged = { ...d, ...patch, document_checklist: docs, documentation_status: documentsComplete(docs) ? 'Complete' : 'Pending' };
    patch.documentation_status = merged.documentation_status;
    patch.status = stageFor(merged);
    const { error } = await supabaseAdmin.from('vehicle_deliveries').update(patch).eq('id', d.id as string);
    if (error) throw error;
    await syncDeliveryDocuments(org, ind, d.vin); // a policy / loan already on file ticks the new paper at once
    await syncRegistrationPapers(org, ind, d.vin, docs);
  } catch (error) { logger.error({ err: error }, 'vehicle-doc-sync: could not add booking documents'); }
}