/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile GST sales invoices: company & GST profile, invoices per sales order, transport / LR details, e-way bill and e-invoice JSON.
// Own tables (textile_company_profile, textile_invoices). Nothing here touches other industries.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { assertRecordInScope, resolveIndustryTypeId } from '../lib/industry-scope.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { createTextileInvoice } from '../lib/textile-invoicing.js';
import { buildEWayBill, buildTextileEInvoice } from '../lib/textile-eway.js';
import { isGstin } from '../lib/textile-invoice-math.js';

export const textileInvoiceRouter = Router();
const manager = requireRoles('super_admin', 'admin', 'sales_manager');
type Req = Parameters<RequestHandler>[0];
type Row = Record<string, any>;

const org = (req: Req) => {
  const v = req.header('x-organization-id');
  if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return v;
};
const idOf = (req: Req) => {
  const v = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!v) throw new AppError(400, 'INVALID_ID', 'A record id is required.');
  return v;
};
const scoped = (req: Req, v: unknown) => {
  const it = resolveIndustryTypeId(req.industryScope!, typeof v === 'string' && v ? v : null);
  if (!it) throw new AppError(400, 'VALIDATION_ERROR', 'industryTypeId is required.');
  return it;
};
const actorOf = (req: Req) => ((req as unknown as { auth?: { sub?: string } }).auth?.sub as string | undefined) ?? null;
const notFound = () => new AppError(404, 'RECORD_NOT_FOUND', 'Invoice was not found.');
const blank = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);

// ------------------------------------------------------------------ company & GST profile
const profileSchema = z.object({
  industryTypeId: z.string().uuid().optional(),
  company_name: z.string().trim().min(1, 'Company name is required.').max(200),
  gstin: z.string().trim().toUpperCase().optional().nullable().or(z.literal('')),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN format is invalid (e.g. AABCM1234F).').optional().nullable().or(z.literal('')),
  address: z.string().trim().max(300).optional().nullable(), city: z.string().trim().max(100).optional().nullable(), state: z.string().trim().max(100).optional().nullable(),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits.').optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(), email: z.string().trim().email('Email address is not valid.').optional().nullable().or(z.literal('')),
  invoice_prefix: z.string().trim().regex(/^[A-Za-z0-9/-]{1,10}$/, 'Invoice prefix can use letters, digits, - and / (max 10).').optional().nullable().or(z.literal('')),
  bank_name: z.string().trim().max(100).optional().nullable(), bank_account: z.string().trim().max(40).optional().nullable(), bank_ifsc: z.string().trim().max(20).optional().nullable(),
  terms: z.string().trim().max(1000).optional().nullable(),
});

textileInvoiceRouter.get('/textile/company-profile', authenticate, manager, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('textile_company_profile').select('*').eq('organization_id', org(req)).eq('industry_type_id', scoped(req, req.query.industryTypeId)).maybeSingle();
  if (error) throw error;
  res.json({ data });
});

textileInvoiceRouter.put('/textile/company-profile', authenticate, manager, async (req, res) => {
  const input = profileSchema.parse(req.body ?? {});
  const it = scoped(req, input.industryTypeId);
  if (input.gstin && !isGstin(input.gstin)) throw new AppError(400, 'VALIDATION_ERROR', 'GSTIN format is invalid (15 characters, e.g. 33AABCM1234F1Z4).');
  const { industryTypeId: _ignored, ...rest } = input; void _ignored;
  const row: Row = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, blank(v)]));
  row.invoice_prefix = row.invoice_prefix ?? 'INV';
  const { data, error } = await supabaseAdmin.from('textile_company_profile')
    .upsert({ ...row, organization_id: org(req), industry_type_id: it, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,industry_type_id' }).select().single();
  if (error) throw error;
  res.json({ data });
});

// ------------------------------------------------------------------ invoices
textileInvoiceRouter.get('/textile/invoices', authenticate, manager, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('textile_invoices').select('*, clients(client_name, client_code), sale_orders(order_number)')
    .eq('organization_id', org(req)).eq('industry_type_id', scoped(req, req.query.industryTypeId)).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  res.json({ data });
});

// Confirmed orders that have no live invoice yet: the work list for "Create invoice".
textileInvoiceRouter.get('/textile/invoices/pending-orders', authenticate, manager, async (req, res) => {
  const orgId = org(req); const it = scoped(req, req.query.industryTypeId);
  const { data: orders, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, status, total_amount, created_at, textile_delivery_status, clients!inner(client_name, industry_type_id)')
    .eq('organization_id', orgId).eq('status', 'confirmed').eq('clients.industry_type_id', it).order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  const list = (orders ?? []) as Row[];
  const { data: live } = list.length
    ? await supabaseAdmin.from('textile_invoices').select('order_id').eq('organization_id', orgId).neq('status', 'Cancelled').in('order_id', list.map((o) => o.id))
    : { data: [] };
  const invoiced = new Set(((live ?? []) as Row[]).map((r) => r.order_id));
  res.json({ data: list.filter((o) => !invoiced.has(o.id)).map((o) => ({ ...o, client_name: (Array.isArray(o.clients) ? o.clients[0] : o.clients)?.client_name ?? null, clients: undefined })) });
});

textileInvoiceRouter.post('/textile/invoices', authenticate, manager, async (req, res) => {
  const body = z.object({ orderId: z.string().uuid(), industryTypeId: z.string().uuid().optional() }).parse(req.body ?? {});
  const data = await createTextileInvoice(org(req), scoped(req, body.industryTypeId), body.orderId, actorOf(req));
  res.status(201).json({ data });
});

const transportSchema = z.object({
  transporter_name: z.string().trim().max(150).optional().nullable().or(z.literal('')),
  transporter_gstin: z.string().trim().toUpperCase().optional().nullable().or(z.literal('')),
  vehicle_number: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{0,3}[-\s]?\d{4}$/, 'Vehicle number looks wrong (e.g. TN 75 AB 1234).').optional().nullable().or(z.literal('')),
  lr_number: z.string().trim().max(40).optional().nullable().or(z.literal('')),
  lr_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'LR date is not valid.').optional().nullable().or(z.literal('')),
  bales: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  transport_mode: z.enum(['Road', 'Rail', 'Air', 'Ship']).optional(),
  transport_distance_km: z.coerce.number().int().min(0).max(4000).optional().nullable(),
});

textileInvoiceRouter.patch('/textile/invoices/:id', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const { data: ex, error } = await supabaseAdmin.from('textile_invoices').select('*').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!ex) throw notFound();
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound());
  if ((ex as Row).status !== 'Issued') throw new AppError(422, 'INVOICE_CANCELLED', 'A cancelled invoice cannot be changed.');
  const input = transportSchema.parse(req.body ?? {});
  if (input.transporter_gstin && !isGstin(input.transporter_gstin)) throw new AppError(400, 'VALIDATION_ERROR', 'Transporter GSTIN is not valid.');
  const patch: Row = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, blank(v)]));
  if (typeof patch.vehicle_number === 'string') patch.vehicle_number = patch.vehicle_number.replace(/[\s-]/g, '');
  if (!Object.keys(patch).length) throw new AppError(400, 'VALIDATION_ERROR', 'Nothing to change.');
  const { data, error: e2 } = await supabaseAdmin.from('textile_invoices').update(patch).eq('organization_id', orgId).eq('id', idOf(req)).select().single();
  if (e2) throw e2;
  res.json({ data });
});

textileInvoiceRouter.post('/textile/invoices/:id/cancel', authenticate, manager, async (req, res) => {
  const orgId = org(req);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) throw new AppError(400, 'VALIDATION_ERROR', 'A reason is required to cancel an invoice.');
  const { data: ex } = await supabaseAdmin.from('textile_invoices').select('industry_type_id').eq('organization_id', orgId).eq('id', idOf(req)).maybeSingle();
  if (!ex) throw notFound();
  assertRecordInScope(req.industryScope!, (ex as Row).industry_type_id, notFound());
  // Claim the cancel: only one request can move Issued -> Cancelled.
  const { data, error } = await supabaseAdmin.from('textile_invoices').update({ status: 'Cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
    .eq('organization_id', orgId).eq('id', idOf(req)).eq('status', 'Issued').select().maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError(409, 'INVOICE_CHANGED', 'This invoice was just changed or is already cancelled. Refresh and try again.');
  res.json({ data });
});

async function loadForExport(req: Req) {
  const { data: inv, error } = await supabaseAdmin.from('textile_invoices').select('*, clients(*)').eq('organization_id', org(req)).eq('id', idOf(req)).maybeSingle();
  if (error) throw error;
  if (!inv) throw notFound();
  assertRecordInScope(req.industryScope!, (inv as Row).industry_type_id, notFound());
  if ((inv as Row).status !== 'Issued') throw new AppError(422, 'INVOICE_CANCELLED', 'A cancelled invoice has no e-way bill or e-invoice.');
  const client = (Array.isArray((inv as Row).clients) ? (inv as Row).clients[0] : (inv as Row).clients) ?? {};
  return { inv: inv as Row, company: ((inv as Row).company ?? {}) as Row, client: client as Row };
}
textileInvoiceRouter.get('/textile/invoices/:id/eway-json', authenticate, manager, async (req, res) => {
  const { inv, company, client } = await loadForExport(req);
  res.json({ data: buildEWayBill(inv, company, client) });
});
textileInvoiceRouter.get('/textile/invoices/:id/einvoice-json', authenticate, manager, async (req, res) => {
  const { inv, company, client } = await loadForExport(req);
  res.json({ data: buildTextileEInvoice(inv, company, client) });
});
