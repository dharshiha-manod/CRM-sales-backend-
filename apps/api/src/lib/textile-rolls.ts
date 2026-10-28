// Textile fabric-roll helpers shared by Fabric Roll, Orders and Delivery.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;
const today = () => new Date().toISOString().slice(0, 10);

/** Metres on open orders (confirmed, stock already taken, NOT yet dispatched) that allocated rolls do not cover yet. */
export async function reservedMetresFor(orgId: string, productId: string, productCode: string): Promise<number> {
  const { data: lines } = await supabaseAdmin.from('sale_order_items')
    .select('order_id, quantity, free_quantity, sale_orders!inner(organization_id, status, stock_deducted, textile_delivery_status)')
    .eq('product_id', productId)
    .eq('sale_orders.organization_id', orgId)
    .eq('sale_orders.status', 'confirmed')
    .eq('sale_orders.stock_deducted', true)
    .is('sale_orders.textile_delivery_status', null);
  const ordered = new Map<string, number>();
  for (const l of (lines ?? []) as { order_id: string; quantity: number | null; free_quantity: number | null }[]) {
    ordered.set(l.order_id, (ordered.get(l.order_id) ?? 0) + num(l.quantity) + num(l.free_quantity));
  }
  if (!ordered.size) return 0;
  const { data: rolls } = await supabaseAdmin.from('textile_fabric_rolls').select('order_id, length_meters')
    .eq('organization_id', orgId).eq('product_code', productCode).in('status', ['Issued', 'Sold']).in('order_id', [...ordered.keys()]);
  const covered = new Map<string, number>();
  for (const r of (rolls ?? []) as { order_id: string; length_meters: number | null }[]) {
    covered.set(r.order_id, (covered.get(r.order_id) ?? 0) + num(r.length_meters));
  }
  let reserved = 0;
  for (const [orderId, qty] of ordered) reserved += Math.max(0, qty - (covered.get(orderId) ?? 0));
  return reserved;
}

/** Product stock + colour quantities = remaining metres of its 'In stock' rolls, minus metres reserved by open orders. Best effort. */
export async function syncProductStockFromRolls(orgId: string, productCode: unknown) {
  if (typeof productCode !== 'string' || !productCode) return;
  try {
    const { data: product } = await supabaseAdmin.from('products').select('id, textile_details')
      .eq('organization_id', orgId).eq('product_code', productCode).maybeSingle();
    if (!product) return;
    const { data: rolls } = await supabaseAdmin.from('textile_fabric_rolls').select('colour, length_meters')
      .eq('organization_id', orgId).eq('product_code', productCode).eq('status', 'In stock');
    const list = (rolls ?? []) as { colour: string | null; length_meters: number | null }[];
    const byColour = new Map<string, number>();
    let total = 0;
    for (const roll of list) {
      const metres = num(roll.length_meters);
      total += metres;
      const key = String(roll.colour ?? '').trim().toLowerCase();
      byColour.set(key, (byColour.get(key) ?? 0) + metres);
    }
    const details = ((product as { textile_details?: Row | null }).textile_details ?? {}) as { colors?: { name: string; code?: string | null; quantity?: number | null }[] };
    const colors = (details.colors ?? []).map((c) => ({ ...c, quantity: byColour.get(String(c.name).trim().toLowerCase()) ?? 0 }));
    const reserved = await reservedMetresFor(orgId, (product as { id: string }).id, productCode);
    await supabaseAdmin.from('products').update({ stock_quantity: Math.max(0, total - reserved), textile_details: { ...details, colors } })
      .eq('organization_id', orgId).eq('id', (product as { id: string }).id);
  } catch { /* keep the caller working even if the product sync fails */ }
}

async function resyncProducts(orgId: string, codes: unknown[]) {
  for (const code of new Set(codes.filter((c): c is string => typeof c === 'string' && !!c))) await syncProductStockFromRolls(orgId, code);
}

/** Order cancelled: every roll still Issued to it goes back to In stock. Best effort. */
export async function releaseRollsForOrder(orgId: string, orderId: string) {
  try {
    const { data: rolls } = await supabaseAdmin.from('textile_fabric_rolls').select('id, product_code')
      .eq('organization_id', orgId).eq('order_id', orderId).eq('status', 'Issued');
    const list = (rolls ?? []) as { id: string; product_code: string | null }[];
    if (!list.length) return;
    await supabaseAdmin.from('textile_fabric_rolls')
      .update({ status: 'In stock', order_id: null, order_number: null, issued_date: null, sold_date: null })
      .eq('organization_id', orgId).in('id', list.map((r) => r.id));
    await resyncProducts(orgId, list.map((r) => r.product_code));
  } catch { /* best effort */ }
}

/** Order dispatched: every roll Issued to it becomes Sold right away. Best effort. */
export async function markRollsSoldForOrder(orgId: string, orderId: string) {
  try {
    const { data: rolls } = await supabaseAdmin.from('textile_fabric_rolls').select('id, product_code')
      .eq('organization_id', orgId).eq('order_id', orderId).eq('status', 'Issued');
    const list = (rolls ?? []) as { id: string; product_code: string | null }[];
    if (!list.length) return;
    await supabaseAdmin.from('textile_fabric_rolls').update({ status: 'Sold', sold_date: today() })
      .eq('organization_id', orgId).in('id', list.map((r) => r.id));
    await resyncProducts(orgId, list.map((r) => r.product_code));
  } catch { /* best effort */ }
}

/** Dispatch gate: for every product on the order that is tracked by fabric rolls, allocated rolls must cover the ordered metres. */
export async function assertRollsCoverOrder(orgId: string, orderId: string) {
  const { data: lines, error } = await supabaseAdmin.from('sale_order_items')
    .select('quantity, free_quantity, products(product_code, product_name)').eq('order_id', orderId);
  if (error) throw error;
  const need = new Map<string, { name: string; qty: number }>();
  for (const l of (lines ?? []) as unknown as { quantity: number | null; free_quantity: number | null; products: { product_code?: string; product_name?: string } | { product_code?: string; product_name?: string }[] | null }[]) {
    const p = Array.isArray(l.products) ? l.products[0] : l.products;
    if (!p?.product_code) continue;
    const cur = need.get(p.product_code) ?? { name: p.product_name ?? p.product_code, qty: 0 };
    cur.qty += num(l.quantity) + num(l.free_quantity);
    need.set(p.product_code, cur);
  }
  const short: string[] = [];
  for (const [code, { name, qty }] of need) {
    const { count } = await supabaseAdmin.from('textile_fabric_rolls').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('product_code', code);
    if (!count) continue; // this product is not tracked by rolls: nothing to check
    const { data: alloc } = await supabaseAdmin.from('textile_fabric_rolls').select('length_meters')
      .eq('organization_id', orgId).eq('order_id', orderId).eq('product_code', code).in('status', ['Issued', 'Sold']);
    const have = ((alloc ?? []) as { length_meters: number | null }[]).reduce((s, r) => s + num(r.length_meters), 0);
    if (have + 1e-9 < qty) short.push(`${name}: ${have} m allocated of ${qty} m ordered`);
  }
  if (short.length) throw new AppError(422, 'ROLLS_NOT_ALLOCATED', `Allocate fabric rolls to this order before dispatch (Fabric Roll page). ${short.join('; ')}.`);
}