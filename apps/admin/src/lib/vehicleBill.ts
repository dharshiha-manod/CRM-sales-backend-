// Printable service bill, built from /vehicle/service-records/:id/bill. It is a service bill, not a GST tax invoice.
type Obj = Record<string, unknown>;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const money = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

export interface ServiceBillData {
  service: Obj; client: Obj | null; unit: Obj | null;
  partLines: { code: string; name: string; qty: number; rate: number; amount: number }[]; partsTotal: number; labour: number; total: number;
}

export function openServiceBill(d: ServiceBillData): void {
  const s = d.service, u = d.unit ?? {}, c = d.client ?? {};
  const row = (k: string, v: unknown) => `<tr><th>${esc(k)}</th><td>${esc(v) || '—'}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Service bill ${esc(s.service_number)}</title>
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#111}h1{margin:0 0 4px}h2{margin:24px 0 8px;font-size:15px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}th{background:#f5f5f5}.r{text-align:right}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print / Save as PDF</button>
<h1>Service Bill</h1><div>${esc(s.service_number)} · ${esc(s.service_date)}</div>
<h2>Customer</h2><table>${row('Name', c.client_name || s.client_name)}${row('Phone', c.phone)}${row('Email', c.email)}${row('Address', c.address)}</table>
<h2>Vehicle</h2><table>${row('Model', [u.model_name, u.variant].filter(Boolean).join(' '))}${row('VIN', s.vin)}${row('Registration number', s.registration_number || u.registration_number)}${row('Odometer', s.odometer)}${row('Service type', s.service_type)}${row('Workshop / advisor', [s.workshop, s.service_advisor].filter(Boolean).join(' / '))}</table>
${s.complaint ? `<h2>Complaint</h2><p>${esc(s.complaint)}</p>` : ''}${s.resolution ? `<h2>Work done</h2><p>${esc(s.resolution)}</p>` : ''}
<h2>Charges</h2><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>
${d.partLines.map((l) => `<tr><td>${esc(l.name)} (${esc(l.code)})</td><td class="r">${l.qty}</td><td class="r">${money(l.rate)}</td><td class="r">${money(l.amount)}</td></tr>`).join('')}
<tr><td colspan="3">Parts total</td><td class="r">${money(d.partsTotal)}</td></tr><tr><td colspan="3">Labour</td><td class="r">${money(d.labour)}</td></tr>
<tr><th colspan="3">Total</th><th class="r">${money(d.total)}</th></tr></table>
<p style="margin-top:12px;color:#555">This is a service bill, not a GST tax invoice.</p>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { window.alert('Allow pop-ups to open the service bill.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
