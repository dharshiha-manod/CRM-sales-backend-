import { describe, expect, it } from 'vitest';
import { creditRisk } from '../src/lib/fmcg-credit.js';

describe('FMCG credit risk', () => {
  it('overdue always blocks, even with no limit or plenty of room', () => {
    expect(creditRisk(null, 0, 500)).toBe('blocked');
    expect(creditRisk(100000, 1000, 1)).toBe('blocked');
  });
  it('no limit set and nothing overdue', () => { expect(creditRisk(null, 50000, 0)).toBe('no_limit'); });
  it('over the limit', () => { expect(creditRisk(10000, 10001, 0)).toBe('over_limit'); });
  it('exactly at the limit is near the limit, not over', () => { expect(creditRisk(10000, 10000, 0)).toBe('near_limit'); });
  it('80% or more used is near the limit', () => {
    expect(creditRisk(10000, 8000, 0)).toBe('near_limit');
    expect(creditRisk(10000, 7999, 0)).toBe('ok');
  });
  it('a zero limit with nothing owed is fine, with something owed it is over', () => {
    expect(creditRisk(0, 0, 0)).toBe('ok');
    expect(creditRisk(0, 10, 0)).toBe('over_limit');
  });
});