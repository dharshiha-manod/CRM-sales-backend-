import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: (t: string) => { calls.push(t); throw new Error('must not be called'); } } }));

const { applySchoolAdvance } = await import('../src/lib/school.js');

describe('applySchoolAdvance', () => {
  it('does nothing (no database access) for a non-School order', async () => {
    await applySchoolAdvance('org', null, { id: 'o1', client_id: 'c1', representative_id: 'r1', total_amount: 100, status: 'confirmed' });
    expect(calls).toEqual([]);
  });
  it('does nothing for cancelled / pending-approval School orders', async () => {
    const ctx = { industryTypeId: 'i', rules: [], period: null };
    await applySchoolAdvance('org', ctx, { id: 'o1', client_id: 'c1', representative_id: 'r1', total_amount: 100, status: 'pending_approval' });
    expect(calls).toEqual([]);
  });
  it('never throws when the database fails', async () => {
    const ctx = { industryTypeId: 'i', rules: [], period: null };
    await expect(applySchoolAdvance('org', ctx, { id: 'o1', client_id: 'c1', representative_id: 'r1', total_amount: 100, status: 'confirmed' })).resolves.toBeUndefined();
  });
});
