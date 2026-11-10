import { describe, expect, it } from 'vitest';
import { invoiceTotals, isGstin, isIntraState, splitGst } from '../src/lib/textile-invoice-math.js';
import { buildEWayBill } from '../src/lib/textile-eway.js';

describe('textile GST split', () => {
  it('splits intra-state tax into equal CGST and SGST', () => expect(splitGst(1000, 5, true)).toEqual({ cgst: 25, sgst: 25, igst: 0, tax: 50 }));
  it('keeps odd paise on SGST so CGST + SGST equals the tax', () => { const g = splitGst(33.3, 5, true); expect(g.cgst + g.sgst).toBeCloseTo(g.tax, 2); });
  it('charges inter-state tax as IGST only', () => expect(splitGst(1000, 12, false)).toEqual({ cgst: 0, sgst: 0, igst: 120, tax: 120 }));
  it('charges nothing at 0%', () => expect(splitGst(1000, 0, true).tax).toBe(0));
});

describe('textile supply type', () => {
  it('is intra-state when both GSTINs start with the same state code', () => expect(isIntraState({ gstin: '33AABCM1234F1Z4' }, { gstin: '33AAACX1111A1Z5' })).toBe(true));
  it('is inter-state when the state codes differ', () => expect(isIntraState({ gstin: '33AABCM1234F1Z4' }, { gstin: '27AAACX1111A1Z5' })).toBe(false));
  it('falls back to the state name when a GSTIN is missing', () => expect(isIntraState({ gstin: '33AABCM1234F1Z4', state: 'Tamil Nadu' }, { state: 'tamil nadu' })).toBe(true));
  it('cannot decide without GSTIN or state', () => expect(isIntraState({}, {})).toBeNull());
  it('validates GSTIN format', () => { expect(isGstin('33AABCM1234F1Z4')).toBe(true); expect(isGstin('123')).toBe(false); });
});

describe('textile invoice totals', () => {
  it('rounds the invoice to whole rupees and records the round-off', () => {
    const t = invoiceTotals([{ taxable_value: 1000.4, cgst: 25.01, sgst: 25.01, igst: 0 }]);
    expect(t.total_amount).toBe(1050); expect(t.round_off).toBeCloseTo(-0.42, 2); expect(t.taxable_amount).toBe(1000.4);
  });
});

describe('e-way bill JSON', () => {
  const company = { gstin: '33AABCM1234F1Z4', company_name: 'ABC Textiles', address: '1 Main Rd', city: 'Nagercoil', state: 'Tamil Nadu', pincode: '629001' };
  const client = { gstin: '33AAACX1111A1Z5', client_name: 'XYZ Garments', address: '5 Mill St', city: 'Tiruppur', pincode: '641601' };
  const inv = { invoice_number: 'INV-2627-0001', invoice_date: '2026-11-10', taxable_amount: 100000, cgst_amount: 2500, sgst_amount: 2500, igst_amount: 0, total_amount: 105000,
    vehicle_number: 'TN75AB1234', transport_distance_km: 120, transport_mode: 'Road',
    lines: [{ product_name: 'Cotton 40s', colour: 'Red', hsn_code: '5208', quantity: 1000, free_quantity: 0, taxable_value: 100000, gst_percent: 5, cgst: 2500, sgst: 2500, igst: 0 }] };
  it('builds a complete bill with nothing missing', () => {
    const r = buildEWayBill(inv, company, client);
    expect(r.missing).toEqual([]);
    const b = r.payload.billLists[0];
    expect(b.docNo).toBe('INV-2627-0001'); expect(b.docDate).toBe('10/11/2026'); expect(b.itemList[0].qtyUnit).toBe('MTR'); expect(b.itemList[0].cgstRate).toBe(2.5); expect(b.totInvValue).toBe(105000);
  });
  it('lists what is missing: HSN, distance, vehicle', () => {
    const r = buildEWayBill({ ...inv, transport_distance_km: null, vehicle_number: null, lines: [{ ...inv.lines[0], hsn_code: null }] }, company, client);
    expect(r.missing.join(' ')).toMatch(/HSN/); expect(r.missing.join(' ')).toMatch(/distance/i); expect(r.missing.join(' ')).toMatch(/Vehicle/);
  });
  it('uses URP for a customer without GSTIN', () => expect(buildEWayBill(inv, company, { ...client, gstin: null }).payload.billLists[0].toGstin).toBe('URP'));
  it('uses IGST rates for inter-state lines', () => {
    const l = { ...inv.lines[0], cgst: 0, sgst: 0, igst: 5000 };
    expect(buildEWayBill({ ...inv, lines: [l] }, company, client).payload.billLists[0].itemList[0].igstRate).toBe(5);
  });
});
