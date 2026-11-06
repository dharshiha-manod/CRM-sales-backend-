import { describe, expect, it, vi, beforeEach } from 'vitest';

// A fake database: every query returns the rows set for that table (filters are not applied, the test sets only the rows it wants returned).
const db: Record<string, Record<string, unknown>[]> = {};
vi.mock('../src/lib/supabase.js', () => {
  const chain = (table: string): unknown => new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: db[table] ?? [], error: null, count: (db[table] ?? []).length });
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: (db[table] ?? [])[0] ?? null, error: null });
      return () => chain(table);
    },
  });
  return { supabaseAdmin: { from: (table: string) => chain(table) } };
});
vi.mock('../src/lib/fmcg-market.js', () => ({ industryCodeOf: async () => 'vehicle' }));
vi.mock('../src/lib/ist-date.js', () => ({ todayLocal: () => '2026-11-06' }));
vi.mock('../src/lib/logger.js', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));

import { loadVehicleSchemeEngine, schemeFitsCustomer } from '../src/lib/vehicle-schemes.js';

const scheme = (over: Record<string, unknown> = {}) => ({ scheme_id: 'SCH-1', scheme_name: 'Diwali Discount', status: 'Active', discount_type: 'Percentage', discount_value: 10, approval_required: 'No', ...over });
const setup = (schemes: Record<string, unknown>[], extra: Record<string, Record<string, unknown>[]> = {}) => {
  for (const k of Object.keys(db)) delete db[k];
  db.vehicle_schemes = schemes;
  db.vehicle_models = [{ id: 'M1', product_id: 'P1' }];
  Object.assign(db, extra);
};
const run = async (qty: number, price = 100000, ctx = {}) => (await loadVehicleSchemeEngine('org', 'ind', ['P1'], ctx))?.discountFor('P1', qty, price) ?? null;

describe('vehicle scheme engine', () => {
  beforeEach(() => setup([scheme()]));

  it('10% scheme: line discount and the scheme name is returned for the audit trail', async () => {
    const hit = await run(2);
    expect(hit?.amount).toBe(20000);
    expect(hit?.schemeName).toBe('Diwali Discount');
    expect(hit?.schemeId).toBe('|SCH-1|');
  });
  it('fixed amount is a flat amount, per-vehicle scales with quantity', async () => {
    setup([scheme({ discount_type: 'Fixed Amount', discount_value: 5000 })]);
    expect((await run(3))?.amount).toBe(5000);
    setup([scheme({ discount_type: 'Per Vehicle', discount_value: 5000 })]);
    expect((await run(3))?.amount).toBe(15000);
  });
  it('gap 1: approval-required scheme is never applied automatically', async () => {
    setup([scheme({ approval_required: 'Yes' })]);
    expect(await run(1)).toBeNull();
  });
  it('gap 4: customer-type scheme needs a matching customer', async () => {
    setup([scheme({ customer_type: 'Government' })], { clients: [{ client_type: 'retailer' }], sale_orders: [] });
    expect(await run(1, 100000, { clientId: 'C1' })).toBeNull();
    setup([scheme({ customer_type: 'Government' })], { clients: [{ client_type: 'Government' }], sale_orders: [] });
    expect((await run(1, 100000, { clientId: 'C1' }))?.amount).toBe(10000);
    expect(await run(1)).toBeNull(); // no client known
  });
  it('gap 4: repeat-customer scheme uses the order history', async () => {
    setup([scheme({ customer_type: 'Existing customer (repeat)' })], { clients: [{ client_type: 'retailer' }], sale_orders: [{ id: 'old' }] });
    expect((await run(1, 100000, { clientId: 'C1' }))?.amount).toBe(10000);
  });
  it('gap 5: a branch scheme applies when the showroom has exactly one Branch', async () => {
    setup([scheme({ dealer_id: 'D1' })], { vehicle_dealers: [{ id: 'D1' }] });
    expect((await run(1))?.amount).toBe(10000);
    setup([scheme({ dealer_id: 'D1' })], { vehicle_dealers: [{ id: 'D2' }] });
    expect(await run(1)).toBeNull();
    setup([scheme({ dealer_id: 'D1' })], { vehicle_dealers: [{ id: 'D1' }, { id: 'D2' }] });
    expect(await run(1)).toBeNull(); // ambiguous: applied on the booking instead
  });
  it('gap 9: minimum quantity, usage limit and budget cap', async () => {
    setup([scheme({ min_quantity: 2 })]);
    expect(await run(1)).toBeNull();
    expect((await run(2))?.amount).toBe(20000);
    setup([scheme({ usage_limit: 5 })], { sale_order_items: [{ quantity: 4, discount_amount: 1, vehicle_scheme_ref: '|SCH-1|', order_id: 'o1' }] });
    expect(await run(2)).toBeNull(); // 4 used + 2 > 5
    expect((await run(1))?.amount).toBe(10000);
    setup([scheme({ budget_cap: 25000 })], { sale_order_items: [{ quantity: 1, discount_amount: 20000, vehicle_scheme_ref: '|SCH-1|', order_id: 'o1' }] });
    expect((await run(1))?.amount).toBe(5000); // only 5,000 of the budget is left
  });
  it('gap 9: a stackable scheme is added on top of the best one, never above the line value', async () => {
    setup([scheme(), scheme({ scheme_id: 'SCH-2', scheme_name: 'Exchange Mela', discount_type: 'Fixed Amount', discount_value: 3000, stackable: 'Yes' })]);
    const hit = await run(1);
    expect(hit?.amount).toBe(13000);
    expect(hit?.schemeId).toBe('|SCH-1|SCH-2|');
    expect(hit?.schemeName).toBe('Diwali Discount + Exchange Mela');
    setup([scheme({ discount_value: 100 }), scheme({ scheme_id: 'SCH-2', discount_type: 'Fixed Amount', discount_value: 3000, stackable: 'Yes' })]);
    expect((await run(1))?.amount).toBe(100000);
  });
  it('no live scheme / accessory-only order gives no discount', async () => {
    setup([scheme({ status: 'Expired' })]);
    db.vehicle_schemes = [scheme({ end_date: '2026-01-01' })];
    expect(await run(1)).toBeNull();
    setup([scheme()]);
    db.vehicle_models = [];
    expect(await run(1)).toBeNull();
  });
});

describe('schemeFitsCustomer', () => {
  it('matches the 16 scheme types against free-text client types', () => {
    expect(schemeFitsCustomer('All customers', 'anything', false)).toBe(true);
    expect(schemeFitsCustomer('Retail', 'retailer', false)).toBe(true);
    expect(schemeFitsCustomer('Government', 'retailer', false)).toBe(false);
    expect(schemeFitsCustomer('Taxi / Commercial', 'Commercial fleet', false)).toBe(true);
    expect(schemeFitsCustomer('Fleet', 'Fleet owner', false)).toBe(true);
    expect(schemeFitsCustomer('Existing customer (repeat)', 'retailer', true)).toBe(true);
    expect(schemeFitsCustomer('Existing customer (repeat)', 'retailer', false)).toBe(false);
    expect(schemeFitsCustomer('Other', '', false)).toBe(true);
  });
});
