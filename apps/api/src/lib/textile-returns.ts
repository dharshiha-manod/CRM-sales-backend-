/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile returns & refunds helpers shared by the routes and the Automation Center.
//   - returnableRolls: rolls received on a posted GRN that can still go back to the mill (with a hint for damaged / rejected ones)
//   - pendingCustomerRefunds: orders where the customer paid more than the order is worth after return credit
import { supabaseAdmin } from './supabase.js';
import { all, num, r2, str, type Row } from './pharma-db.js';

const RETURNABLE_STATUS = ['In stock', 'Quarantine', 'Damaged'];

/** Rolls that came in on a Posted GRN of this industry and still have metres on the shelf, not tied to an order.
 *  `suggested` = damaged, in quarantine or graded Reject: the usual reasons to send fabric back. */
export async function returnableRolls(orgId: string, it: string, supplierId?: string | null): Promise<Row[]> {
  let q = (): any => supabaseAdmin.from('textile_grns').select('id, grn_number, supplier_id, received_date, lines')
    .eq('organization_id', orgId).eq('industry_type_id', it).eq('status', 'Posted').order('received_date', { ascending: false });
  if (supplierId) { const base = q; q = () => base().eq('supplier_id', supplierId); }
  const grns = await all(q);
  const byRoll = new Map<string, { grn: Row; line: Row }>();
  for (const g of grns) for (const l of (g.lines ?? []) as Row[]) byRoll.set(str(l.roll_number), { grn: g, line: l });
  const numbers = [...byRoll.keys()].filter(Boolean);
  const out: Row[] = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('textile_fabric_rolls')
      .select('id, roll_number, product_code, colour, lot_number, length_meters, status, quality_grade, order_id, warehouse_location')
      .eq('organization_id', orgId).in('roll_number', numbers.slice(i, i + 100));
    if (error) throw error;
    for (const r of (data ?? []) as Row[]) {
      if (r.order_id || !RETURNABLE_STATUS.includes(str(r.status)) || num(r.length_meters) <= 0) continue;
      const hit = byRoll.get(str(r.roll_number)); if (!hit) continue;
      const bad = r.status === 'Damaged' || r.status === 'Quarantine' || r.quality_grade === 'Reject';
      out.push({
        grn_id: hit.grn.id, grn_number: hit.grn.grn_number, supplier_id: hit.grn.supplier_id, received_date: hit.grn.received_date,
        roll_id: r.id, roll_number: r.roll_number, product_code: r.product_code, product_name: hit.line.product_name ?? null, colour: r.colour,
        lot_number: r.lot_number, warehouse_location: r.warehouse_location, status: r.status, quality_grade: r.quality_grade,
        grn_length: num(hit.line.length_meters), available: r2(num(r.length_meters)), rate: num(hit.line.rate), gst_percent: num(hit.line.gst_percent), suggested: bad,
      });
    }
  }
  return out.sort((a, b) => Number(b.suggested) - Number(a.suggested) || String(a.roll_number).localeCompare(String(b.roll_number)));
}

/** Orders where the customer paid MORE than the order is worth after approved return credit and has not been paid back yet. */
export async function pendingCustomerRefunds(orgId: string, it: string): Promise<Row[]> {
  const { data: orders, error } = await supabaseAdmin.from('sale_orders')
    .select('id, order_number, total_amount, clients!inner(client_name, client_code, industry_type_id)')
    .eq('organization_id', orgId).neq('status', 'cancelled').eq('clients.industry_type_id', it).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const list = (orders ?? []) as unknown as Array<{ id: string; order_number: string; total_amount: number; clients: { client_name: string; client_code: string } | { client_name: string; client_code: string }[] }>;
  const paid = new Map<string, number>(); const credit = new Map<string, number>(); const back = new Map<string, number>();
  const add = (m: Map<string, number>, k: unknown, v: unknown) => m.set(String(k), (m.get(String(k)) ?? 0) + num(v));
  for (let i = 0; i < list.length; i += 100) {
    const ids = list.slice(i, i + 100).map((o) => o.id);
    const [c, r, f] = await Promise.all([
      supabaseAdmin.from('sales_collections').select('sale_order_id, amount').eq('organization_id', orgId).in('sale_order_id', ids),
      supabaseAdmin.from('sales_returns').select('order_id, credit_amount').eq('organization_id', orgId).eq('status', 'approved').in('order_id', ids),
      supabaseAdmin.from('sales_refunds').select('order_id, amount').eq('organization_id', orgId).in('order_id', ids),
    ]);
    if (c.error) throw c.error;
    if (r.error) throw r.error;
    if (f.error && !/sales_refunds/.test(f.error.message)) throw f.error; // table missing = nothing refunded yet
    for (const x of (c.data ?? []) as Row[]) add(paid, x.sale_order_id, x.amount);
    for (const x of (r.data ?? []) as Row[]) add(credit, x.order_id, x.credit_amount);
    for (const x of (f.data ?? []) as Row[]) add(back, x.order_id, x.amount);
  }
  return list.map((o) => {
    const cl = Array.isArray(o.clients) ? o.clients[0] : o.clients;
    const collected = paid.get(o.id) ?? 0; const credited = credit.get(o.id) ?? 0; const refunded = back.get(o.id) ?? 0;
    return {
      order_id: o.id, order_number: o.order_number, client_name: cl?.client_name, client_code: cl?.client_code, order_total: r2(num(o.total_amount)),
      collected: r2(collected), credited: r2(credited), refunded: r2(refunded), due: r2(collected - refunded + credited - num(o.total_amount)),
    };
  }).filter((o) => o.due > 0.005);
}
