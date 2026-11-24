import { describe, expect, it } from 'vitest';
import { cashShortfall, tripIsComplete } from '../src/lib/fmcg-trips.js';

describe('FMCG trip rules', () => {
  it('a trip completes only when every live stop is delivered', () => {
    expect(tripIsComplete(['delivered', 'delivered'])).toBe(true);
    expect(tripIsComplete(['delivered', 'dispatched'])).toBe(false);
    expect(tripIsComplete(['delivered', 'packed'])).toBe(false);
  });
  it('cancelled stops are ignored, and an empty trip never completes', () => {
    expect(tripIsComplete(['delivered', 'cancelled'])).toBe(true);
    expect(tripIsComplete(['cancelled'])).toBe(false);
    expect(tripIsComplete([])).toBe(false);
  });
  it('cash shortfall = expected COD - expenses - handed over (positive means short)', () => {
    expect(cashShortfall(10000, 500, 9500)).toBe(0);
    expect(cashShortfall(10000, 500, 9000)).toBe(500);
    expect(cashShortfall(10000, 0, 10200)).toBe(-200);
  });
  it('rounds to paise', () => { expect(cashShortfall(100.105, 0.1, 100)).toBe(0.01); });
});