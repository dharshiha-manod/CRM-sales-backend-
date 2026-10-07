import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
import { bestSchemeFor, evaluateScheme, type LiveScheme } from '../src/lib/fmcg-schemes.js';

const base = { discount_percent: null, discount_amount: null, buy_quantity: null, free_quantity: null, slabs: [], product_ids: ['p1'] };
const pct: LiveScheme = { ...base, id: 's-pct', name: '10% off', scheme_type: 'percentage', discount_percent: 10 };
const flat: LiveScheme = { ...base, id: 's-flat', name: 'Rs 5 off', scheme_type: 'flat_amount', discount_amount: 5 };
const bxgy: LiveScheme = { ...base, id: 's-bxgy', name: 'Buy 10 get 1', scheme_type: 'buy_x_get_y', buy_quantity: 10, free_quantity: 1 };
const slab: LiveScheme = { ...base, id: 's-slab', name: 'Slabs', scheme_type: 'slab', slabs: [{ minQuantity: 10, discountPercent: 2 }, { minQuantity: 50, discountPercent: 5 }] };

describe('evaluateScheme', () => {
  it('percentage takes a percent off the line', () => expect(evaluateScheme(pct, 10, 100)).toEqual({ discountAmount: 100, freeQuantity: 0 }));
  it('flat amount is INR off per unit, converted to the document currency', () => {
    expect(evaluateScheme(flat, 10, 100)).toEqual({ discountAmount: 50, freeQuantity: 0 });
    expect(evaluateScheme(flat, 10, 2, 83)).toEqual({ discountAmount: 0.6, freeQuantity: 0 }); // INR 5 = USD 0.06 per unit
  });
  it('flat amount can never push the line below zero', () => expect(evaluateScheme(flat, 2, 3).discountAmount).toBe(6));
  it('buy X get Y gives whole free sets as extra units, price unchanged', () => {
    expect(evaluateScheme(bxgy, 25, 100)).toEqual({ discountAmount: 0, freeQuantity: 2 });
    expect(evaluateScheme(bxgy, 9, 100).freeQuantity).toBe(0);
  });
  it('slab uses the highest slab reached', () => {
    expect(evaluateScheme(slab, 9, 100).discountAmount).toBe(0);
    expect(evaluateScheme(slab, 10, 100).discountAmount).toBe(20);
    expect(evaluateScheme(slab, 60, 100).discountAmount).toBe(300);
  });
});

describe('bestSchemeFor', () => {
  it('ignores schemes not assigned to the product', () => expect(bestSchemeFor([pct], 'other', 10, 100)).toBeNull());
  it('picks the scheme worth the most (free units valued at the unit price)', () => {
    const bxgy5: LiveScheme = { ...bxgy, id: 's-bxgy5', buy_quantity: 5, free_quantity: 1 }; // 1 free per 5 = about 20%
    expect(bestSchemeFor([pct, bxgy5], 'p1', 10, 100)?.schemeId).toBe('s-bxgy5');            // 200 of free goods beats 100 off
    expect(bestSchemeFor([pct, bxgy], 'p1', 10, 100)?.schemeId).toBe('s-pct');               // equal value: the first scheme wins
  });
  it('reports the equivalent percent so quotation lines display consistently', () => expect(bestSchemeFor([pct], 'p1', 4, 50)).toMatchObject({ discountAmount: 20, discountPercent: 10, freeQuantity: 0 }));
  it('returns null when nothing is worth anything', () => expect(bestSchemeFor([slab], 'p1', 5, 100)).toBeNull());
});