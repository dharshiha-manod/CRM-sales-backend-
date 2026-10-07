import { describe, expect, it, vi, beforeEach } from 'vitest';

// Fake Supabase: every table returns the rows set in `db`; filters are ignored (one client per test).
const db: Record<string, unknown> = {};
vi.mock('../src/lib/supabase.js', () => {
  const builder = (table: string) => {
    const result = () => ({ data: db[table], error: null });
    const b: any = {
      select: () => b, eq: () => b, neq: () => b,
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return b;
  };
  return { supabaseAdmin: { from: (table: string) => builder(table) } };
});

import { assertWithinCreditLimit } from '../src/lib/credit.js';

const setup = (limit: number | null, orders: number[], paid: number[]) => {
  db.clients = { client_name: 'Adwin', credit_limit: limit, credit_days: 30 };
  db.sale_orders = orders.map((total_amount) => ({ total_amount }));
  db.sales_collections = paid.map((amount) => ({ amount }));
};

describe('credit limit', () => {
  beforeEach(() => setup(10000, [], []));

  it('allows an order inside the limit', async () => {
    setup(10000, [8000], [3000]); // unpaid 5000
    await expect(assertWithinCreditLimit('org', 'c1', 5000)).resolves.toBeUndefined(); // exactly 10000
  });

  it('blocks an order that crosses the limit', async () => {
    setup(10000, [8000], []); // unpaid 8000 + 5000 = 13000
    await expect(assertWithinCreditLimit('org', 'c1', 5000)).rejects.toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED', statusCode: 422 });
  });

  it('paying down the balance frees credit again', async () => {
    setup(10000, [8000], [6000]); // unpaid 2000 + 5000 = 7000
    await expect(assertWithinCreditLimit('org', 'c1', 5000)).resolves.toBeUndefined();
  });

  it('never blocks a client with no limit set', async () => {
    setup(null, [999999], []);
    await expect(assertWithinCreditLimit('org', 'c1', 500000)).resolves.toBeUndefined();
  });

  it('ignores zero or negative additions (edit that lowers the total)', async () => {
    setup(10000, [20000], []);
    await expect(assertWithinCreditLimit('org', 'c1', -500)).resolves.toBeUndefined();
  });
  it('counts a foreign-currency order and its payments in INR, not raw USD', async () => {
    db.clients = { client_name: 'Gulf Foods', credit_limit: 1000000, credit_days: 30 };
    db.sale_orders = [{ total_amount: 5000, base_total: 415000 }];              // USD 5,000 @ 83 = INR 4,15,000
    db.sales_collections = [{ amount: 1000, sale_orders: { exchange_rate: 83 } }]; // USD 1,000 paid = INR 83,000
    // unpaid = 415000 - 83000 = 332000; + 700000 = 1,032,000 > 1,000,000 -> blocked.
    await expect(assertWithinCreditLimit('org', 'c1', 700000)).rejects.toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED' });
    // + 600000 = 932,000 -> allowed. (With the old raw-number maths the unpaid balance would have been 4,000.)
    await expect(assertWithinCreditLimit('org', 'c1', 600000)).resolves.toBeUndefined();
  });
});