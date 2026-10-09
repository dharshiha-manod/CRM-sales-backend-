import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal stand-in for supabaseAdmin: each table returns whatever the test put in db[table].
const db: Record<string, unknown> = {};
vi.mock('../src/lib/supabase.js', () => {
  const builder = (table: string) => {
    const result = () => ({ data: db[table], error: null });
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'gt', 'order', 'update']) chain[m] = () => chain;
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return chain;
  };
  return { supabaseAdmin: { from: builder } };
});
vi.mock('../src/repositories/products.repository.js', () => ({ changeProductStock: vi.fn() }));

import { getFmcgExpiryRules } from '../src/lib/settings.js';
import { daysUntilExpiry, planAllocations } from '../src/lib/stock.js';

const ORG = 'org-1';
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  db.organization_settings = { settings: {} };
  db.products = [{ id: 'p1', product_name: 'Biscuit', stock_quantity: 30 }];
});

describe('FMCG expiry rules from Settings', () => {
  it('falls back to 30 / 7 days when nothing is saved', async () => {
    const rules = await getFmcgExpiryRules(ORG);
    expect(rules.expiryWarningDays).toBe(30);
    expect(rules.blockSaleWithinDaysOfExpiry).toBe(7);
  });

  it("uses FMCG's own values and ignores other industries'", async () => {
    db.organization_settings = { settings: {
      expiryBatch: { blockSaleWithinDaysOfExpiry: 7 },
      byIndustry: { fmcg: { expiryBatch: { blockSaleWithinDaysOfExpiry: 14 }, inventory: { expiryWarningDays: 45 } }, pharma: { expiryBatch: { blockSaleWithinDaysOfExpiry: 90 } } },
    } };
    const rules = await getFmcgExpiryRules(ORG);
    expect(rules.blockSaleWithinDaysOfExpiry).toBe(14);
    expect(rules.expiryWarningDays).toBe(45);
  });
});

describe('daysUntilExpiry', () => {
  it('counts whole days, negative once expired', () => {
    expect(daysUntilExpiry('2026-10-10', '2026-10-07')).toBe(3);
    expect(daysUntilExpiry('2026-10-07', '2026-10-07')).toBe(0);
    expect(daysUntilExpiry('2026-10-06', '2026-10-07')).toBe(-1);
  });
});

describe('batch picking skips unsellable batches', () => {
  const line = (quantity: number) => [{ product_id: 'p1', quantity }];

  it('refuses stock that only exists in a batch expiring inside the block window', async () => {
    db.product_batches = [{ id: 'b1', product_id: 'p1', batch_no: 'B1', expiry_date: iso(3), quantity: 30 }];
    await expect(planAllocations(ORG, line(5))).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('sells from the next in-date batch instead', async () => {
    db.product_batches = [
      { id: 'b1', product_id: 'p1', batch_no: 'B1', expiry_date: iso(3), quantity: 10 },
      { id: 'b2', product_id: 'p1', batch_no: 'B2', expiry_date: iso(90), quantity: 20 },
    ];
    const plan = await planAllocations(ORG, line(5));
    expect(plan.get('0')![0].batches).toEqual([{ batchId: 'b2', batchNo: 'B2', quantity: 5 }]);
  });

  it('a batch outside the window is still sold in the order the database returns it (earliest expiry first)', async () => {
    db.product_batches = [
      { id: 'b3', product_id: 'p1', batch_no: 'B3', expiry_date: iso(30), quantity: 10 },
      { id: 'b2', product_id: 'p1', batch_no: 'B2', expiry_date: iso(60), quantity: 20 },
    ];
    const plan = await planAllocations(ORG, line(12));
    expect(plan.get('0')![0].batches.map((b) => [b.batchNo, b.quantity])).toEqual([['B3', 10], ['B2', 2]]);
  });
});
