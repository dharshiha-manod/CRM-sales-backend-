// FILE: admin/src/components/TextileReturnsRefundsPage.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile > Returns & Refunds. Supplier side: send rolls to the mill (challan) -> supplier accepts (full/partial) or rejects -> GST debit note for the accepted metres -> refund received.
// Customer side: refund paid to the customer when they paid more than the order is worth after return credit.
// (Customer returns themselves are raised from the sales order: whole roll in Rolls, part of a cut in Cut fabric.)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const MODES = ['Bank Transfer', 'UPI', 'Cheque', 'Cash', 'Other'];
const CUSTOMER_MODES: Record<string, string> = { 'Bank Transfer': 'bank_transfer', UPI: 'upi', Cheque: 'cheque', Cash: 'cash', Other: 'other' };

const card: React.CSSProperties = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e2dc)', borderRadius: 12, padding: 16, marginTop: 16 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, padding: '8px 10px', color: 'var(--text-muted, #6b6b6b)', borderBottom: '1px solid var(--border, #e5e2dc)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '8px 10px', fontSize: 14, borderBottom: '1px solid var(--border, #f0eee9)', verticalAlign: 'middle' };
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border, #d6d2c9)', background: 'transparent', cursor: 'pointer', fontSize: 13 };
const btnMain: React.CSSProperties = { ...btn, background: 'var(--accent, #1f6f4a)', borderColor: 'var(--accent, #1f6f4a)', color: '#fff' };
const tab = (on: boolean): React.CSSProperties => ({ ...btn, borderRadius: 999, background: on ? 'var(--accent, #1f6f4a)' : 'transparent', color: on ? '#fff' : 'inherit', borderColor: on ? 'var(--accent, #1f6f4a)' : 'var(--border, #d6d2c9)' });
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const full: React.CSSProperties = { width: '100%' };
const STATUS_COLOUR: Record<string, string> = { Sent: '#b26a00', Accepted: '#1f6f4a', Posted: '#1f6f4a', Rejected: '#b3261e', Cancelled: '#6b6b6b' };
const badge = (s: string): React.CSSProperties => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: STATUS_COLOUR[s] ?? '#444', border: `1px solid ${STATUS_COLOUR[s] ?? '#bbb'}` });

function printDebitNote(n: Row) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const lines = (n.lines ?? []) as Row[];
  const sup = Array.isArray(n.textile_suppliers) ? n.textile_suppliers[0] : n.textile_suppliers;
  w.document.write(`<html><head><title>${esc(n.note_number)}</title><style>
    body{font-family:Arial,sans-serif;padding:28px;color:#111} table{width:100%;border-collapse:collapse;margin-top:14px}
    th,td{border:1px solid #bbb;padding:6px 8px;font-size:13px;text-align:left} .r{text-align:right} .m{color:#555;font-size:13px}
  </style></head><body>
    <h3>GST DEBIT NOTE (purchase return)</h3>
    <div class="m">Debit note no: <b>${esc(n.note_number)}</b> &nbsp; Date: <b>${esc(n.note_date)}</b><br/>
    Against goods receipt: <b>${esc(n.grn_number)}</b> &nbsp; Return: ${esc(n.return_number)}<br/>
    Supplier: <b>${esc(sup?.supplier_name ?? '')}</b> &nbsp; GSTIN: ${esc(sup?.gstin ?? '-')}<br/>Supply: ${esc(n.supply_type ?? '')}<br/>Reason: ${esc(n.reason ?? '')}</div>
    <table><tr><th>Roll</th><th>Item</th><th>HSN</th><th class="r">Metres</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST %</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th></tr>
    ${lines.map((l) => `<tr><td>${esc(l.roll_number)}</td><td>${esc(l.product_name)}${l.colour ? ` (${esc(l.colour)})` : ''}</td><td>${esc(l.hsn_code ?? '')}</td><td class="r">${esc(l.metres)}</td><td class="r">${esc(l.rate)}</td><td class="r">${esc(l.taxable_value)}</td><td class="r">${esc(l.gst_percent)}</td><td class="r">${esc(l.cgst)}</td><td class="r">${esc(l.sgst)}</td><td class="r">${esc(l.igst)}</td></tr>`).join('')}
    </table>
    <h3 class="r">Total debit: ${esc(money(n.total_amount))}</h3>
    <script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
}

/** Return challan: goes with the rolls to the supplier. Shows what was sent (no GST debit note yet). */
function printChallan(r: Row, supplier?: Row) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  const lines = (r.lines ?? []) as Row[];
  const sup = supplier ?? (Array.isArray(r.textile_suppliers) ? r.textile_suppliers[0] : r.textile_suppliers);
  const totalM = r2(lines.reduce((t, l) => t + Number(l.metres || 0), 0));
  w.document.write(`<html><head><title>${esc(r.return_number)}</title><style>
    body{font-family:Arial,sans-serif;padding:28px;color:#111} table{width:100%;border-collapse:collapse;margin-top:14px}
    th,td{border:1px solid #bbb;padding:6px 8px;font-size:13px;text-align:left} .r{text-align:right} .m{color:#555;font-size:13px}
    .sign{display:flex;justify-content:space-between;margin-top:60px;font-size:13px}
  </style></head><body>
    <h3>RETURN CHALLAN (goods returned to supplier)</h3>
    <div class="m">Challan no: <b>${esc(r.return_number)}</b> &nbsp; Date: <b>${esc(r.return_date)}</b><br/>
    Against goods receipt: <b>${esc(r.grn_number)}</b><br/>
    Supplier: <b>${esc(sup?.supplier_name ?? '')}</b> &nbsp; GSTIN: ${esc(sup?.gstin ?? '-')}<br/>Reason: ${esc(r.reason ?? '')}</div>
    <table><tr><th>Roll</th><th>Item</th><th>HSN</th><th class="r">Metres</th><th class="r">Rate</th><th class="r">Value (excl. GST)</th></tr>
    ${lines.map((l) => `<tr><td>${esc(l.roll_number)}</td><td>${esc(l.product_name)}${l.colour ? ` (${esc(l.colour)})` : ''}</td><td>${esc(l.hsn_code ?? '')}</td><td class="r">${esc(l.metres)}</td><td class="r">${esc(l.rate)}</td><td class="r">${esc(l.taxable_value)}</td></tr>`).join('')}
    </table>
    <h3 class="r">Total: ${esc(totalM)} m</h3>
    <p class="m">The GST debit note will be issued for the quantity accepted by the supplier.</p>
    <div class="sign"><span>Sent by: ____________</span><span>Received by supplier: ____________</span></div>
    <script>window.onload=function(){window.print();}</script></body></html>`);
  w.document.close();
}

type TabKey = 'returns' | 'debit' | 'refunds' | 'customer';

export function TextileReturnsRefundsPage() {
  const { activeIndustryTypeId: it } = useIndustryScope();
  const [tabKey, setTabKey] = useState<TabKey>('returns');
  const [returns, setReturns] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Row[]>([]);
  const [refunds, setRefunds] = useState<Row[]>([]);
  const [credit, setCredit] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [pending, setPending] = useState<Row[]>([]);
  const [custRefunds, setCustRefunds] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [retForm, setRetForm] = useState<Row | null>(null);
  const [accForm, setAccForm] = useState<Row | null>(null);
  const [options, setOptions] = useState<Row[]>([]);
  const [refForm, setRefForm] = useState<Row | null>(null);
  const [custForm, setCustForm] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!it) return;
    const q = `industryTypeId=${encodeURIComponent(it)}`;
    try {
      const [a, b, c, d, e, f, g, h] = await Promise.all([
        api<{ data: Row[] }>(`/textile/supplier-returns?${q}`), api<{ data: Row[] }>(`/textile/debit-notes?${q}`), api<{ data: Row[] }>(`/textile/supplier-refunds?${q}`),
        api<{ data: Row[] }>(`/textile/supplier-credit?${q}`), api<{ data: Row[] }>(`/textile/suppliers?${q}`), api<{ data: Row[] }>(`/textile/customer-refunds/pending?${q}`),
        api<{ data: Row[] }>(`/textile/customer-refunds?${q}`), api<{ data: Row[] }>(`/textile/supplier-returns/options?${q}`),
      ]);
      setReturns(a.data ?? []); setNotes(b.data ?? []); setRefunds(c.data ?? []); setCredit(d.data ?? []); setSuppliers(e.data ?? []);
      setPending(f.data ?? []); setCustRefunds(g.data ?? []); setCandidates((h.data ?? []).filter((x) => x.suggested)); setErr('');
    } catch (x) { setErr(msgOf(x)); }
  }, [it]);
  useEffect(() => { void load(); }, [load]);

  // ---------------------------------------------------------------- supplier return: step 1 (send)
  async function openReturn(supplierId = '', rollIds: string[] = []) {
    setMsg(''); setErr('');
    setRetForm({ supplier_id: supplierId, grn_id: '', reason: '', return_date: today(), picks: {} as Record<string, string> });
    setOptions([]);
    if (supplierId) await pickSupplier(supplierId, rollIds);
  }
  async function pickSupplier(supplierId: string, preselect: string[] = []) {
    setRetForm((f) => (f ? { ...f, supplier_id: supplierId, grn_id: '', picks: {} } : f));
    setOptions([]);
    if (!supplierId || !it) return;
    try {
      const r = await api<{ data: Row[] }>(`/textile/supplier-returns/options?industryTypeId=${encodeURIComponent(it)}&supplierId=${encodeURIComponent(supplierId)}`);
      const rows = r.data ?? []; setOptions(rows);
      if (preselect.length) {
        const first = rows.find((x) => preselect.includes(x.roll_id));
        const picks: Record<string, string> = {};
        for (const x of rows) if (preselect.includes(x.roll_id) && x.grn_id === first?.grn_id) picks[x.roll_id] = String(x.available);
        setRetForm((f) => (f ? { ...f, supplier_id: supplierId, grn_id: first?.grn_id ?? '', picks } : f));
      }
    } catch (x) { setErr(msgOf(x)); }
  }
  const grnChoices = useMemo(() => {
    const m = new Map<string, Row>();
    for (const o of options) if (!m.has(o.grn_id)) m.set(o.grn_id, o);
    return [...m.values()];
  }, [options]);
  const rollsOfGrn = options.filter((o) => retForm && o.grn_id === retForm.grn_id);
  const estimate = useMemo(() => {
    if (!retForm) return 0;
    return r2(rollsOfGrn.reduce((t, o) => { const m = Number(retForm.picks[o.roll_id] || 0); return m > 0 ? t + m * o.rate * (1 + o.gst_percent / 100) : t; }, 0));
  }, [retForm, rollsOfGrn]);

  async function saveReturn() {
    if (!retForm) return;
    const lines = Object.entries(retForm.picks as Record<string, string>).filter(([, m]) => Number(m) > 0).map(([roll_id, m]) => ({ roll_id, metres: Number(m) }));
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api<{ data: Row }>('/textile/supplier-returns', { method: 'POST', body: JSON.stringify({ supplier_id: retForm.supplier_id, grn_id: retForm.grn_id, reason: retForm.reason, return_date: retForm.return_date, lines, industryTypeId: it }) });
      setMsg(`Return ${r.data.return_number} sent to the supplier. The metres left the roll. Print the challan from the list. The debit note is issued once the supplier accepts.`); setRetForm(null); await load();
    } catch (x) { setErr(msgOf(x)); } finally { setBusy(false); }
  }

  // ---------------------------------------------------------------- supplier return: step 2 (accept / reject)
  function openAccept(r: Row) {
    setMsg(''); setErr('');
    const picks: Record<string, string> = {};
    for (const l of (r.lines ?? []) as Row[]) picks[l.roll_id] = String(l.metres);
    setAccForm({ ret: r, picks, accepted_date: today() });
  }
  const accEstimate = useMemo(() => {
    if (!accForm) return 0;
    return r2(((accForm.ret.lines ?? []) as Row[]).reduce((t, l) => { const m = Number(accForm.picks[l.roll_id] || 0); return m > 0 ? t + m * Number(l.rate) * (1 + Number(l.gst_percent) / 100) : t; }, 0));
  }, [accForm]);
  async function saveAccept() {
    if (!accForm) return;
    const lines = ((accForm.ret.lines ?? []) as Row[]).map((l) => ({ roll_id: l.roll_id, accepted_metres: Number(accForm.picks[l.roll_id] || 0) }));
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api<{ data: Row }>(`/textile/supplier-returns/${accForm.ret.id}/accept`, { method: 'POST', body: JSON.stringify({ lines, accepted_date: accForm.accepted_date }) });
      setMsg(`${r.data.return_number} accepted. Debit note ${r.data.debit_note_number} issued. Metres the supplier did not take are back on the roll.`); setAccForm(null); await load();
    } catch (x) { setErr(msgOf(x)); } finally { setBusy(false); }
  }
  async function rejectReturn(r: Row) {
    const reason = window.prompt(`Supplier rejected ${r.return_number}? All metres go back on the rolls and no debit note is issued. Enter the reason:`);
    if (!reason) return;
    try { await api(`/textile/supplier-returns/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${r.return_number} rejected. The metres are back on the rolls.`); await load(); }
    catch (x) { setErr(msgOf(x)); }
  }
  async function cancelReturn(r: Row) {
    const reason = window.prompt(`Cancel return ${r.return_number}? The metres go back on the rolls${r.debit_note_number ? ' and the debit note is cancelled' : ''}. Enter a reason:`);
    if (!reason) return;
    try { await api(`/textile/supplier-returns/${r.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${r.return_number} cancelled.`); await load(); }
    catch (x) { setErr(msgOf(x)); }
  }

  // ---------------------------------------------------------------- refunds from suppliers
  async function saveRefund() {
    if (!refForm) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api<{ data: Row }>('/textile/supplier-refunds', { method: 'POST', body: JSON.stringify({ ...refForm, amount: Number(refForm.amount), industryTypeId: it }) });
      setMsg(`Refund ${r.data.refund_number} recorded.`); setRefForm(null); await load();
    } catch (x) { setErr(msgOf(x)); } finally { setBusy(false); }
  }
  async function cancelRefund(r: Row) {
    const reason = window.prompt(`Cancel refund ${r.refund_number}? Enter a reason:`);
    if (!reason) return;
    try { await api(`/textile/supplier-refunds/${r.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMsg(`${r.refund_number} cancelled.`); await load(); }
    catch (x) { setErr(msgOf(x)); }
  }

  // ---------------------------------------------------------------- refunds to customers
  async function saveCustomerRefund() {
    if (!custForm) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await api('/textile/customer-refunds', { method: 'POST', body: JSON.stringify({ orderId: custForm.order_id, amount: Number(custForm.amount), mode: CUSTOMER_MODES[custForm.mode] ?? 'other', referenceNo: custForm.reference_no || null, notes: custForm.notes || null }) });
      setMsg(`Refund of ${money(custForm.amount)} recorded for ${custForm.client_name}.`); setCustForm(null); await load();
    } catch (x) { setErr(msgOf(x)); } finally { setBusy(false); }
  }

  const owed = credit.reduce((t, c) => t + Number(c.credit || 0), 0);
  const dueCustomers = pending.reduce((t, c) => t + Number(c.due || 0), 0);
  const debited = notes.filter((n) => n.status === 'Issued').reduce((t, n) => t + Number(n.total_amount || 0), 0);
  const waiting = returns.filter((r) => r.status === 'Sent');
  const waitingValue = waiting.reduce((t, r) => t + Number(r.total_amount || 0), 0);

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TEXTILE · RETURNS & REFUNDS</p>
          <h2>Returns & refunds</h2>
          <p>Send fabric back to the mill with a challan. The GST debit note is issued for the metres the supplier accepts. Then collect the refund and pay customers back what they overpaid after a return.</p>
        </div>
        <button type="button" style={btnMain} onClick={() => void openReturn()}>New supplier return</button>
      </div>
      {err && <p className="error-message">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Waiting for supplier</div><div style={{ fontSize: 26, fontWeight: 700, color: waiting.length ? '#b26a00' : 'inherit' }}>{waiting.length}</div><div style={{ fontSize: 12, color: '#6b6b6b' }}>{waiting.length ? `${money(waitingValue)} sent, not yet accepted` : 'sent, not yet accepted'}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Debit notes issued</div><div style={{ fontSize: 26, fontWeight: 700 }}>{money(debited)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Mills owe you (refund)</div><div style={{ fontSize: 26, fontWeight: 700, color: owed ? '#b26a00' : 'inherit' }}>{money(owed)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>You owe customers (refund)</div><div style={{ fontSize: 26, fontWeight: 700, color: dueCustomers ? '#b3261e' : 'inherit' }}>{money(dueCustomers)}</div></div>
        <div style={{ ...card, marginTop: 0 }}><div style={{ fontSize: 12, textTransform: 'uppercase', color: '#6b6b6b' }}>Rolls to send back</div><div style={{ fontSize: 26, fontWeight: 700 }}>{candidates.length}</div><div style={{ fontSize: 12, color: '#6b6b6b' }}>damaged, quarantined or rejected</div></div>
      </div>

      {candidates.length > 0 && (
        <div style={{ ...card, borderColor: '#b26a00' }}>
          <strong>Suggested returns:</strong> these rolls came from a goods receipt and are damaged, in quarantine or graded Reject.
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Roll</th><th style={th}>Supplier</th><th style={th}>GRN</th><th style={th}>Colour</th><th style={th}>Status / grade</th><th style={th}>Metres</th><th style={th} /></tr></thead>
              <tbody>
                {candidates.slice(0, 8).map((c) => (
                  <tr key={c.roll_id}>
                    <td style={td}><strong>{c.roll_number}</strong></td><td style={td}>{suppliers.find((s) => s.id === c.supplier_id)?.supplier_name ?? '-'}</td><td style={td}>{c.grn_number}</td>
                    <td style={td}>{c.colour || '-'}</td><td style={td}>{c.status}{c.quality_grade ? ` / ${c.quality_grade}` : ''}</td><td style={td}>{c.available} m</td>
                    <td style={td}><button type="button" style={btn} onClick={() => void openReturn(c.supplier_id, [c.roll_id])}>Return to supplier</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button type="button" style={tab(tabKey === 'returns')} onClick={() => setTabKey('returns')}>Supplier returns{waiting.length ? ` (${waiting.length})` : ''}</button>
        <button type="button" style={tab(tabKey === 'debit')} onClick={() => setTabKey('debit')}>Debit notes</button>
        <button type="button" style={tab(tabKey === 'refunds')} onClick={() => setTabKey('refunds')}>Refunds from suppliers</button>
        <button type="button" style={tab(tabKey === 'customer')} onClick={() => setTabKey('customer')}>Refunds to customers{pending.length ? ` (${pending.length})` : ''}</button>
      </div>

      {tabKey === 'returns' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Return</th><th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>GRN</th><th style={th}>Rolls</th><th style={th}>Sent</th><th style={th}>Accepted</th><th style={th}>Debit note</th><th style={th}>Value</th><th style={th}>Status</th><th style={th} /></tr></thead>
            <tbody>
              {returns.map((r) => {
                const lines = (r.lines ?? []) as Row[]; const sup = Array.isArray(r.textile_suppliers) ? r.textile_suppliers[0] : r.textile_suppliers;
                const sent = r2(lines.reduce((t, l) => t + Number(l.metres || 0), 0));
                const acc = r.status === 'Accepted' ? r2(lines.reduce((t, l) => t + Number(l.accepted_metres || 0), 0)) : r.status === 'Posted' ? sent : null;
                const value = r.status === 'Accepted' ? r.accepted_amount : r.total_amount;
                return (
                  <tr key={r.id} style={{ opacity: r.status === 'Cancelled' ? 0.55 : 1 }} title={r.decision_note ? `${r.reason} | Supplier: ${r.decision_note}` : r.reason}>
                    <td style={td}><strong>{r.return_number}</strong></td><td style={td}>{r.return_date}</td><td style={td}>{sup?.supplier_name}</td><td style={td}>{r.grn_number}</td>
                    <td style={td}>{lines.map((l) => l.roll_number).join(', ')}</td><td style={td}>{sent} m</td><td style={td}>{acc === null ? '-' : `${acc} m`}</td>
                    <td style={td}>{r.debit_note_number || '-'}</td><td style={td}>{money(value)}</td><td style={td}><span style={badge(r.status)}>{r.status === 'Sent' ? 'Sent to supplier' : r.status}</span></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {r.status === 'Sent' && (
                        <>
                          <button type="button" style={btn} onClick={() => printChallan(r)}>Print challan</button>{' '}
                          <button type="button" style={btnMain} onClick={() => openAccept(r)}>Mark accepted</button>{' '}
                          <button type="button" style={btn} onClick={() => void rejectReturn(r)}>Mark rejected</button>{' '}
                          <button type="button" style={btn} onClick={() => void cancelReturn(r)}>Cancel</button>
                        </>
                      )}
                      {(r.status === 'Accepted' || r.status === 'Posted') && <button type="button" style={btn} onClick={() => void cancelReturn(r)}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
              {returns.length === 0 && <tr><td style={td} colSpan={11}>No supplier returns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tabKey === 'debit' && (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Debit note</th><th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>Against GRN</th><th style={th}>Taxable</th><th style={th}>GST</th><th style={th}>Total</th><th style={th}>Status</th><th style={th} /></tr></thead>
            <tbody>
              {notes.map((n) => {
                const sup = Array.isArray(n.textile_suppliers) ? n.textile_suppliers[0] : n.textile_suppliers;
                return (
                  <tr key={n.id} style={{ opacity: n.status === 'Cancelled' ? 0.55 : 1 }}>
                    <td style={td}><strong>{n.note_number}</strong></td><td style={td}>{n.note_date}</td><td style={td}>{sup?.supplier_name}</td><td style={td}>{n.grn_number}</td>
                    <td style={td}>{money(n.taxable_amount)}</td><td style={td}>{money(Number(n.cgst_amount) + Number(n.sgst_amount) + Number(n.igst_amount))}</td><td style={td}><strong>{money(n.total_amount)}</strong></td>
                    <td style={td}>{n.status}</td><td style={td}><button type="button" style={btn} onClick={() => printDebitNote(n)}>Print</button></td>
                  </tr>
                );
              })}
              {notes.length === 0 && <tr><td style={td} colSpan={9}>No debit notes yet. One is issued when the supplier accepts a return.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tabKey === 'refunds' && (
        <>
          <div style={card}>
            <strong>Money the mills owe you</strong>
            <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#6b6b6b' }}>A debit note first reduces the open bills of that mill. Only credit left after that (you had already paid) can be collected as a refund.</p>
            {credit.length === 0 ? <p style={{ margin: 0 }}>No mill owes you a refund.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Supplier / mill</th><th style={th}>Credit to collect</th><th style={th} /></tr></thead>
                <tbody>{credit.map((c) => (
                  <tr key={c.supplier_id}><td style={td}><strong>{c.supplier_name}</strong></td><td style={td}>{money(c.credit)}</td>
                    <td style={td}><button type="button" style={btnMain} onClick={() => setRefForm({ supplier_id: c.supplier_id, debit_note_id: '', amount: String(c.credit), mode: 'Bank Transfer', refund_date: today(), reference_no: '', notes: '' })}>Record refund received</button></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div style={{ ...card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Refund</th><th style={th}>Date</th><th style={th}>Supplier</th><th style={th}>Debit note</th><th style={th}>Mode</th><th style={th}>Reference</th><th style={th}>Amount</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {refunds.map((r) => {
                  const sup = Array.isArray(r.textile_suppliers) ? r.textile_suppliers[0] : r.textile_suppliers; const dn = Array.isArray(r.textile_debit_notes) ? r.textile_debit_notes[0] : r.textile_debit_notes;
                  return (
                    <tr key={r.id} style={{ opacity: r.status === 'Cancelled' ? 0.55 : 1 }}>
                      <td style={td}><strong>{r.refund_number}</strong></td><td style={td}>{r.refund_date}</td><td style={td}>{sup?.supplier_name}</td><td style={td}>{dn?.note_number ?? '-'}</td>
                      <td style={td}>{r.mode}</td><td style={td}>{r.reference_no || '-'}</td><td style={td}>{money(r.amount)}</td><td style={td}>{r.status}</td>
                      <td style={td}>{r.status === 'Received' && <button type="button" style={btn} onClick={() => void cancelRefund(r)}>Cancel</button>}</td>
                    </tr>
                  );
                })}
                {refunds.length === 0 && <tr><td style={td} colSpan={9}>No refunds received yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tabKey === 'customer' && (
        <>
          <div style={card}>
            <strong>Customers to refund</strong>
            <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#6b6b6b' }}>The customer paid more than the order is worth after the credit for returned fabric. Orders with an unpaid balance are simply reduced by the credit note and need no refund.</p>
            {pending.length === 0 ? <p style={{ margin: 0 }}>No customer is waiting for a refund.</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Order</th><th style={th}>Customer</th><th style={th}>Order value</th><th style={th}>Paid</th><th style={th}>Return credit</th><th style={th}>Refunded</th><th style={th}>Refund due</th><th style={th} /></tr></thead>
                  <tbody>{pending.map((p) => (
                    <tr key={p.order_id}><td style={td}><strong>{p.order_number}</strong></td><td style={td}>{p.client_name}</td><td style={td}>{money(p.order_total)}</td><td style={td}>{money(p.collected)}</td><td style={td}>{money(p.credited)}</td><td style={td}>{money(p.refunded)}</td>
                      <td style={td}><strong>{money(p.due)}</strong></td>
                      <td style={td}><button type="button" style={btnMain} onClick={() => setCustForm({ ...p, amount: String(p.due), mode: 'Bank Transfer', reference_no: '', notes: '' })}>Refund</button></td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ ...card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Date</th><th style={th}>Customer</th><th style={th}>Order</th><th style={th}>Mode</th><th style={th}>Reference</th><th style={th}>Amount</th></tr></thead>
              <tbody>
                {custRefunds.map((r) => {
                  const cl = Array.isArray(r.clients) ? r.clients[0] : r.clients; const so = Array.isArray(r.sale_orders) ? r.sale_orders[0] : r.sale_orders;
                  return <tr key={r.id}><td style={td}>{String(r.created_at ?? '').slice(0, 10)}</td><td style={td}>{cl?.client_name}</td><td style={td}>{so?.order_number}</td><td style={td}>{r.mode}</td><td style={td}>{r.reference_no || '-'}</td><td style={td}>{money(r.amount)}</td></tr>;
                })}
                {custRefunds.length === 0 && <tr><td style={td} colSpan={6}>No customer refunds yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {retForm && (
        <div style={overlay} onClick={() => setRetForm(null)}>
          <div style={{ ...card, marginTop: 0, width: 760, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Return fabric to supplier</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <label>Supplier / mill
                <select style={full} value={retForm.supplier_id} onChange={(e) => void pickSupplier(e.target.value)}>
                  <option value="">Pick supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </label>
              <label>Goods receipt (GRN)
                <select style={full} value={retForm.grn_id} onChange={(e) => setRetForm({ ...retForm, grn_id: e.target.value, picks: {} })}>
                  <option value="">{retForm.supplier_id && !grnChoices.length ? 'No returnable rolls for this supplier' : 'Pick GRN'}</option>
                  {grnChoices.map((g) => <option key={g.grn_id} value={g.grn_id}>{g.grn_number} · {g.received_date}</option>)}
                </select>
              </label>
              <label>Return date<input style={full} type="date" value={retForm.return_date} onChange={(e) => setRetForm({ ...retForm, return_date: e.target.value })} /></label>
              <label>Reason<input style={full} value={retForm.reason} placeholder="Damaged, wrong shade, short length..." onChange={(e) => setRetForm({ ...retForm, reason: e.target.value })} /></label>
            </div>
            {retForm.grn_id && (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th} /><th style={th}>Roll</th><th style={th}>Colour</th><th style={th}>Status</th><th style={th}>On shelf</th><th style={th}>Rate</th><th style={th}>GST</th><th style={th}>Metres to return</th></tr></thead>
                  <tbody>
                    {rollsOfGrn.map((o) => {
                      const on = o.roll_id in retForm.picks;
                      return (
                        <tr key={o.roll_id} style={{ background: o.suggested ? 'rgba(178,106,0,.08)' : undefined }}>
                          <td style={td}><input type="checkbox" checked={on} onChange={(e) => { const picks = { ...retForm.picks }; if (e.target.checked) picks[o.roll_id] = String(o.available); else delete picks[o.roll_id]; setRetForm({ ...retForm, picks }); }} /></td>
                          <td style={td}><strong>{o.roll_number}</strong></td><td style={td}>{o.colour || '-'}</td><td style={td}>{o.status}{o.quality_grade ? ` / ${o.quality_grade}` : ''}</td>
                          <td style={td}>{o.available} m</td><td style={td}>{money(o.rate)}</td><td style={td}>{o.gst_percent}%</td>
                          <td style={td}>{on && <input style={{ width: 90 }} type="number" min={0} max={o.available} step="0.01" value={retForm.picks[o.roll_id]} onChange={(e) => setRetForm({ ...retForm, picks: { ...retForm.picks, [o.roll_id]: e.target.value } })} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={{ fontSize: 13, color: '#6b6b6b' }}>Value of the goods sent (with GST): <strong>{money(estimate)}</strong>. The metres leave the roll now. The debit note is issued only for what the supplier accepts. Only rolls that are not allocated to an order are listed.</p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={() => setRetForm(null)}>Close</button>
              <button type="button" style={btnMain} disabled={busy || !estimate} onClick={() => void saveReturn()}>Send to supplier</button>
            </div>
          </div>
        </div>
      )}

      {accForm && (
        <div style={overlay} onClick={() => setAccForm(null)}>
          <div style={{ ...card, marginTop: 0, width: 680, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Supplier accepted: {accForm.ret.return_number}</h3>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#6b6b6b' }}>Enter how many metres the supplier accepted for each roll (full or partial). The debit note is issued for these metres. The remaining metres go back on the roll.</p>
            <label style={{ display: 'block', maxWidth: 220 }}>Accepted date<input style={full} type="date" value={accForm.accepted_date} onChange={(e) => setAccForm({ ...accForm, accepted_date: e.target.value })} /></label>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Roll</th><th style={th}>Item</th><th style={th}>Sent</th><th style={th}>Rate</th><th style={th}>GST</th><th style={th}>Accepted metres</th></tr></thead>
                <tbody>
                  {((accForm.ret.lines ?? []) as Row[]).map((l) => (
                    <tr key={l.roll_id}>
                      <td style={td}><strong>{l.roll_number}</strong></td><td style={td}>{l.product_name ?? '-'}{l.colour ? ` (${l.colour})` : ''}</td><td style={td}>{l.metres} m</td><td style={td}>{money(l.rate)}</td><td style={td}>{l.gst_percent}%</td>
                      <td style={td}><input style={{ width: 100 }} type="number" min={0} max={l.metres} step="0.01" value={accForm.picks[l.roll_id]} onChange={(e) => setAccForm({ ...accForm, picks: { ...accForm.picks, [l.roll_id]: e.target.value } })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 13, color: '#6b6b6b' }}>Debit note value (with GST): <strong>{money(accEstimate)}</strong>. The supplier bill reduces by this amount.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={() => setAccForm(null)}>Close</button>
              <button type="button" style={btnMain} disabled={busy || !accEstimate} onClick={() => void saveAccept()}>Accept & issue debit note</button>
            </div>
          </div>
        </div>
      )}

      {refForm && (
        <div style={overlay} onClick={() => setRefForm(null)}>
          <div style={{ ...card, marginTop: 0, width: 440, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Refund received from supplier</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              <label>Supplier / mill<input style={full} disabled value={suppliers.find((s) => s.id === refForm.supplier_id)?.supplier_name ?? ''} /></label>
              <label>Against debit note (optional)
                <select style={full} value={refForm.debit_note_id} onChange={(e) => setRefForm({ ...refForm, debit_note_id: e.target.value })}>
                  <option value="">Not linked</option>{notes.filter((n) => n.supplier_id === refForm.supplier_id && n.status === 'Issued').map((n) => <option key={n.id} value={n.id}>{n.note_number} · {money(n.total_amount)}</option>)}
                </select>
              </label>
              <label>Amount<input style={full} type="number" min={0} value={refForm.amount} onChange={(e) => setRefForm({ ...refForm, amount: e.target.value })} /></label>
              <label>Mode<select style={full} value={refForm.mode} onChange={(e) => setRefForm({ ...refForm, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Date<input style={full} type="date" value={refForm.refund_date} onChange={(e) => setRefForm({ ...refForm, refund_date: e.target.value })} /></label>
              <label>Reference / UTR / cheque no.<input style={full} value={refForm.reference_no} onChange={(e) => setRefForm({ ...refForm, reference_no: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={() => setRefForm(null)}>Close</button>
              <button type="button" style={btnMain} disabled={busy} onClick={() => void saveRefund()}>Save refund</button>
            </div>
          </div>
        </div>
      )}

      {custForm && (
        <div style={overlay} onClick={() => setCustForm(null)}>
          <div style={{ ...card, marginTop: 0, width: 440, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Refund to customer</h3>
            <p style={{ margin: '0 0 8px', fontSize: 13 }}>{custForm.client_name} · order {custForm.order_number} · due {money(custForm.due)}</p>
            <div style={{ display: 'grid', gap: 10 }}>
              <label>Amount<input style={full} type="number" min={0} value={custForm.amount} onChange={(e) => setCustForm({ ...custForm, amount: e.target.value })} /></label>
              <label>Mode<select style={full} value={custForm.mode} onChange={(e) => setCustForm({ ...custForm, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Reference / UTR / cheque no.<input style={full} value={custForm.reference_no} onChange={(e) => setCustForm({ ...custForm, reference_no: e.target.value })} /></label>
              <label>Notes<input style={full} value={custForm.notes} onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button type="button" style={btn} onClick={() => setCustForm(null)}>Close</button>
              <button type="button" style={btnMain} disabled={busy} onClick={() => void saveCustomerRefund()}>Save refund</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}