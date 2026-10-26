import { describe, expect, it } from 'vitest';
import { applySchoolPricingToOrder, schoolRuleFor, schoolStamp, type SchoolContext } from '../src/lib/school.js';

const ctx: SchoolContext = {
  industryTypeId: 'school-1',
  period: { academic_year_id: 'ay-1', term_id: 'term-2' },
  rules: [
    { id: 'r1', product_id: 'p1', discount_type: 'percentage', discount_percent: 10, fixed_price: null, min_quantity: 0 },
    { id: 'r2', product_id: 'p1', discount_type: 'percentage', discount_percent: 15, fixed_price: null, min_quantity: 100 },
    { id: 'r3', product_id: 'p2', discount_type: 'fixed_price', discount_percent: null, fixed_price: 540, min_quantity: 0 },
  ],
};

describe('school pricing rules', () => {
  it('picks the highest minimum-quantity tier that is reached', () => {
    expect(schoolRuleFor(ctx, 'p1', 50, 1000)?.id).toBe('r1');
    expect(schoolRuleFor(ctx, 'p1', 100, 1000)?.id).toBe('r2');
  });
  it('returns null for another product or when there is no context (non-school)', () => {
    expect(schoolRuleFor(ctx, 'p9', 10, 100)).toBeNull();
    expect(schoolRuleFor(null, 'p1', 10, 100)).toBeNull();
  });
  it('stamps the academic year and term only for a school context', () => {
    expect(schoolStamp(ctx)).toEqual({ academic_year_id: 'ay-1', term_id: 'term-2' });
    expect(schoolStamp(null)).toEqual({});
    expect(schoolStamp({ ...ctx, period: null })).toEqual({});
  });
  it('leaves a non-school order completely untouched (same objects back)', () => {
    const items = [{ productId: 'p1', quantity: 5, discountPercent: 0 }];
    const products = new Map([['p1', { id: 'p1', selling_price: 100 }]]);
    const out = applySchoolPricingToOrder(null, items, products);
    expect(out.items).toBe(items);
    expect(out.productById).toBe(products);
  });
  it('turns a percentage rule into the line discount, but a typed discount still wins', () => {
    const products = new Map([['p1', { id: 'p1', selling_price: 100 }]]);
    expect(applySchoolPricingToOrder(ctx, [{ productId: 'p1', quantity: 5, discountPercent: 0 }], products).items[0].discountPercent).toBe(10);
    expect(applySchoolPricingToOrder(ctx, [{ productId: 'p1', quantity: 5, discountPercent: 3 }], products).items[0].discountPercent).toBe(3);
  });
  it('replaces the catalog price for a fixed-price rule without mutating the original map', () => {
    const products = new Map([['p2', { id: 'p2', selling_price: 620 }]]);
    const out = applySchoolPricingToOrder(ctx, [{ productId: 'p2', quantity: 2, discountPercent: 0 }], products);
    expect(out.productById.get('p2')?.selling_price).toBe(540);
    expect(products.get('p2')?.selling_price).toBe(620);
  });
});
