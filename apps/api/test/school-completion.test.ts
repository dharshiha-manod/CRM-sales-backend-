import { beforeEach, describe, expect, it, vi } from 'vitest';

// School orders settle when the shortfall is under Rs 1 (paise from tax); FMCG keeps the exact rule.
let industry: 'school' | 'fmcg';
let paid: number;
let total: number;
let completed: boolean;
vi.mock('../src/lib/fmcg-market.js', () => ({ isFmcgIndustry: vi.fn(async () => industry === 'fmcg'), industryCodeOf: vi.fn(async () => industry) }));
vi.mock('../src/lib/fmcg-paperwork.js', () => ({ fmcgInvoicedByOrder: vi.fn(async () => new Map()) }));
vi.mock('../src/repositories/fmcg-refunds.repository.js', () => ({ refundedByOrder: vi.fn(async () => new Map()) }));
vi.mock('../src/lib/logger.js', () => ({ logger: { error: vi.fn() } }));
vi.mock('../src/lib/supabase.js', () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'update']) c[m] = (...args: unknown[]) => { if (m === 'update') completed = true; void args; return c; };
    c.maybeSingle = async () => ({ data: { id: 'o1', status: 'confirmed', dispatch_status: 'delivered', total_amount: total, clients: { industry_type_id: 'x' } }, error: null });
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: table === 'sales_collections' ? [{ amount: paid }] : [], error: null });
    return c;
  };
  return { supabaseAdmin: { from: (table: string) => chain(table) } };
});

const { completeOrderIfSettled } = await import('../src/lib/order-completion.js');

describe('completeOrderIfSettled tolerance', () => {
  beforeEach(() => { industry = 'school'; total = 1772.2; paid = 1772; completed = false; });
  it('school: Rs 0.20 short still completes', async () => { expect(await completeOrderIfSettled('org', 'o1')).toBe(true); expect(completed).toBe(true); });
  it('school: Rs 1.20 short does not complete', async () => { paid = 1771; expect(await completeOrderIfSettled('org', 'o1')).toBe(false); });
  it('fmcg: Rs 0.20 short does not complete (unchanged rule)', async () => { industry = 'fmcg'; expect(await completeOrderIfSettled('org', 'o1')).toBe(false); expect(completed).toBe(false); });
});