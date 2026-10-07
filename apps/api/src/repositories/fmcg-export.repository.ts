// Export details (incoterm, ports, document checklist) - FMCG orders of International clients only.
import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, type IndustryScope } from '../lib/industry-scope.js';
import { isFmcgIndustry, marketScopeOf } from '../lib/fmcg-market.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export const EXPORT_DOC_KEYS = ['commercial_invoice', 'packing_list', 'bill_of_lading', 'certificate_of_origin', 'health_certificate', 'shipping_bill', 'insurance_certificate'] as const;

type Input = { incoterm?: unknown; portOfLoading?: unknown; portOfDischarge?: unknown; exportDocs?: unknown };
const text = (v: unknown, label: string) => { if (v == null || v === '') return null; const t = String(v).trim().replace(/\u0000/g, ''); if (t.length > 160) throw new AppError(422, 'INVALID_EXPORT_DETAILS', `${label} is too long.`); return t; };

export async function updateExportDetails(org: string, scope: IndustryScope, id: string, input: Input) {
  const { data: order, error } = await supabaseAdmin.from('sale_orders').select('id, export_docs, clients!inner(industry_type_id, country_code)').eq('id', id).eq('organization_id', org).maybeSingle();
  if (error) throw new AppError(500, 'EXPORT_LOOKUP_FAILED', error.message, error);
  const notFound = new AppError(404, 'ORDER_NOT_FOUND', 'Sales order not found.');
  if (!order) throw notFound;
  const client = order.clients as unknown as { industry_type_id?: string | null; country_code?: string | null };
  assertRecordInScope(scope, client?.industry_type_id, notFound);
  if (!(await isFmcgIndustry(org, client?.industry_type_id)) || marketScopeOf(client?.country_code) !== 'international') {
    throw new AppError(422, 'NOT_INTERNATIONAL', 'Export details apply only to FMCG orders of international clients.');
  }
  const update: Record<string, unknown> = {};
  if (input.incoterm !== undefined) {
    const code = input.incoterm ? String(input.incoterm).toUpperCase() : null;
    if (code && !(INCOTERMS as readonly string[]).includes(code)) throw new AppError(422, 'INVALID_INCOTERM', `Incoterm must be one of: ${INCOTERMS.join(', ')}.`);
    update.incoterm = code;
  }
  if (input.portOfLoading !== undefined) update.port_of_loading = text(input.portOfLoading, 'Port of loading');
  if (input.portOfDischarge !== undefined) update.port_of_discharge = text(input.portOfDischarge, 'Port of discharge');
  if (input.exportDocs !== undefined) {
    const incoming = (input.exportDocs && typeof input.exportDocs === 'object' ? input.exportDocs : {}) as Record<string, unknown>;
    const docs: Record<string, boolean> = { ...((order.export_docs as Record<string, boolean> | null) ?? {}) };
    for (const key of EXPORT_DOC_KEYS) if (key in incoming) docs[key] = incoming[key] === true;
    update.export_docs = docs;
  }
  if (Object.keys(update).length === 0) throw new AppError(422, 'NOTHING_TO_UPDATE', 'Provide export details to save.');
  const { data, error: updateError } = await supabaseAdmin.from('sale_orders').update(update).eq('id', id).eq('organization_id', org).select('id, incoterm, port_of_loading, port_of_discharge, export_docs').single();
  if (updateError) throw new AppError(500, 'EXPORT_SAVE_FAILED', updateError.message, updateError);
  return data;
}