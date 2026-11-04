import { describe, expect, it } from 'vitest';
import { financialYear, todayLocal } from '../src/lib/ist-date.js';
import { buildEInvoice } from '../src/lib/pharma-einvoice.js';

describe('IST date', () => {
  it('after 18:30 UTC it is already the next day in India', () => {
    expect(todayLocal(Date.parse('2026-11-03T20:00:00Z'))).toBe('2026-11-04');
    expect(todayLocal(Date.parse('2026-11-03T12:00:00Z'))).toBe('2026-11-03');
  });
});
describe('financial year', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2026-11-04')).toBe('2026-27');
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });
});
describe('e-invoice json', () => {
  const company = { gstin: '33ABCDE1234F1Z5', company_name: 'Sri Pharma', address: '1 Main Rd', state: 'Tamil Nadu', pincode: '629001' };
  const client = { gstin: '33ZZZZZ9999Z1Z1', client_name: 'City Hospital', address: '2 Hospital Rd', city: 'Nagercoil', pincode: '629002' };
  const inv = { invoice_number: 'INV-2026-27-0001', invoice_date: '2026-11-04', supply_type: 'Intra-State (CGST + SGST)', taxable_amount: 100, cgst_amount: 6, sgst_amount: 6, igst_amount: 0, round_off: 0, total_amount: 112,
    lines: [{ product_name: 'Para 500', hsn_code: '3004', quantity: 10, free_quantity: 0, rate: 10, taxable_value: 100, gst_percent: 12, cgst: 6, sgst: 6, igst: 0, batches: [{ batch_number: 'B1', expiry_date: '2027-05-31' }] }] };
  it('maps a complete invoice with nothing missing', () => {
    const r = buildEInvoice(inv, company, client);
    expect(r.missing).toEqual([]);
    expect(r.payload.DocDtls).toEqual({ Typ: 'INV', No: 'INV-2026-27-0001', Dt: '04/11/2026' });
    expect(r.payload.ItemList[0].TotItemVal).toBe(112);
    expect(r.payload.ItemList[0].BchDtls).toEqual({ Nm: 'B1', ExpDt: '31/05/2027' });
  });
  it('lists what the IRP would reject', () => {
    const r = buildEInvoice(inv, { ...company, pincode: '' }, { ...client, gstin: '' });
    expect(r.missing.length).toBe(2);
  });
  it('warns about e-way bill above 50,000', () => expect(buildEInvoice({ ...inv, total_amount: 60000 }, company, client).warnings.join()).toMatch(/e-way/));
});