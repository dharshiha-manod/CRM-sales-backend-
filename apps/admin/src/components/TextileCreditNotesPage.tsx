// FILE: admin/src/components/TextileCreditNotesPage.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile > GST Credit Notes. A credit note is raised by itself when a delivered roll is returned (Sales order > Rolls > Return).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const card: React.CSSProperties = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e2dc)', borderRadius: 12, padding: 16, marginTop: 16 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--text-muted, #6b6b6b)', borderBottom: '1px solid var(--border, #e5e2dc)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderBottom: '1px solid var(--border, #f0eee9)', verticalAlign: 'middle' };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border, #d6d2c9)', background: 'transparent', cursor: 'pointer', fontSize: 13 };
const btnMain: React.CSSProperties = { ...btn, background: 'var(--accent, #1f6f4a)', borderColor: 'var(--accent, #1f6f4a)', color: '#fff' };

function printNote(n: Row, company: Row | null) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const lines = (n.lines ?? []) as Row[];
  const client = Array.isArray(n.clients) ? n.clients[0] : n.clients;
  w.document.write(`<html><head><title>${esc(n.note_number)}</title><style>
    body{font-family:Arial,sans-serif;padding:28px;color:#111} h2{margin:0} table{width:100%;border-collapse:collapse;margin-top:14px}
    th,td{border:1px solid #bbb;padding:6px 8px;font-size:13px;text-align:left} .r{text-align:right} .m{color:#555;font-size:13px}
  </style></head><body>
    <h2>${esc(company?.company_name ?? 'Credit Note')}</h2>
    <div class="m">${esc(company?.address ?? '')} ${esc(company?.city ?? '')} ${esc(company?.state ?? '')}<br/>GSTIN: ${esc(company?.gstin ?? '-')}</div>
    <h3>GST CREDIT NOTE</h3>
    <div class="m">Credit note no: <b>${esc(n.note_number)}</b> &nbsp; Date: <b>${esc(n.note_date)}</b><br/>
    Against invoice: <b>${esc(n.invoice_number)}</b> &nbsp; Order: ${esc(n.sale_orders?.order_number ?? '')}<br/>
    Customer: <b>${esc(client?.client_name ?? '')}</b><br/>Supply: ${esc(n.supply_type ?? '')}<br/>Reason: ${esc(n.reason ?? '')}</div>
    <table><tr><th>Item</th><th>HSN</th><th class="r">Qty (m)</th><th class="r">Taxable</th><th class="r">GST %</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th></tr>
    ${lines.map((l) => `<tr><td>${esc(l.product_name)}</td><td>${esc(l.hsn_code ?? '')}</td><td class="r">${esc(l.quantity)}</td><td class="r">${esc(l.taxable_value)}</td><td class="r">${esc(l.gst_percent)}</td><td class="r">${esc(l.cgst)}</td><td class="r">${esc(l.sgst)}</td><td class="r">${esc(l.igst)}</td></tr>`).join('')}
    </table>
    <h3 class="r">Total credit: ${esc(money(n.total_amount))}</h3>
    <script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
}

export function TextileCreditNotesPage() {
  const { activeIndustryTypeId: it } = useIndustryScope();
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, setPending] = useState(0);
  const [company, setCompany] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!it) return;
    const q = `industryTypeId=${encodeURIComponent(it)}`;
    try {
      const [r, c] = await Promise.all([api<{ data: Row[]; pending: number }>(`/textile/credit-notes?${q}`), api<{ data: Row | null }>(`/textile/company-profile?${q}`).catch(() => ({ data: null }))]);
      setRows(r.data ?? []); setPending(r.pending ?? 0); setCompany(c.data); setErr('');
    } catch (e) { setErr(msgOf(e)); }
  }, [it]);
  useEffect(() => { void load(); }, [load]);

  async function issueMissing() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api<{ data: { issued: number; failed: string[] } }>('/textile/credit-notes/issue-missing', { method: 'POST', body: JSON.stringify({ industryTypeId: it }) });
      setMsg(`${r.data.issued} credit note(s) issued.${r.data.failed.length ? ` Not issued: ${r.data.failed.join(' ')}` : ''}`);
      await load();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  }

  const total = rows.filter((n) => n.status === 'Issued').reduce((t, n) => t + Number(n.total_amount || 0), 0);
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TEXTILE · GST CREDIT NOTES</p>
          <h2>GST credit notes</h2>
          <p>Raised automatically when a delivered roll is returned. The customer's credit and the GST both follow the original invoice.</p>
        </div>
        {pending > 0 && <button type="button" style={btnMain} disabled={busy} onClick={() => void issueMissing()}>Issue {pending} missing credit note{pending === 1 ? '' : 's'}</button>}
      </div>
      {err && <p className="error-message">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Credit notes</div><div style={{ fontSize: 26, fontWeight: 700 }}>{rows.length}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Total credited</div><div style={{ fontSize: 26, fontWeight: 700 }}>{money(total)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Waiting to be issued</div><div style={{ fontSize: 26, fontWeight: 700, color: pending ? '#b26a00' : 'inherit' }}>{pending}</div></div>
      </div>
      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Credit note</th><th style={th}>Date</th><th style={th}>Customer</th><th style={th}>Invoice</th><th style={th}>Order</th><th style={th}>Taxable</th><th style={th}>GST</th><th style={th}>Total</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map((n) => {
              const c = Array.isArray(n.clients) ? n.clients[0] : n.clients;
              return (
                <tr key={n.id}>
                  <td style={td}><strong>{n.note_number}</strong></td><td style={td}>{n.note_date}</td><td style={td}>{c?.client_name}</td><td style={td}>{n.invoice_number}</td>
                  <td style={td}>{(Array.isArray(n.sale_orders) ? n.sale_orders[0] : n.sale_orders)?.order_number}</td>
                  <td style={td}>{money(n.taxable_amount)}</td><td style={td}>{money(Number(n.cgst_amount) + Number(n.sgst_amount) + Number(n.igst_amount))}</td>
                  <td style={td}><strong>{money(n.total_amount)}</strong></td>
                  <td style={td}><button type="button" style={btn} onClick={() => printNote(n, company)}>Print</button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td style={td} colSpan={9}>No credit notes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}