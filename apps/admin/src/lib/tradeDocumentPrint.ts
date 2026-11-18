// FILE: admin/src/lib/tradeDocumentPrint.ts
// Builds a printable Commercial Invoice / Packing List / etc. from a Trade Document record.
// Opens a print window: the user picks "Save as PDF", then uploads that file back to the document.
// No extra npm package needed.
import { formatMoney } from './currencyFormat';

type Rec = Record<string, unknown>;

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const text = (v: unknown, fallback = '—'): string => {
  const s = String(v ?? '').trim();
  return s ? esc(s) : fallback;
};

// Packing-style documents list goods and quantity only - never prices.
const NO_PRICE_TYPES = ['Packing List', 'Delivery Note'];
const PRICED_TYPES = ['Commercial Invoice', 'Proforma Invoice', 'Sales Order', 'Purchase Order'];

export function printTradeDocument(r: Rec): void {
  const type = String(r.document_type ?? 'Document');
  const showPrice = !NO_PRICE_TYPES.includes(type);
  const currency = String(r.currency ?? '').trim();
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
  const qty = Number(r.quantity);
  const price = r.unit_price;
  const total = r.total_value;
  // An empty price must show a dash, never a made-up zero.
  const money = (v: unknown) => (has(v) && Number.isFinite(Number(v)) ? formatMoney(Number(v), currency || undefined) : '—');
  const unit = text(r.unit, '');
  const isTrade = PRICED_TYPES.includes(type) || NO_PRICE_TYPES.includes(type);
  const buyerLabel = type === 'Purchase Order' ? 'Supplier' : 'Buyer / Consignee';
  const buyerName = type === 'Purchase Order' ? r.supplier_name : r.customer_name;

  const itemRow = `
    <tr>
      <td>1</td>
      <td>${text(r.product_name)}</td>
      <td class="num">${Number.isFinite(qty) ? esc(qty.toLocaleString('en-IN')) : '—'} ${unit}</td>
      ${showPrice ? `<td class="num">${money(price)}</td><td class="num">${money(total)}</td>` : ''}
    </tr>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(type)} ${esc(r.document_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 32px; font-size: 13px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: .5px; text-transform: uppercase; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .meta { text-align: right; line-height: 1.6; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .box { border: 1px solid #bbb; padding: 10px 12px; border-radius: 4px; min-height: 84px; line-height: 1.5; }
  .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #555; letter-spacing: .6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #bbb; padding: 8px 10px; text-align: left; }
  th { background: #f1f1f1; font-size: 12px; }
  .num { text-align: right; white-space: nowrap; }
  .total td { font-weight: bold; background: #fafafa; }
  .sign { display: flex; justify-content: space-between; margin-top: 70px; }
  .sign div { width: 40%; border-top: 1px solid #111; padding-top: 6px; text-align: center; font-size: 12px; }
  .note { margin-top: 14px; font-size: 12px; color: #444; }
  .draft { margin-top: 20px; font-size: 11px; color: #888; text-align: center; }
  @media print { body { padding: 18px; } }
</style></head>
<body>
  <div class="head">
    <div>
      <h1>${esc(type)}</h1>
      <div>${text(r.issued_by, 'Issued by: —')}</div>
    </div>
    <div class="meta">
      <div><strong>No:</strong> ${text(r.document_number)}</div>
      <div><strong>Date:</strong> ${text(r.issue_date)}</div>
      ${r.deal_number ? `<div><strong>Deal:</strong> ${text(r.deal_number)}</div>` : ''}
      ${r.shipment_number ? `<div><strong>Shipment:</strong> ${text(r.shipment_number)}</div>` : ''}
      ${r.reference_number ? `<div><strong>Ref:</strong> ${text(r.reference_number)}</div>` : ''}
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <h3>${buyerLabel}</h3>
      <strong>${text(buyerName)}</strong><br>
      ${r.contact_person ? `Attn: ${text(r.contact_person)}<br>` : ''}
      ${text(r.billing_address, '')}
    </div>
    <div class="box">
      <h3>Ship to / delivery</h3>
      ${text(r.shipping_address, '—')}
      ${r.expected_delivery_date ? `<br>Expected delivery: ${text(r.expected_delivery_date)}` : ''}
    </div>
  </div>

  ${isTrade ? `
  <table>
    <thead><tr>
      <th style="width:40px">#</th><th>Description of goods</th><th class="num">Quantity</th>
      ${showPrice ? `<th class="num">Unit price</th><th class="num">Amount</th>` : ''}
    </tr></thead>
    <tbody>${itemRow}</tbody>
    ${showPrice ? `<tfoot><tr class="total"><td colspan="4" class="num">Total ${currency ? '(' + esc(currency) + ')' : ''}</td><td class="num">${money(total)}</td></tr></tfoot>` : ''}
  </table>
  ${showPrice && r.tax_details ? `<div class="note"><strong>Tax:</strong> ${text(r.tax_details)}</div>` : ''}
  ` : `<div class="box"><h3>Details</h3>${text(r.product_name)}</div>`}

  <div class="grid" style="margin-top:14px">
    <div class="box">
      <h3>Transport</h3>
      Mode: ${text(r.shipping_mode)}<br>
      Carrier: ${text(r.transporter)}<br>
      Tracking / BL no: ${text(r.tracking_number)}
    </div>
    <div class="box">
      <h3>Remarks</h3>
      ${text(r.notes, '—')}
    </div>
  </div>

  <div class="sign"><div>Prepared by</div><div>Authorised signatory</div></div>
  <div class="draft">System generated from trade data. Review before use.</div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Please allow pop-ups for this site to download the PDF.');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}