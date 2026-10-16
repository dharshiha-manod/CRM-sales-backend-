// FMCG Distributor Management. Distributors are clients with outlet_type "Distributor" in the FMCG industry.
// Stock at the distributor = primary received (goods in dispatched / delivered shipments) - returns/damage (approved) - secondary sales - adjustments.
// An order that is only confirmed or packed has not reached the distributor yet, so it is NOT counted as stock.
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getClientCredit } from '../lib/credit.js';
import { orderBase } from '../lib/fmcg-market.js';

const fail = (code: string, e: { message: string }): never => { throw new AppError(500, code, e.message); };
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);
const NOT_RECEIVED = '(cancelled,rejected,pending_approval)';

function chunk<T>(items: T[], size = 100): T[][] { const out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
async function inBatches<T>(ids: string[], run: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, code: string): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunk(ids)) { const { data, error } = await run(part); if (error) fail(code, error); rows.push(...(data ?? [])); }
  return rows;
}

export const profileSchema = z.object({
  tier: z.enum(['super_stockist', 'distributor', 'sub_distributor']).default('distributor'),
  territory: z.string().trim().max(160).nullable().optional(),
  monthlyTarget: z.number().finite().nonnegative().max(1e10).nullable().optional(),
  marginPercent: z.number().finite().min(0).max(100).nullable().optional(),
  securityDeposit: z.number().finite().nonnegative().max(1e10).nullable().optional(),
  agreementStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  agreementEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  coverDays: z.number().int().min(1).max(365).default(30),
  notes: z.string().trim().max(1000).nullable().optional(),
}).refine((v) => !v.agreementStart || !v.agreementEnd || v.agreementEnd >= v.agreementStart, { message: 'Agreement end cannot be before its start.', path: ['agreementEnd'] });
export type ProfileInput = z.infer<typeof profileSchema>;

export const entrySchema = z.object({
  productId: z.string().uuid(),
  entryType: z.enum(['secondary_sale', 'adjustment']).default('secondary_sale'),
  quantity: z.number().finite().positive().max(1e7),
  amount: z.number().finite().nonnegative().max(1e10).nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outletName: z.string().trim().max(160).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
});
export type EntryInput = z.infer<typeof entrySchema>;

type ClientRow = { id: string; client_code: string; client_name: string; status: string; city: string | null; state: string | null; credit_limit: number | null; credit_days: number | null };
type Position = { productId: string; primary: number; returned: number; secondary: number; adjusted: number; onHand: number; secondaryLast30: number };

async function distributorClients(org: string, industryTypeId: string, onlyId?: string): Promise<ClientRow[]> {
  let q = supabaseAdmin.from('clients').select('id, client_code, client_name, status, city, state, credit_limit, credit_days').eq('organization_id', org).eq('industry_type_id', industryTypeId).ilike('outlet_type', 'distributor').order('client_name');
  if (onlyId) q = q.eq('id', onlyId);
  const { data, error } = await q;
  if (error) fail('DISTRIBUTORS_LIST_FAILED', error);
  return (data ?? []) as ClientRow[];
}

type Raw = {
  shipped: Array<{ client_id: string; product_id: string; quantity: number }>;
  orders: Array<{ id: string; order_number: string; client_id: string; status: string; dispatch_status: string | null; total_amount: number; base_total: number | null; created_at: string; sale_order_items: Array<{ product_id: string | null; quantity: number; free_quantity: number | null }> | null }>;
  returns: Array<{ client_id: string; product_id: string; quantity: number }>;
  entries: Array<{ id: string; client_id: string; product_id: string; entry_type: string; quantity: number; amount: number; entry_date: string; outlet_name: string | null; reason: string | null; created_at: string }>;
  profiles: Array<Record<string, unknown> & { client_id: string }>;
};
async function loadRaw(org: string, industryTypeId: string, ids: string[]): Promise<Raw> {
  const [orders, shipments, returns, entries, profiles] = await Promise.all([
    inBatches<Raw['orders'][number]>(ids, (p) => supabaseAdmin.from('sale_orders').select('id, order_number, client_id, status, dispatch_status, total_amount, base_total, created_at, sale_order_items(product_id, quantity, free_quantity)').eq('organization_id', org).in('client_id', p).not('status', 'in', NOT_RECEIVED), 'DISTRIBUTOR_ORDERS_FAILED'),
    // Goods that have actually left for the distributor: dispatched or delivered shipments only.
    inBatches<{ fmcg_shipment_items: Array<{ order_item_id: string; quantity: number }> | null; sale_orders: { client_id: string; sale_order_items: Array<{ id: string; product_id: string | null }> | null } }>(ids, (p) => supabaseAdmin.from('fmcg_shipments').select('fmcg_shipment_items(order_item_id, quantity), sale_orders!inner(client_id, sale_order_items(id, product_id))').eq('organization_id', org).in('status', ['dispatched', 'delivered']).in('sale_orders.client_id', p), 'DISTRIBUTOR_SHIPMENTS_FAILED'),
    // Before the returns table exists this is simply empty.
    inBatches<Raw['returns'][number]>(ids, (p) => supabaseAdmin.from('sales_returns').select('client_id, product_id, quantity').eq('organization_id', org).eq('status', 'approved').in('client_id', p), 'DISTRIBUTOR_RETURNS_FAILED').catch(() => []),
    inBatches<Raw['entries'][number]>(ids, (p) => supabaseAdmin.from('fmcg_secondary_sales').select('id, client_id, product_id, entry_type, quantity, amount, entry_date, outlet_name, reason, created_at').eq('organization_id', org).eq('industry_type_id', industryTypeId).in('client_id', p).order('entry_date', { ascending: false }), 'DISTRIBUTOR_ENTRIES_FAILED'),
    inBatches<Raw['profiles'][number]>(ids, (p) => supabaseAdmin.from('fmcg_distributor_profiles').select('*').eq('organization_id', org).in('client_id', p), 'DISTRIBUTOR_PROFILES_FAILED'),
  ]);
  const shipped: Raw['shipped'] = [];
  for (const sh of shipments) {
    const productOf = new Map((sh.sale_orders.sale_order_items ?? []).map((i) => [i.id, i.product_id]));
    for (const it of sh.fmcg_shipment_items ?? []) { const productId = productOf.get(it.order_item_id); if (productId) shipped.push({ client_id: sh.sale_orders.client_id, product_id: productId, quantity: num(it.quantity) }); }
  }
  return { orders, shipped, returns, entries, profiles };
}

function positionsFor(clientId: string, raw: Raw): Map<string, Position> {
  const map = new Map<string, Position>();
  const get = (productId: string) => { let p = map.get(productId); if (!p) { p = { productId, primary: 0, returned: 0, secondary: 0, adjusted: 0, onHand: 0, secondaryLast30: 0 }; map.set(productId, p); } return p; };
  for (const sh of raw.shipped) if (sh.client_id === clientId) get(sh.product_id).primary += sh.quantity;
  for (const r of raw.returns) if (r.client_id === clientId) get(r.product_id).returned += num(r.quantity);
  const cutoff = addDays(today(), -30);
  for (const e of raw.entries) if (e.client_id === clientId) {
    const p = get(e.product_id);
    if (e.entry_type === 'adjustment') p.adjusted += num(e.quantity);
    else { p.secondary += num(e.quantity); if (e.entry_date >= cutoff) p.secondaryLast30 += num(e.quantity); }
  }
  for (const p of map.values()) p.onHand = r2(p.primary - p.returned - p.secondary - p.adjusted);
  return map;
}

async function productInfo(org: string, ids: string[]) {
  const rows = await inBatches<{ id: string; product_name: string; product_code: string; selling_price: number | null; unit: string | null }>(ids, (p) => supabaseAdmin.from('products').select('id, product_name, product_code, selling_price, unit').eq('organization_id', org).in('id', p), 'DISTRIBUTOR_PRODUCTS_FAILED');
  return new Map(rows.map((r) => [r.id, r]));
}

function alertsFor(c: ClientRow, p: Record<string, unknown> | undefined, m: { outstanding: number; lastOrderDays: number | null; mismatch: boolean; lowCover: number }) {
  const alerts: string[] = [];
  if (c.credit_limit && m.outstanding >= c.credit_limit) alerts.push('Over credit limit');
  else if (c.credit_limit && m.outstanding >= c.credit_limit * 0.75) alerts.push('Near credit limit');
  if (m.lastOrderDays == null) alerts.push('Never ordered'); else if (m.lastOrderDays > 45) alerts.push(`No order for ${m.lastOrderDays} days`);
  if (m.lowCover > 0) alerts.push(`${m.lowCover} product(s) under 7 days of stock`);
  if (m.mismatch) alerts.push('Stock mismatch: sold more than received');
  const end = p?.agreement_end as string | null | undefined;
  if (end) { const left = daysBetween(today(), end); if (left < 0) alerts.push('Agreement expired'); else if (left <= 30) alerts.push(`Agreement ends in ${left} day(s)`); }
  const risky = alerts.some((a) => /Over credit|expired|Stock mismatch/.test(a));
  return { alerts, health: risky ? 'risk' : alerts.length ? 'watch' : 'good' } as const;
}

function summarise(c: ClientRow, raw: Raw, prices: Map<string, { selling_price: number | null }>, credit: { outstanding: number } | null) {
  const pos = [...positionsFor(c.id, raw).values()];
  const profile = raw.profiles.find((p) => p.client_id === c.id);
  const orders = raw.orders.filter((o) => o.client_id === c.id);
  const month = today().slice(0, 7);
  const primaryValue = orders.reduce((s, o) => s + orderBase(o), 0);
  const primaryThisMonth = orders.filter((o) => o.created_at.slice(0, 7) === month).reduce((s, o) => s + orderBase(o), 0);
  const last = orders.map((o) => o.created_at).sort().pop() ?? null;
  const entries = raw.entries.filter((e) => e.client_id === c.id && e.entry_type === 'secondary_sale');
  const secondaryValue = entries.reduce((s, e) => s + num(e.amount), 0);
  const received = pos.reduce((s, p) => s + p.primary - p.returned, 0);
  const sold = pos.reduce((s, p) => s + p.secondary, 0);
  const stockUnits = pos.reduce((s, p) => s + Math.max(0, p.onHand), 0);
  const stockValue = pos.reduce((s, p) => s + Math.max(0, p.onHand) * num(prices.get(p.productId)?.selling_price), 0);
  const lowCover = pos.filter((p) => { const avg = p.secondaryLast30 / 30; return avg > 0 && p.onHand / avg < 7; }).length;
  const target = profile?.monthly_target == null ? null : num(profile.monthly_target);
  const lastOrderDays = last ? daysBetween(last, today()) : null;
  const { alerts, health } = alertsFor(c, profile, { outstanding: credit?.outstanding ?? 0, lastOrderDays, mismatch: pos.some((p) => p.onHand < -1e-9), lowCover });
  return {
    clientId: c.id, code: c.client_code, name: c.client_name, status: c.status, city: c.city, state: c.state,
    tier: (profile?.tier as string) ?? 'distributor', territory: (profile?.territory as string | null) ?? null,
    creditLimit: c.credit_limit, creditDays: c.credit_days, outstanding: r2(credit?.outstanding ?? 0),
    orderCount: orders.length, primaryValue: r2(primaryValue), primaryThisMonth: r2(primaryThisMonth), monthlyTarget: target,
    targetAchievement: target ? r1((primaryThisMonth / target) * 100) : null,
    secondaryValue: r2(secondaryValue), secondaryUnits: r2(sold), stockUnits: r2(stockUnits), stockValue: r2(stockValue),
    sellThrough: received > 0 ? r1(Math.min(100, (sold / received) * 100)) : null,
    lastOrderDate: last, lastOrderDays, agreementEnd: (profile?.agreement_end as string | null) ?? null, alerts, health,
  };
}

export async function listDistributors(org: string, industryTypeId: string) {
  const clients = await distributorClients(org, industryTypeId);
  if (!clients.length) return [];
  const raw = await loadRaw(org, industryTypeId, clients.map((c) => c.id));
  const productIds = [...new Set(clients.flatMap((c) => [...positionsFor(c.id, raw).keys()]))];
  const prices = productIds.length ? await productInfo(org, productIds) : new Map();
  const credits = new Map<string, { outstanding: number } | null>();
  for (const part of chunk(clients, 10)) await Promise.all(part.map(async (c) => credits.set(c.id, await getClientCredit(org, c.id))));
  return clients.map((c) => summarise(c, raw, prices, credits.get(c.id) ?? null));
}

export async function getDistributor(org: string, industryTypeId: string, clientId: string) {
  const [client] = await distributorClients(org, industryTypeId, clientId);
  if (!client) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor not found. Check the client\'s outlet type is "Distributor".');
  const raw = await loadRaw(org, industryTypeId, [client.id]);
  const positions = [...positionsFor(client.id, raw).values()];
  const products = await productInfo(org, positions.map((p) => p.productId).concat(raw.entries.map((e) => e.product_id)));
  const credit = await getClientCredit(org, client.id);
  const profile = raw.profiles.find((p) => p.client_id === client.id);
  const coverTarget = num(profile?.cover_days) || 30;
  const stock = positions.map((p) => {
    const info = products.get(p.productId); const avg = p.secondaryLast30 / 30;
    const cover = avg > 0 ? r1(Math.max(0, p.onHand) / avg) : null;
    return { productId: p.productId, name: info?.product_name ?? 'Unknown product', code: info?.product_code ?? '', unit: info?.unit ?? '', primary: r2(p.primary), returned: r2(p.returned), secondary: r2(p.secondary), adjusted: r2(p.adjusted), onHand: p.onHand, avgDaily: r2(avg), coverDays: cover, suggestedOrder: avg > 0 ? Math.max(0, Math.ceil(avg * coverTarget - Math.max(0, p.onHand))) : 0, value: r2(Math.max(0, p.onHand) * num(info?.selling_price)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const months: Array<{ month: string; primary: number; secondary: number }> = [];
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); months.push({ month: d.toISOString().slice(0, 7), primary: 0, secondary: 0 }); }
  for (const o of raw.orders) { const m = months.find((x) => x.month === o.created_at.slice(0, 7)); if (m) m.primary += orderBase(o); }
  for (const e of raw.entries) if (e.entry_type === 'secondary_sale') { const m = months.find((x) => x.month === e.entry_date.slice(0, 7)); if (m) m.secondary += num(e.amount); }
  const summary = summarise(client, raw, products, credit);
  return {
    ...summary, profile: profile ?? null, stock,
    trend: months.map((m) => ({ ...m, primary: r2(m.primary), secondary: r2(m.secondary) })),
    entries: raw.entries.slice(0, 60).map((e) => ({ ...e, productName: products.get(e.product_id)?.product_name ?? '' })),
    recentOrders: raw.orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10).map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, dispatchStatus: o.dispatch_status ?? 'pending', amount: r2(orderBase(o)), createdAt: o.created_at })),
  };
}

async function assertDistributor(org: string, industryTypeId: string, clientId: string) {
  const [client] = await distributorClients(org, industryTypeId, clientId);
  if (!client) throw new AppError(404, 'DISTRIBUTOR_NOT_FOUND', 'Distributor not found. Check the client\'s outlet type is "Distributor".');
  return client;
}

export async function saveProfile(org: string, industryTypeId: string, clientId: string, input: ProfileInput) {
  await assertDistributor(org, industryTypeId, clientId);
  const row = { organization_id: org, industry_type_id: industryTypeId, client_id: clientId, tier: input.tier, territory: input.territory || null, monthly_target: input.monthlyTarget ?? null, margin_percent: input.marginPercent ?? null, security_deposit: input.securityDeposit ?? null, agreement_start: input.agreementStart || null, agreement_end: input.agreementEnd || null, cover_days: input.coverDays, notes: input.notes || null, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from('fmcg_distributor_profiles').upsert(row, { onConflict: 'organization_id,client_id' }).select('*').single();
  if (error) fail('DISTRIBUTOR_PROFILE_SAVE_FAILED', error);
  return data;
}

export async function addEntry(org: string, userId: string, industryTypeId: string, clientId: string, input: EntryInput) {
  await assertDistributor(org, industryTypeId, clientId);
  const products = await productInfo(org, [input.productId]);
  const product = products.get(input.productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  const date = input.entryDate ?? today();
  if (date > today()) throw new AppError(422, 'FUTURE_DATE', 'The date cannot be in the future.');
  const raw = await loadRaw(org, industryTypeId, [clientId]);
  const onHand = positionsFor(clientId, raw).get(input.productId)?.onHand ?? 0;
  if (input.quantity > onHand + 1e-9) throw new AppError(422, 'EXCEEDS_DISTRIBUTOR_STOCK', `${product.product_name}: this distributor only has ${Math.max(0, onHand)} unit(s) (dispatched to them, less returns and earlier sales). Dispatch a shipment for the order first.`);
  const amount = input.entryType === 'adjustment' ? 0 : input.amount ?? r2(input.quantity * num(product.selling_price));
  const { data, error } = await supabaseAdmin.from('fmcg_secondary_sales').insert({ organization_id: org, industry_type_id: industryTypeId, client_id: clientId, product_id: input.productId, entry_type: input.entryType, quantity: input.quantity, amount, entry_date: date, outlet_name: input.outletName || null, reason: input.reason || null, created_by: userId }).select('*').single();
  if (error) fail('SECONDARY_SAVE_FAILED', error);
  return data;
}

export async function deleteEntry(org: string, industryTypeId: string, id: string) {
  const { data, error } = await supabaseAdmin.from('fmcg_secondary_sales').delete().eq('id', id).eq('organization_id', org).eq('industry_type_id', industryTypeId).select('id');
  if (error) fail('SECONDARY_DELETE_FAILED', error);
  if (!data?.length) throw new AppError(404, 'ENTRY_NOT_FOUND', 'Entry not found.');
}