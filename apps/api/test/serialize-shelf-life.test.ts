import { describe, expect, it } from 'vitest';
import { serialized } from '../src/lib/serialize.js';
import { tooShortShelfLife } from '../src/lib/pharma-rules.js';

describe('serialized', () => {
  it('runs same-key jobs one at a time, in order', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number) => serialized('po-1', async () => { log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`); });
    await Promise.all([job('a', 30), job('b', 1), job('c', 1)]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });
  it('does not block different keys and survives a failing job', async () => {
    await expect(serialized('x', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(serialized('x', async () => 5)).resolves.toBe(5);
  });
});

describe('tooShortShelfLife', () => {
  const T = '2026-11-04';
  it('is off when the minimum is 0 (only expired stock is caught elsewhere)', () => expect(tooShortShelfLife('2026-11-05', 0, T)).toBe(false));
  it('blocks stock expiring within the minimum days', () => {
    expect(tooShortShelfLife('2027-01-03', 60, T)).toBe(true);  // 60 days left
    expect(tooShortShelfLife('2027-01-04', 60, T)).toBe(false); // 61 days left
  });
});