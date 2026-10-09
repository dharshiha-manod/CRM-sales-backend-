import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: () => ({}) } }));
vi.mock('../src/repositories/products.repository.js', () => ({ changeProductStock: vi.fn() }));

import { addDays, autoBatchNo } from '../src/repositories/product-batches.repository.js';

describe('expiry from manufacturing date + shelf life', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-08', 180)).toBe('2027-04-06');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('automatic batch number', () => {
  it('uses product code, manufacturing day and a running number', () => {
    expect(autoBatchNo('BEV-DAIR-761', '2026-10-08', [])).toBe('BEV-DAIR-761-261008-01');
  });
  it('moves to the next number when that day already has batches', () => {
    expect(autoBatchNo('BEV-DAIR-761', '2026-10-08', ['BEV-DAIR-761-261008-01', 'T-OK'])).toBe('BEV-DAIR-761-261008-02');
  });
  it('falls back to today when no manufacturing date is given', () => {
    expect(autoBatchNo('P1', null, [], '2026-10-08')).toBe('P1-261008-01');
  });
});
