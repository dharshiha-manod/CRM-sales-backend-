import { describe, expect, it } from 'vitest';
import { amountInCurrency, sumInCurrency } from '../src/lib/currency-sum.js';

// The real example from the Logistics page: USD 5,000 freight + USD 500 other charges, rate 96.5, company currency INR.
const logistics = { currency: 'USD', exchange_rate: 96.5, base_currency: 'INR', freight_cost: 5000, other_charges: 500 };

describe('sumInCurrency', () => {
  it('converts a USD row into INR with the stored rate', () => {
    expect(sumInCurrency([logistics], 'freight_cost', 'INR')).toBe(482500);
    expect(sumInCurrency([logistics], 'other_charges', 'INR')).toBe(48250);
  });
  it('freight + other charges = 5,30,750 in INR', () => {
    const total = (sumInCurrency([logistics], 'freight_cost', 'INR') ?? 0) + (sumInCurrency([logistics], 'other_charges', 'INR') ?? 0);
    expect(total).toBe(530750);
  });
  it('leaves a row alone when it is already in the report currency', () => {
    expect(sumInCurrency([logistics], 'freight_cost', 'USD')).toBe(5000);
    expect(amountInCurrency({ currency: 'INR', freight_cost: 1200 }, 'freight_cost', 'INR')).toBe(1200);
  });
  it('treats a row with no currency as already in the report currency', () => {
    expect(amountInCurrency({ freight_cost: 700 }, 'freight_cost', 'INR')).toBe(700);
  });
  it('keeps the amount as entered when there is no usable rate (never invents a number)', () => {
    expect(amountInCurrency({ currency: 'USD', freight_cost: 5000 }, 'freight_cost', 'INR')).toBe(5000);
    expect(amountInCurrency({ currency: 'USD', exchange_rate: 0, base_currency: 'INR', freight_cost: 5000 }, 'freight_cost', 'INR')).toBe(5000);
  });
  it('freight uses the stored base_value (what the Logistics page shows); other charges use amount x rate', () => {
    const row = { currency: 'USD', exchange_rate: 96.5, base_currency: 'INR', freight_cost: 3000, other_charges: 300, base_value: 289500 };
    expect(amountInCurrency(row, 'freight_cost', 'INR')).toBe(289500);
    expect(amountInCurrency(row, 'other_charges', 'INR')).toBe(28950);
  });
  it('converts customs duty and port charges the same way (deal in INR, customs bill in USD)', () => {
    const customs = { currency: 'USD', exchange_rate: 96.5, base_currency: 'INR', customs_duty: 100, other_charges: 10 };
    expect(sumInCurrency([customs], 'customs_duty', 'INR')).toBe(9650);
    expect(sumInCurrency([customs], 'other_charges', 'INR')).toBe(965);
  });
  it('a USD deal keeps USD-priced costs in USD (costs and revenue stay in the same currency)', () => {
    const row = { currency: 'USD', exchange_rate: 96.5, base_currency: 'INR', freight_cost: 3000, other_charges: 300, base_value: 289500 };
    expect(amountInCurrency(row, 'freight_cost', 'USD')).toBe(3000);
    expect(amountInCurrency(row, 'other_charges', 'USD')).toBe(300);
  });
  it('adds several rows and returns null when nothing is recorded', () => {
    expect(sumInCurrency([logistics, { currency: 'INR', freight_cost: 1000 }], 'freight_cost', 'INR')).toBe(483500);
    expect(sumInCurrency([{ currency: 'USD' }], 'freight_cost', 'INR')).toBeNull();
    expect(sumInCurrency([], 'freight_cost', 'INR')).toBeNull();
  });
});