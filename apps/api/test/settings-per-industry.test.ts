import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny stand-in for supabaseAdmin: .from(table).select().eq()...maybeSingle() / awaited list.
const db: Record<string, unknown> = {};
vi.mock('../src/lib/supabase.js', () => {
  const builder = (table: string) => {
    const result = () => ({ data: db[table], error: null });
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return chain;
  };
  return { supabaseAdmin: { from: builder } };
});

import { getFollowUpConfig, getOrderConfig, getVisitConfig, loadSettingsSnapshot } from '../src/lib/settings.js';

const ORG = 'org-1';
const TRADING = 'it-trading';
const FMCG = 'it-fmcg';

beforeEach(() => {
  db.industry_types = { code: 'TRADING' }; // single-row lookups (getOrderConfig etc.) resolve to Trading
});

describe('per-industry settings resolution', () => {
  it('an industry with no override of its own gets the org-wide base (old behaviour)', async () => {
    db.organization_settings = { settings: { order: { minOrderValue: 1000 } } };
    expect((await getOrderConfig(ORG)).minOrderValue).toBe(1000);
    expect((await getOrderConfig(ORG, TRADING)).minOrderValue).toBe(1000);
  });

  it('an override applies to its own industry only', async () => {
    db.organization_settings = {
      settings: {
        order: { minOrderValue: 1000, allowCancellation: true },
        byIndustry: { trading: { order: { minOrderValue: 25000, allowCancellation: false } } },
      },
    };
    const trading = await getOrderConfig(ORG, TRADING);
    expect(trading.minOrderValue).toBe(25000);
    expect(trading.allowCancellation).toBe(false);

    db.industry_types = { code: 'fmcg' }; // same blob, but the record belongs to FMCG
    const fmcg = await getOrderConfig(ORG, FMCG);
    expect(fmcg.minOrderValue).toBe(1000);
    expect(fmcg.allowCancellation).toBe(true);
  });

  it('an override only replaces the fields it sets; other fields still come from base/defaults', async () => {
    db.organization_settings = { settings: { byIndustry: { trading: { visit: { requireNotes: false } } } } };
    const visit = await getVisitConfig(ORG, TRADING);
    expect(visit.requireNotes).toBe(false);
    expect(visit.minDurationMinutes).toBe(5); // default untouched
  });

  it('with nothing saved at all, defaults apply', async () => {
    db.organization_settings = null;
    expect((await getFollowUpConfig(ORG, TRADING)).defaultDurationDays).toBe(3);
  });

  it('snapshot resolves each industry separately in one read', async () => {
    db.organization_settings = {
      settings: {
        followUp: { defaultDurationDays: 3 },
        byIndustry: { trading: { followUp: { defaultDurationDays: 10 } } },
      },
    };
    db.industry_types = [{ id: TRADING, code: 'TRADING' }, { id: FMCG, code: 'fmcg' }];
    const snapshot = await loadSettingsSnapshot(ORG);
    expect(snapshot.industryTypeIds.sort()).toEqual([FMCG, TRADING].sort());
    expect(snapshot.followUp(TRADING).defaultDurationDays).toBe(10);
    expect(snapshot.followUp(FMCG).defaultDurationDays).toBe(3);
    expect(snapshot.followUp(null).defaultDurationDays).toBe(3);
  });
});
