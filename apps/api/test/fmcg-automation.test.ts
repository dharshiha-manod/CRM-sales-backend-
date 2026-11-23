import { describe, expect, it } from 'vitest';
import { classifyScheme, poLateDays } from '../src/lib/fmcg-automation-rules.js';

const TODAY = '2026-11-23';
describe('FMCG scheme health', () => {
  it('an active scheme that ended yesterday is expired', () => {
    expect(classifyScheme({ status: 'active', end_date: '2026-11-22' }, TODAY).health).toBe('expired');
  });
  it('a scheme ending today is NOT expired yet (it still runs today)', () => {
    const r = classifyScheme({ status: 'active', end_date: '2026-11-23' }, TODAY);
    expect(r.health).toBe('ending_soon'); expect(r.daysLeft).toBe(0);
  });
  it('ending within 7 days is flagged, 8+ days is ok', () => {
    expect(classifyScheme({ status: 'active', end_date: '2026-11-30' }, TODAY).health).toBe('ending_soon');
    expect(classifyScheme({ status: 'active', end_date: '2026-12-01' }, TODAY).health).toBe('ok');
  });
  it('an inactive scheme is never re-judged', () => {
    expect(classifyScheme({ status: 'inactive', end_date: '2020-01-01' }, TODAY).health).toBe('inactive');
  });
  it('a scheme that starts in the future is upcoming', () => {
    expect(classifyScheme({ status: 'active', start_date: '2026-12-10' }, TODAY).health).toBe('upcoming');
  });
  it('the old open-ended Diwali scheme is flagged stale after 45 days, a plain one only after 90', () => {
    expect(classifyScheme({ status: 'active', name: 'Diwali Dhamaka', created_at: '2026-09-01T00:00:00Z' }, TODAY).health).toBe('stale');
    expect(classifyScheme({ status: 'active', name: 'Biscuit combo', created_at: '2026-09-01T00:00:00Z' }, TODAY).health).toBe('ok');
    expect(classifyScheme({ status: 'active', name: 'Biscuit combo', created_at: '2026-06-01T00:00:00Z' }, TODAY).health).toBe('stale');
  });
  it('a new open-ended Diwali scheme is fine', () => {
    expect(classifyScheme({ status: 'active', name: 'Diwali Dhamaka', created_at: '2026-11-10T00:00:00Z' }, TODAY).health).toBe('ok');
  });
});
describe('late purchase orders', () => {
  it('counts days past the expected date for open orders only', () => {
    expect(poLateDays({ status: 'Ordered', expected_date: '2026-11-20' }, TODAY)).toBe(3);
    expect(poLateDays({ status: 'Received', expected_date: '2026-11-01' }, TODAY)).toBe(0);
    expect(poLateDays({ status: 'Ordered', expected_date: '2026-11-23' }, TODAY)).toBe(0);
    expect(poLateDays({ status: 'Draft', expected_date: '2026-11-01' }, TODAY)).toBe(0);
    expect(poLateDays({ status: 'Ordered', expected_date: null }, TODAY)).toBe(0);
  });
});