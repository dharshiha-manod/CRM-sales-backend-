// Printable vehicle handover (delivery) note. Built in the browser from /vehicle/deliveries/:id/handover and opened in a
// new window so the user can print / save as PDF. It is a delivery note, not a tax invoice.
type Obj = Record<string, unknown>;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

export interface HandoverData {
  delivery: Obj; unit: Obj | null; model: Obj | null; clientName: string;
  order: { orderNumber: string; total: number } | null; paid: number;
  payments: { amount: number; mode: string; reference: string }[]; registration: Obj | null;
}

export function openHandoverNote(d: HandoverData): void {
  const del = d.delivery, u = d.unit ?? {}, m = d.model ?? {};
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v) || '—'}</td></tr>`;
  const balance = d.order ? Math.max(d.order.total - d.paid, 0) : 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Handover ${esc(del.delivery_number)}</title>
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{margin:0 0 4px}h2{margin:24px 0 8px;font-size:15px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}th{width:34%;background:#f5f5f5}
.sign{display:flex;gap:48px;margin-top:64px}.sign div{flex:1;border-top:1px solid #111;padding-top:6px}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print / Save as PDF</button>
<h1>Vehicle Handover Note</h1><div>${esc(del.delivery_number)} · ${esc(del.delivery_date || new Date().toISOString().slice(0, 10))}</div>
<h2>Customer</h2><table>${row('Name', d.clientName)}${row('Delivery location', del.delivery_location)}${row('Sales representative', del.sales_rep)}${row('Dealer', del.dealer_name)}</table>
<h2>Vehicle</h2><table>${row('Make / model / variant', [m.make, m.model_name, m.variant].filter(Boolean).join(' '))}${row('VIN', del.vin)}${row('Engine number', del.engine_number || u.engine_number)}${row('Colour', u.color)}${row('Odometer at delivery', del.odometer)}${row('Fuel level', del.fuel_level)}${row('Registration number', d.registration?.registration_number || u.registration_number)}${row('Warranty', m.warranty)}</table>
<h2>Checklist</h2><table>${row('PDI', del.pdi_status)}${row('Documentation', del.documentation_status)}${row('Payment', del.payment_status)}${row('Registration', del.registration_status)}${row('Insurance', del.insurance_status)}${row('Accessories', del.accessories_status)}${row('Customer acknowledgement', del.customer_acknowledgement)}</table>
<h2>Order &amp; payment</h2><table>${row('Core order', d.order?.orderNumber)}${row('Order total', d.order ? money(d.order.total) : '')}${row('Received (Collections)', money(d.paid))}${row('Balance', d.order ? money(balance) : '')}</table>
${d.payments.length ? `<table style="margin-top:8px"><tr><th>Mode</th><th>Reference</th><th>Amount</th></tr>${d.payments.map((p) => `<tr><td>${esc(p.mode)}</td><td>${esc(p.reference) || '—'}</td><td>${money(p.amount)}</td></tr>`).join('')}</table>` : ''}
${del.remarks ? `<h2>Remarks</h2><p>${esc(del.remarks)}</p>` : ''}
<div class="sign"><div>Customer signature</div><div>Authorised signatory</div></div></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { window.alert('Allow pop-ups to open the handover note.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
