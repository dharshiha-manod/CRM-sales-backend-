import { describe, expect, it } from 'vitest';
import { parseLabourAmount, parsePartsUsed, schemeCredit, stageFor } from '../src/lib/vehicle-calc.js';

describe('parsePartsUsed', () => {
  it('reads code and quantity in common shapes and adds repeated codes', () => {
    expect(parsePartsUsed('BRK-001 x 2\nOIL-5W30 4\nFLT-1\nBRK-001 * 1')).toEqual([{ code: 'BRK-001', qty: 3 }, { code: 'OIL-5W30', qty: 4 }, { code: 'FLT-1', qty: 1 }]);
  });
  it('ignores blank and zero lines', () => { expect(parsePartsUsed('\n\nA-1 x 0')).toEqual([]); });
});
describe('parseLabourAmount', () => {
  it('finds the number in text', () => { expect(parseLabourAmount('₹1,500 labour')).toBe(1500); expect(parseLabourAmount('')).toBe(0); });
});
describe('schemeCredit', () => {
  it('adds cash discount, exchange bonus and a fixed discount', () => { expect(schemeCredit({ status: 'Active', discount_type: 'Fixed Amount', discount_value: 10000, cash_discount: 5000, exchange_bonus: 2000 }, 800000)).toBe(17000); });
  it('takes a percentage of the order total', () => { expect(schemeCredit({ status: 'Active', discount_type: 'Percentage', discount_value: 2 }, 500000)).toBe(10000); });
  it('never exceeds the total and ignores suspended / draft schemes', () => {
    expect(schemeCredit({ status: 'Active', cash_discount: 900 }, 500)).toBe(500);
    expect(schemeCredit({ status: 'Suspended', cash_discount: 900 }, 5000)).toBe(0);
  });
});
describe('stageFor', () => {
  it('follows PDI, then documents, then payment', () => {
    expect(stageFor({})).toBe('Preparation');
    expect(stageFor({ vin: 'V1' })).toBe('PDI Pending');
    expect(stageFor({ vin: 'V1', pdi_status: 'Passed' })).toBe('Documentation Pending');
    expect(stageFor({ vin: 'V1', pdi_status: 'Passed', documentation_status: 'Complete' })).toBe('Payment Pending');
    expect(stageFor({ vin: 'V1', pdi_status: 'Passed', documentation_status: 'Complete', payment_status: 'Complete' })).toBe('Ready for Delivery');
  });
});
