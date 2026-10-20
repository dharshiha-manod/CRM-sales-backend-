// FMCG alerts computed on the server (so every device and the mobile app see the same list):
//  - expired batches and batches expiring within the "Expiry warning (days)" Setting, with units still on hand
//  - products at or below their minimum stock level (products.min_stock_level)
// Read-only. The admin Notifications page and dashboards can call GET /fmcg/alerts instead of reading browser storage.
import { supabaseAdmin } from './supabase.js';
import { getFmcgExpiryRules } from './settings.js';
import { daysUntilExpiry } from './stock.js';

const num = (v: unknown) => Number(v ?? 0) || 0;
const fail = (error: unknown): never => { throw error; };

export type ExpiryAlert = { batchId: string; batchNo: string; productId: string; productName: string; productCode: string; quantity: number; expiryDate: string; daysLeft: number; level: 'expired' | 'expiring' };
export type LowStockAlert = { productId: string; productName: string; productCode: string; stock: number; minStockLevel: number; shortBy: number };

async function industryProductIds(org: string, industryTypeId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from('product_industry_types').select('product_id').eq('organization_id', org).eq('industry_type_id', industryTypeId).order('product_id').range(from, from + 999);
    if (error) fail(error);
    ids.push(...(data ?? []).map((r) => r.product_id as string));
    if ((data ?? []).length < 1000) break;
  }
  return ids;
}

export async function getFmcgAlerts(org: string, industryTypeId: string, today = new Date().toISOString().slice(0, 10)) {
  const productIds = await industryProductIds(org, industryTypeId);
  if (productIds.length === 0) return { expiry: [] as ExpiryAlert[], lowStock: [] as LowStockAlert[], warningDays: 0 };
  const { expiryWarningDays } = await getFmcgExpiryRules(org);

  const expiry: ExpiryAlert[] = [];
  const lowStock: LowStockAlert[] = [];
  for (let i = 0; i < productIds.length; i += 100) {
    const part = productIds.slice(i, i + 100);
    const [products, batches] = await Promise.all([
      supabaseAdmin.from('products').select('id, product_code, product_name, stock_quantity, min_stock_level').eq('organization_id', org).eq('status', 'active').in('id', part),
      supabaseAdmin.from('product_batches').select('id, product_id, batch_no, quantity, expiry_date, products(product_code, product_name)').eq('organization_id', org).in('product_id', part).gt('quantity', 0).not('expiry_date', 'is', null),
    ]);
    // min_stock_level is added by supabase/migrations/20261020_products_min_stock.sql; before it runs, low-stock alerts are simply empty.
    if (products.error && (products.error as { code?: string }).code !== '42703') fail(products.error);
    if (batches.error) fail(batches.error);
    for (const p of products.error ? [] : products.data ?? []) {
      const min = num(p.min_stock_level);
      if (min > 0 && p.stock_quantity != null && num(p.stock_quantity) <= min) {
        lowStock.push({ productId: p.id as string, productName: String(p.product_name), productCode: String(p.product_code), stock: num(p.stock_quantity), minStockLevel: min, shortBy: Math.max(0, min - num(p.stock_quantity)) });
      }
    }
    for (const b of batches.data ?? []) {
      const days = daysUntilExpiry(String(b.expiry_date), today);
      if (days > expiryWarningDays) continue;
      const prod = (Array.isArray(b.products) ? b.products[0] : b.products) as { product_code?: string; product_name?: string } | null;
      expiry.push({ batchId: b.id as string, batchNo: String(b.batch_no), productId: b.product_id as string, productName: String(prod?.product_name ?? ''), productCode: String(prod?.product_code ?? ''), quantity: num(b.quantity), expiryDate: String(b.expiry_date).slice(0, 10), daysLeft: days, level: days < 0 ? 'expired' : 'expiring' });
    }
  }
  expiry.sort((a, b) => a.daysLeft - b.daysLeft);
  lowStock.sort((a, b) => b.shortBy - a.shortBy);
  return { expiry, lowStock, warningDays: expiryWarningDays };
}