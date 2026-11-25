/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useState } from 'react';
import { Chips, Kpis, Modal, PageShell, Pill, Row, day, esc, hint, isoToday, messageOf, money, num, openPrint, post, r2, useCompany, useRows } from './schoolUi';

// Purchase returns: goods sent back to a supplier against one posted goods receipt (GRN).
// Posting reduces stock immediately and reduces what we owe that supplier by the same GST-inclusive value.
// Cancelling puts the stock back. The server checks quantities (cannot return more than received, or stock already sold).

function printReturn(r: Row, company: Row | null) {
  const co = company ?? {}; const s = r.school_suppliers ?? {};
  const rows = ((r.lines ?? []) as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_code)} — ${esc(l.product_name)}</td><td class="r">${l.quantity}</td><td class="r">${num(l.rate).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${num(l.amount).toFixed(2)}</td></tr>`).join('');
  openPrint(r.return_number, `<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)}<br>GSTIN: ${esc(co.gstin)}</div><hr><h3>PURCHASE RETURN ${esc(r.return_number)}</h3>
<div class="cols"><div><b>Supplier:</b> ${esc(s.supplier_name)}<br><b>Against GRN:</b> ${esc(r.school_grns?.grn_number || '—')}</div><div><b>Date:</b> ${esc(r.return_date)}<br><b>Reason:</b> ${esc(r.reason)}</div></div>
<table><tr><th>#</th><th>Item</th><th>Qty returned</th><th>Rate</th><th>GST</th><th>Amount</th></tr>${rows}</table><p style="text-align:right"><b>Total ${num(r.total_amount).toFixed(2)}</b></p><br><br><div style="display:flex;justify-content:space-between"><span>Prepared by</span><span>Supplier acknowledgement</span></div>`);
}

export function SchoolPurchaseReturnsPage() {
  const returns = useRows('/school/purchase-returns');
  const grns = useRows('/school/grns');
  const industryId = returns.industryId;
  const company = useCompany(industryId);
  const [filter, setFilter] = useState('All');
  const [open, setOpen] = useState(false);
  const [grnId, setGrnId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(isoToday());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => { await Promise.all([returns.reload(), grns.reload()]); };
  const postedGrns = grns.rows.filter((g) => g.status === 'Posted');
  const grn = postedGrns.find((g) => g.id === grnId);
  const grnLines = (grn?.lines ?? []) as Row[];
  // How much of each product was already sent back against this receipt (Posted returns only).
  const already = (pid: string) => r2(returns.rows
    .filter((r) => r.grn_id === grnId && r.status === 'Posted')
    .reduce((s, r) => s + ((r.lines ?? []) as Row[]).filter((l) => String(l.product_id) === pid).reduce((x, l) => x + num(l.quantity), 0), 0));
  const leftOf = (l: Row) => r2(num(l.quantity) - already(String(l.product_id)));
  const estimate = r2(grnLines.reduce((s, l) => s + num(qty[String(l.product_id)]) * num(l.rate) * (1 + num(l.gst_percent) / 100), 0));

  function openForm() { setGrnId(''); setReason(''); setNotes(''); setDate(isoToday()); setQty({}); setFormError(''); setOpen(true); }

  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    if (!grnId) return setFormError('Select the goods receipt these goods came in on.');
    if (!reason.trim()) return setFormError('Enter the reason (damaged, wrong item, excess ...).');
    for (const l of grnLines) if (num(qty[String(l.product_id)]) > leftOf(l) + 1e-9) return setFormError(`${l.product_name}: only ${leftOf(l)} unit(s) can still be returned.`);
    const picked = grnLines.filter((l) => num(qty[String(l.product_id)]) > 0).map((l) => ({ product_id: l.product_id, quantity: num(qty[String(l.product_id)]) }));
    if (!picked.length) return setFormError('Enter the return quantity for at least one product.');
    setBusy(true);
    try {
      const res = await post<Row>('/school/purchase-returns', { industryTypeId: industryId, grn_id: grnId, reason, notes, return_date: date, lines: picked });
      setOpen(false); setMessage(`${res.data.return_number} posted. Stock reduced and the supplier balance adjusted.`); await refresh();
    } catch (err) { setFormError(messageOf(err, 'Unable to post the return.')); } finally { setBusy(false); }
  }

  async function cancel(r: Row) {
    if (!window.confirm(`Cancel purchase return ${r.return_number}? The stock will be added back.`)) return;
    setError(''); setMessage('');
    try { await post(`/school/purchase-returns/${r.id}/cancel?industryTypeId=${industryId}`, {}); setMessage(`${r.return_number} cancelled. Stock restored.`); await refresh(); }
    catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }

  const month = isoToday().slice(0, 7);
  const live = returns.rows.filter((r) => r.status === 'Posted');
  const monthRows = live.filter((r) => String(r.return_date).startsWith(month));
  const kpis = [
    { label: 'Returned this month', value: money(r2(monthRows.reduce((s, r) => s + num(r.total_amount), 0))), sub: `${monthRows.length} return(s)` },
    { label: 'Total returned', value: money(r2(live.reduce((s, r) => s + num(r.total_amount), 0))), sub: `${live.length} posted return(s)` },
  ];
  const shown = returns.rows.filter((r) => filter === 'All' || r.status === filter);

  return (
    <PageShell module="PURCHASE RETURNS" title="Purchase returns" description="Send goods back to a supplier against a goods receipt. Stock and the supplier's balance update together." error={error || returns.error} message={message} kpis={<Kpis items={kpis} />}
      actions={<>
        <button type="button" className="primary-action" onClick={openForm}>New purchase return</button>
        <Chips options={['All', 'Posted', 'Cancelled']} value={filter} onChange={setFilter} />
      </>}>
      {shown.length === 0 ? <p className="empty-state">{returns.loading ? 'Loading…' : 'No purchase returns yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Return</th><th>Date</th><th>Supplier</th><th>GRN</th><th>Reason</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th /></tr></thead><tbody>
          {shown.map((r) => (
            <tr key={r.id}><td><b>{r.return_number}</b></td><td>{day(r.return_date)}</td><td>{r.school_suppliers?.supplier_name ?? '—'}</td><td>{r.school_grns?.grn_number ?? '—'}</td><td>{r.reason}</td><td style={{ textAlign: 'right' }}><b>{money(r.total_amount)}</b></td><td><Pill text={r.status} tone={r.status === 'Posted' ? 'green' : 'gray'} /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => printReturn(r, company ?? null)}>Print</button>{' '}{r.status === 'Posted' && <button type="button" className="quiet-button" onClick={() => void cancel(r)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table></div>
      )}

      {open && (
        <Modal title="New purchase return" onClose={() => setOpen(false)} wide>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Goods receipt *<select value={grnId} onChange={(e) => { setGrnId(e.target.value); setQty({}); }}><option value="">Select GRN</option>{postedGrns.map((g) => <option key={g.id} value={g.id}>{g.grn_number} — {g.school_suppliers?.supplier_name}</option>)}</select></label>
              <label>Return date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged, wrong item, excess supply" /></label>
              <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></label>
            </div>
            {grn && (<>
              <div style={{ flexShrink: 0 }}><button type="button" className="quiet-button" onClick={() => setQty(Object.fromEntries(grnLines.map((l) => [String(l.product_id), String(leftOf(l))])))}>Return everything that is left</button></div>
              <div style={{ overflowX: 'auto', flexShrink: 0 }}>
                <table><thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Already returned</th><th style={{ textAlign: 'right' }}>Can return</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ width: 140 }}>Return qty</th></tr></thead><tbody>
                  {grnLines.map((l) => {
                    const key = String(l.product_id); const left = leftOf(l);
                    return (
                      <tr key={key}><td>{l.product_code} — {l.product_name}</td><td style={{ textAlign: 'right' }}>{l.quantity}</td><td style={{ textAlign: 'right' }}>{already(key)}</td><td style={{ textAlign: 'right' }}><b>{left}</b></td><td style={{ textAlign: 'right' }}>{money(l.rate)}</td>
                        <td><input type="number" min="0" max={left} step="any" disabled={left <= 0} style={{ width: '100%', borderColor: num(qty[key]) > left ? '#b42318' : undefined }} value={qty[key] ?? ''} onChange={(e) => setQty({ ...qty, [key]: e.target.value })} /></td></tr>
                    );
                  })}
                </tbody></table>
              </div>
              <p style={{ textAlign: 'right', fontWeight: 700, margin: '4px 0', flexShrink: 0 }}>Return value {money(estimate)} <span style={{ ...hint, fontWeight: 400 }}>(GST included)</span></p>
            </>)}
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Posting…' : 'Post return'}</button></div>
          </form>
        </Modal>
      )}
    </PageShell>
  );
}