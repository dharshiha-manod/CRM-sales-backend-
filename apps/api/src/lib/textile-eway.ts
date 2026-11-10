// Builds the e-way bill JSON (NIC bulk-upload format) and the e-invoice JSON for a Textile GST invoice.
// This does NOT generate the e-way bill number or IRN: upload the file on the e-way bill / IRP portal (or give it to your GSP).
// `missing` lists data the portal will reject; `warnings` are things to check first.
import { buildEInvoice } from './pharma-einvoice.js';
import { isGstin } from './textile-invoice-math.js';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dmy = (iso: unknown) => { const d = s(iso).slice(0, 10); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''; };
const pin = (v: unknown) => { const p = s(v).replace(/\s/g, ''); return /^\d{6}$/.test(p) ? Number(p) : null; };
const stateCode = (g: unknown) => (isGstin(g) ? s(g).toUpperCase().slice(0, 2) : '');
const MODE: Record<string, string> = { Road: '1', Rail: '2', Air: '3', Ship: '4' };
export const EWAY_LIMIT = 50000;

export function buildEWayBill(inv: Row, company: Row, client: Row): { payload: Row; missing: string[]; warnings: string[] } {
  const missing: string[] = []; const warnings: string[] = [];
  const need = (ok: unknown, what: string) => { if (!ok) missing.push(what); };
  const sellerState = stateCode(company.gstin);
  const buyerGstin = isGstin(client.gstin) ? s(client.gstin).toUpperCase() : 'URP'; // URP = unregistered person
  const buyerState = stateCode(client.gstin) || sellerState;
  need(isGstin(company.gstin), 'Your GSTIN (Company & GST) is missing or not valid');
  const sellerPin = pin(company.pincode); const buyerPin = pin(client.pincode ?? client.pin_code ?? client.zip_code);
  need(sellerPin, 'Your PIN code (Company & GST)'); need(buyerPin, `${s(client.client_name) || 'Customer'}: PIN code (6 digits)`);
  need(s(company.address), 'Your address (Company & GST)'); need(s(client.address), `${s(client.client_name) || 'Customer'}: address`);
  need(n(inv.transport_distance_km) > 0, 'Approximate distance in km (Transport details)');
  need(s(inv.vehicle_number) || s(inv.transporter_gstin) , 'Vehicle number or transporter GSTIN (Transport details)');
  if (isGstin(client.gstin) === false) warnings.push('Customer has no valid GSTIN: the bill is raised against an unregistered person (URP).');
  const lines = (inv.lines ?? []) as Row[];
  const items = lines.map((l) => {
    need(s(l.hsn_code), `HSN code for ${s(l.product_name)}`);
    const rate = n(l.gst_percent);
    const intra = n(l.igst) === 0;
    return {
      productName: s(l.product_name), productDesc: [s(l.product_name), s(l.colour)].filter(Boolean).join(' - '), hsnCode: Number(s(l.hsn_code)) || s(l.hsn_code),
      quantity: n(l.quantity) + n(l.free_quantity), qtyUnit: 'MTR', taxableAmount: r2(n(l.taxable_value)),
      sgstRate: intra ? rate / 2 : 0, cgstRate: intra ? rate / 2 : 0, igstRate: intra ? 0 : rate, cessRate: 0, cessNonadvol: 0,
    };
  });
  if (n(inv.total_amount) <= EWAY_LIMIT) warnings.push(`Invoice value is Rs ${EWAY_LIMIT.toLocaleString('en-IN')} or less: an e-way bill is usually not required (some states need one for inter-state movement of fabric).`);
  const payload = {
    version: '1.0.0621',
    billLists: [{
      userGstin: s(company.gstin), supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: 'INV', docNo: s(inv.invoice_number), docDate: dmy(inv.invoice_date),
      fromGstin: s(company.gstin), fromTrdName: s(company.company_name), fromAddr1: s(company.address).slice(0, 120), fromAddr2: '', fromPlace: s(company.city) || s(company.state),
      fromPincode: sellerPin, actFromStateCode: Number(sellerState) || 0, fromStateCode: Number(sellerState) || 0,
      toGstin: buyerGstin, toTrdName: s(client.client_name), toAddr1: s(client.address).slice(0, 120), toAddr2: '', toPlace: s(client.city) || s(client.state),
      toPincode: buyerPin, actToStateCode: Number(buyerState) || 0, toStateCode: Number(buyerState) || 0,
      transactionType: 1, otherValue: 0,
      totalValue: r2(n(inv.taxable_amount)), cgstValue: r2(n(inv.cgst_amount)), sgstValue: r2(n(inv.sgst_amount)), igstValue: r2(n(inv.igst_amount)),
      cessValue: 0, cessNonAdvolValue: 0, totInvValue: r2(n(inv.total_amount)),
      transMode: MODE[s(inv.transport_mode)] ?? '1', transDistance: String(Math.round(n(inv.transport_distance_km))),
      transporterId: s(inv.transporter_gstin), transporterName: s(inv.transporter_name), transDocNo: s(inv.lr_number), transDocDate: dmy(inv.lr_date),
      vehicleNo: s(inv.vehicle_number).replace(/\s|-/g, '').toUpperCase(), vehicleType: 'R',
      itemList: items,
    }],
  };
  return { payload, missing, warnings };
}

/** E-invoice (IRP) JSON: the shared builder, with the textile unit (metres) instead of NOS. */
export function buildTextileEInvoice(inv: Row, company: Row, client: Row) {
  const out = buildEInvoice(inv, company, client);
  const list = (out.payload.ItemList ?? []) as Row[];
  for (const item of list) item.Unit = 'MTR';
  return out;
}
