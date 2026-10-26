import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny chainable fake of supabaseAdmin: every query on a table resolves to whatever rows the test registered.
const queried: string[] = [];
const tables: Record<string, unknown[]> = {};
function builder(table: string) {
  queried.push(table);
  const result = () => ({ data: tables[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'lte', 'gte', 'or', 'order', 'limit', 'neq']) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return chain;
}
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }));
import { currentSchoolPeriod, isSchoolIndustry, loadSchoolContext } from '../src/lib/school.js';

beforeEach(() => { queried.length = 0; for (const k of Object.keys(tables)) delete tables[k]; });

describe('School logic is School-only', () => {
  it('a Trading / FMCG client never gets a school context and no school table is read', async () => {
    for (const code of ['trading', 'FMCG', 'textile', 'pharma', 'vehicle']) {
      queried.length = 0;
      tables.industry_types = [{ code }];
      expect(await loadSchoolContext('org', { id: 'c1', industry_type_id: 'i1' }, ['p1'])).toBeNull();
      expect(queried.some((t) => t.startsWith('school_'))).toBe(false);
    }
  });
  it('a client with no industry gets no school context', async () => {
    expect(await loadSchoolContext('org', { id: 'c1', industry_type_id: null }, ['p1'])).toBeNull();
    expect(await isSchoolIndustry('org', null)).toBe(false);
  });
  it('a School client gets its live rules and the running academic year + term', async () => {
    tables.industry_types = [{ code: 'SCHOOL' }];
    tables.school_pricing_rules = [{ id: 'r1', product_id: 'p1', discount_type: 'percentage', discount_percent: '12', fixed_price: null, min_quantity: '0' }];
    tables.school_academic_years = [{ id: 'ay1' }];
    tables.school_terms = [{ id: 't2' }];
    const ctx = await loadSchoolContext('org', { id: 'c1', industry_type_id: 'i1' }, ['p1']);
    expect(ctx?.rules).toEqual([{ id: 'r1', product_id: 'p1', discount_type: 'percentage', discount_percent: 12, fixed_price: null, min_quantity: 0 }]);
    expect(ctx?.period).toEqual({ academic_year_id: 'ay1', term_id: 't2' });
  });
  it('no academic year running means no stamp (orders are still allowed)', async () => {
    tables.school_academic_years = [];
    expect(await currentSchoolPeriod('org', 'i1')).toBeNull();
  });
});
