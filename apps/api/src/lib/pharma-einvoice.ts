// Builds the NIC e-invoice (IRP) JSON, schema version 1.1, from a pharma GST invoice so it can be uploaded to the IRP / a GSP.
// This does NOT generate the IRN or QR code: that needs your GSP / IRP credentials. `missing` lists data the IRP will reject for.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dmy = (iso: unknown) => { const d = s(iso).slice(0, 10); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''; };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const stateCode = (gstin: unknown) => (GSTIN.test(s(gstin)) ? s(gstin).slice(0, 2) : '');
const pin = (v: unknown) => { const p = s(v).replace(/\s/g, ''); return /^\d{6}$/.test(p) ? Number(p) : null; };

export function buildEInvoice(inv: Row, company: Row, client: Row): { payload: Row; missing: string[]; warnings: string[] } {
  const missing: string[] = []; const warnings: string[] = [];
  const need = (ok: unknown, what: string) => { if (!ok) missing.push(what); };
  const sellerState = stateCode(company.gstin); const buyerState = stateCode(client.gstin);
  need(GSTIN.test(s(company.gstin)), 'Your GSTIN (Company & GST) is missing or not a valid 15-character GSTIN');
  need(GSTIN.test(s(client.gstin)), `${s(client.client_name) || 'Customer'}: valid GSTIN (e-invoice is for B2B sales; without a GSTIN this invoice is B2C and is not reported to the IRP)`);
  const sellerPin = pin(company.pincode ?? company.pin_code); const buyerPin = pin(client.pincode ?? client.pin_code ?? client.zip_code);
  need(sellerPin, 'Your PIN code (6 digits) is not stored in Company & GST');
  need(buyerPin, `${s(client.client_name) || 'Customer'}: PIN code (6 digits) is not stored`);
  need(s(company.address), 'Your address (Company & GST)'); need(s(client.address), `${s(client.client_name) || 'Customer'}: address`);
  const lines = ((inv.lines ?? []) as Row[]);
  const items = lines.map((l, i) => {
    const qty = n(l.quantity); const rate = n(l.rate); const gross = r2(qty * rate); const taxable = r2(n(l.taxable_value));
    const cg = r2(n(l.cgst)); const sg = r2(n(l.sgst)); const ig = r2(n(l.igst));
    need(s(l.hsn_code), `HSN code for ${s(l.product_name)}`);
    const b = ((l.batches ?? []) as Row[])[0];
    return {
      SlNo: String(i + 1), PrdDesc: s(l.product_name), IsServc: 'N', HsnCd: s(l.hsn_code), Qty: qty, FreeQty: n(l.free_quantity), Unit: 'NOS',
      UnitPrice: rate, TotAmt: gross, Discount: Math.max(0, r2(gross - taxable)), AssAmt: taxable, GstRt: n(l.gst_percent),
      IgstAmt: ig, CgstAmt: cg, SgstAmt: sg, TotItemVal: r2(taxable + cg + sg + ig),
      ...(b ? { BchDtls: { Nm: s(b.batch_number), ExpDt: dmy(b.expiry_date) } } : {}),
    };
  });
  const intra = String(inv.supply_type ?? '').startsWith('Intra');
  if (sellerState && buyerState && intra !== (sellerState === buyerState)) warnings.push('Supply type on the invoice does not match the GSTIN state codes. Check before uploading.');
  if (n(inv.total_amount) > 50000) warnings.push('Invoice value is above Rs 50,000: an e-way bill is needed to move these goods.');
  const payload = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: s(inv.invoice_number), Dt: dmy(inv.invoice_date) },
    SellerDtls: { Gstin: s(company.gstin), LglNm: s(company.company_name), Addr1: s(company.address).slice(0, 100), Loc: s(company.city) || s(company.state), Pin: sellerPin, Stcd: sellerState },
    BuyerDtls: { Gstin: s(client.gstin), LglNm: s(client.client_name), Pos: buyerState || sellerState, Addr1: s(client.address).slice(0, 100), Loc: s(client.city) || s(client.state), Pin: buyerPin, Stcd: buyerState },
    ItemList: items,
    ValDtls: { AssVal: r2(n(inv.taxable_amount)), CgstVal: r2(n(inv.cgst_amount)), SgstVal: r2(n(inv.sgst_amount)), IgstVal: r2(n(inv.igst_amount)), RndOffAmt: r2(n(inv.round_off)), TotInvVal: r2(n(inv.total_amount)) },
  };
  return { payload, missing, warnings };
}