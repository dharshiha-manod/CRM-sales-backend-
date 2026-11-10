import { describe, expect, it } from 'vitest';
import { invoiceFigures } from '../src/lib/vehicle-invoice.js';

describe('invoiceFigures', () => {
  it('divides the model line by its quantity and shares the order tax by value', () => {
    // 2 cars (net 980000 after 20000 discount) + 1 accessory (net 20000); order tax 54000
    const lines = [{ product_id: 'car', quantity: 2, subtotal: 980000, discount_amount: 20000 }, { product_id: 'acc', quantity: 1, subtotal: 20000, discount_amount: 0 }];
    const f = invoiceFigures({ total_amount: 1054000, tax_amount: 54000 }, lines, 'car', 2);
    expect(f.subtotal).toBe(500000);
    expect(f.discount_amount).toBe(10000);
    expect(f.tax_amount).toBe(26460);
    expect(f.total_amount).toBe(516460);
  });
  it('falls back to splitting the order total by the number of vehicles', () => {
    const f = invoiceFigures({ total_amount: 1000000, tax_amount: 100000 }, [], null, 2);
    expect(f).toEqual({ subtotal: 450000, discount_amount: 0, tax_amount: 50000, total_amount: 500000 });
  });
  it('never divides by zero', () => {
    expect(invoiceFigures({ total_amount: 0, tax_amount: 0 }, [], null, 0).total_amount).toBe(0);
  });
});