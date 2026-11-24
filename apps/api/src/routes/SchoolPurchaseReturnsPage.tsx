import { FormEvent, useState } from 'react';
import { Kpis, Modal, PageShell, Pill, Row, day, hint, isoToday, messageOf, money, num, post, r2, useRows } from './schoolUi';

// Goods sent back to a supplier. Pick the goods receipt, enter how many go back: rate and GST come from that receipt,
// stock goes down at once and the supplier's payable goes down by the same amount.

const REASONS = ['Damaged', 'Wrong item', 'Excess supplied', 'Quality issue'];

export function SchoolPurchaseReturnsPage() {
  const returns = useRows('/school/purchase-returns');
  const grns = useRows('/school/grns');
  const industryId = returns.industryId;
  const [open, setOpen] = useState(false);
  const [grnId, setGrnId] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(isoToday());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => { await Promise.all([returns.reload(), grns.reload()]); };
  const live = returns.rows.filter((r) => r.status === 'Posted');
  const postedGrns = grns.rows.filter((g) => g.status === 'Posted');
  const grn = postedGrns.find((g) => g.id === grnId);
  const grnLines = (grn?.lines ?? []) as Row[];
  const returnedOn = (pid: string) => live.filter((r) => r.grn_id === grnId).reduce((s, r) => s + ((r.lines ?? []) as Row[]).filter((l) => l.product_id === pid).reduce((a, l) => a + num(l.quantity), 0), 0);
  const estimate = r2(grnLines.reduce((s, l) => s + num(qty[l.product_id]) * num(l.rate) * (1 + num(l.gst_percent) / 100), 0));

  function openForm() { setGrnId(''); setReason(''); setDate(isoToday()); setQty({}); setFormError(''); setOpen(true); }
  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    const lines = Object.entries(qty).filter(([, v]) => num(v) > 0).map(([product_id, v]) => ({ product_id, quantity: num(v) }));
    if (!grnId) return setFormError('Select the goods receipt.');
    if (!reason.trim()) return setFormError('Enter the reason for the return.');
    if (!lines.length) return setFormError('Enter a return quantity for at least one product.');
    setBusy(true);
    try {
      const res = await post<Row>('/school/purchase-returns', { industryTypeId: industryId, grn_id: grnId, reason, return_date: date, lines });
      setOpen(false); setMessage(`${res.data.return_number} posted. Stock reduced and ${money(res.data.total_amount)} taken off what you owe ${grn?.school_suppliers?.supplier_name ?? 'the supplier'}.`); await refresh();
    } catch (err) { setFormError(messageOf(err, 'Unable to save.')); } finally { setBusy(false); }
  }
  async function cancel(r: Row) {
    if (!window.confirm(`Cancel ${r.return_number}? The stock comes back and the supplier bill goes up again.`)) return;
    setError(''); setMessage('');
    try { await post(`/school/purchase-returns/${r.id}/cancel?industryTypeId=${industryId}`, {}); setMessage(`${r.return_number} cancelled.`); await refresh(); } catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }

  const month = isoToday().slice(0, 7);
  const kpis = [
    { label: 'Returns this month', value: live.filter((r) => String(r.return_date).startsWith(month)).length },
    { label: 'Value returned (all time)', value: money(live.reduce((s, r) => s + num(r.total_amount), 0)) },
    { label: 'Value returned this month', value: money(live.filter((r) => String(r.return_date).startsWith(month)).reduce((s, r) => s + num(r.total_amount), 0)) },
    { label: 'Cancelled', value: returns.rows.length - live.length },
  ];

  return (
    <PageShell module="PURCHASE RETURNS" title="Purchase returns" description="Send damaged, wrong or extra goods back to the supplier. Stock and the supplier's payable are corrected in one step."
      kpis={<Kpis items={kpis} />} error={error || returns.error || grns.error} message={message}
      actions={<button type="button" className="primary-action" onClick={openForm}>+ New purchase return</button>}>
      {returns.rows.length === 0 ? <p className="empty-state">{returns.loading ? 'Loading…' : 'No purchase returns yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Return</th><th>Date</th><th>Supplier</th><th>Goods receipt</th><th>Items</th><th>Reason</th><th style={{ textAlign: 'right' }}>Value</th><th>Status</th><th /></tr></thead><tbody>
          {returns.rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.return_number}</b></td><td>{day(r.return_date)}</td><td>{r.school_suppliers?.supplier_name ?? '—'}</td><td>{r.school_grns?.grn_number ?? '—'}</td>
              <td>{((r.lines ?? []) as Row[]).map((l) => `${l.product_name} × ${l.quantity}`).join(', ')}</td><td>{r.reason}</td>
              <td style={{ textAlign: 'right' }}>{money(r.total_amount)}</td>
              <td><Pill text={r.status} tone={r.status === 'Posted' ? 'green' : 'gray'} /></td>
              <td>{r.status === 'Posted' && <button type="button" className="quiet-button" onClick={() => void cancel(r)}>Cancel</button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      {open && (
        <Modal title="New purchase return" onClose={() => setOpen(false)} wide>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Goods receipt *<select value={grnId} onChange={(e) => { setGrnId(e.target.value); setQty({}); }}>
                <option value="">Select…</option>
                {postedGrns.map((g) => <option key={g.id} value={g.id}>{g.grn_number} — {g.school_suppliers?.supplier_name ?? ''} — {day(g.received_date)}</option>)}
              </select></label>
              <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            </div>
            <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are the goods going back?" /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{REASONS.map((x) => <button key={x} type="button" className="quiet-button" onClick={() => setReason(x)}>{x}</button>)}</div>
            {grn && (
              <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Already returned</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>GST %</th><th style={{ textAlign: 'right' }}>Return qty</th></tr></thead><tbody>
                {grnLines.map((l) => {
                  const back = returnedOn(String(l.product_id)); const left = r2(num(l.quantity) - back);
                  return (
                    <tr key={l.product_id}>
                      <td>{l.product_name} <span style={hint}>{l.product_code}</span></td>
                      <td style={{ textAlign: 'right' }}>{l.quantity}</td><td style={{ textAlign: 'right' }}>{back || '—'}</td>
                      <td style={{ textAlign: 'right' }}>{money(l.rate)}</td><td style={{ textAlign: 'right' }}>{l.gst_percent}</td>
                      <td style={{ textAlign: 'right' }}>{left > 0
                        ? <input type="number" min="0" max={left} step="any" style={{ width: 90 }} value={qty[l.product_id] ?? ''} onChange={(e) => setQty({ ...qty, [l.product_id]: e.target.value })} placeholder={`max ${left}`} />
                        : <span style={hint}>all returned</span>}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            )}
            {grn && <p style={{ ...hint, margin: 0 }}>Value going back (GST included): <b>{money(estimate)}</b>. It is taken off the {grn.grn_number} bill.</p>}
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Post return'}</button></div>
          </form>
        </Modal>
      )}
    </PageShell>
  );
}