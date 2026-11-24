/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, Fragment, useState } from 'react';
import { api } from '../lib/api';
import { Kpis, Modal, PageShell, Pill, Row, day, hint, isoToday, messageOf, money, num, post, r2, useRows } from './schoolUi';

// What we owe each supplier, bill by bill. A bill is a posted goods receipt (GST included), due `credit days` after it was received.
// A payment settles the oldest bill first, or the bill you pick. The page shows overdue and due-this-week amounts by itself.

const MODES = ['Bank transfer', 'Cheque', 'UPI', 'Cash'];

function dueState(b: Row): { text: string; tone: string } {
  if (b.overdue_days > 0) return { text: `Overdue ${b.overdue_days}d`, tone: 'red' };
  if (b.overdue_days === 0) return { text: 'Due today', tone: 'amber' };
  if (b.overdue_days >= -7) return { text: `Due in ${-b.overdue_days}d`, tone: 'blue' };
  return { text: `Due ${day(b.due_date)}`, tone: 'gray' };
}

function PayModal({ supplier, bill, industryId, onClose, onDone }: { supplier: Row; bill: Row | null; industryId: string; onClose: () => void; onDone: (m: string) => void }) {
  const bills = (supplier.bills as Row[]);
  const [amount, setAmount] = useState(String(bill ? bill.outstanding : supplier.overdue_amount > 0 ? supplier.overdue_amount : supplier.payable));
  const [form, setForm] = useState({ payment_date: isoToday(), mode: 'Bank transfer', reference_no: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Preview which bills this payment will clear (a named bill first, then oldest first).
  const preview = (() => {
    let left = num(amount); const out: { grn: string; clears: number; fully: boolean }[] = [];
    const ordered = bill ? [bill, ...bills.filter((b) => b.grn_id !== bill.grn_id)] : bills;
    for (const b of ordered) { if (left <= 0.009) break; const take = Math.min(left, num(b.outstanding)); out.push({ grn: b.grn_number, clears: r2(take), fully: take >= num(b.outstanding) - 0.009 }); left = r2(left - take); }
    return { rows: out, extra: left > 0.009 ? left : 0 };
  })();

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!(num(amount) > 0)) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try {
      const res = await post<Row>('/school/supplier-payments', { industryTypeId: industryId, supplier_id: supplier.supplier_id, grn_id: bill?.grn_id ?? null, amount: num(amount), ...form });
      onDone(`${res.data.payment_number} recorded: ${money(num(amount))} to ${supplier.supplier_name}.`);
    } catch (err) { setError(messageOf(err, 'Unable to save.')); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Pay ${supplier.supplier_name}`} onClose={onClose} wide>
      <form className="master-modal-form" onSubmit={submit}>
        <p style={{ ...hint, margin: 0, flexShrink: 0 }}>Payable {money(supplier.payable)}{supplier.overdue_amount > 0 ? ` · overdue ${money(supplier.overdue_amount)}` : ''}{bill ? ` · paying ${bill.grn_number}` : ''}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          {supplier.overdue_amount > 0 && <button type="button" className="quiet-button" onClick={() => setAmount(String(supplier.overdue_amount))}>Overdue {money(supplier.overdue_amount)}</button>}
          {supplier.due_soon_amount > 0 && <button type="button" className="quiet-button" onClick={() => setAmount(String(r2(supplier.overdue_amount + supplier.due_soon_amount)))}>Overdue + due this week {money(r2(supplier.overdue_amount + supplier.due_soon_amount))}</button>}
          <button type="button" className="quiet-button" onClick={() => setAmount(String(supplier.payable))}>Everything {money(supplier.payable)}</button>
        </div>
        <div className="field-grid">
          <label>Amount (₹) *<input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>Date<input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></label>
          <label>Mode<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Reference no.<input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} placeholder="UTR / cheque no." /></label>
        </div>
        <div style={{ border: '1px solid #e5e2da', borderRadius: 10, padding: '10px 14px', fontSize: 14, flexShrink: 0 }}>
          <b>This payment settles</b>
          {preview.rows.length === 0 ? <div style={hint}>Enter an amount to see which bills it clears.</div> : preview.rows.map((r) => <div key={r.grn}>{r.grn}: {money(r.clears)} {r.fully ? <Pill text="cleared" tone="green" /> : <Pill text="part-paid" tone="amber" />}</div>)}
          {preview.extra > 0 && <div style={{ color: '#b54708' }}>{money(preview.extra)} is more than is owed: it is kept as an advance to the supplier.</div>}
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Saving…' : `Record payment of ${money(num(amount))}`}</button></div>
      </form>
    </Modal>
  );
}

export function SchoolSupplierPaymentsPage() {
  const payables = useRows('/school/supplier-outstanding');
  const pays = useRows('/school/supplier-payments');
  const industryId = payables.industryId;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [paying, setPaying] = useState<{ supplier: Row; bill: Row | null } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => { await Promise.all([payables.reload(), pays.reload()]); };
  async function remove(p: Row) {
    if (!window.confirm(`Delete payment ${p.payment_number} of ${money(p.amount)}? The bills it settled become payable again.`)) return;
    setError('');
    try { await api(`/school/supplier-payments/${p.id}?industryTypeId=${industryId}`, { method: 'DELETE' }); await refresh(); } catch (err) { setError(messageOf(err, 'Unable to delete.')); }
  }

  const month = isoToday().slice(0, 7);
  const sum = (k: string) => r2(payables.rows.reduce((s, r) => s + num(r[k]), 0));
  const kpis = [
    { label: 'Total payable', value: money(sum('payable')), sub: `${payables.rows.filter((r) => r.payable > 0).length} supplier(s)` },
    { label: 'Overdue', value: money(sum('overdue_amount')), tone: sum('overdue_amount') > 0 ? ('red' as const) : undefined },
    { label: 'Due in 7 days', value: money(sum('due_soon_amount')) },
    { label: 'Paid this month', value: money(pays.rows.filter((p) => String(p.payment_date).startsWith(month)).reduce((s, p) => s + num(p.amount), 0)) },
  ];

  return (
    <PageShell module="SUPPLIER PAYMENTS" title="Supplier bills & payments" description="Each goods receipt becomes a bill, due after the supplier's credit days. Pay the oldest first with one click." error={error || payables.error || pays.error} message={message} kpis={<Kpis items={kpis} />}>
      <h3 style={{ margin: '8px 0 6px' }}>Payables by supplier</h3>
      {payables.rows.length === 0 ? <p className="empty-state">{payables.loading ? 'Loading…' : 'Nothing purchased yet. Bills appear here when you post a goods receipt.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th /><th>Supplier</th><th>Credit days</th><th style={{ textAlign: 'right' }}>Payable</th><th style={{ textAlign: 'right' }}>Overdue</th><th style={{ textAlign: 'right' }}>Due in 7 days</th><th style={{ textAlign: 'right' }}>Advance paid</th><th /></tr></thead><tbody>
          {payables.rows.map((r) => (
            <Fragment key={r.supplier_id}>
              <tr>
                <td style={{ width: 36 }}>{r.bills.length > 0 && <button type="button" className="quiet-button" onClick={() => setOpen({ ...open, [r.supplier_id]: !open[r.supplier_id] })}>{open[r.supplier_id] ? '▾' : '▸'}</button>}</td>
                <td><b>{r.supplier_name}</b> <span style={hint}>{r.supplier_code}</span></td><td>{r.credit_days}</td>
                <td style={{ textAlign: 'right' }}><b>{money(r.payable)}</b><div style={hint}>{r.bills.length} open bill(s)</div></td>
                <td style={{ textAlign: 'right', color: r.overdue_amount > 0 ? '#b42318' : undefined }}>{r.overdue_amount > 0 ? money(r.overdue_amount) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.due_soon_amount > 0 ? money(r.due_soon_amount) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{r.advance_paid > 0 ? money(r.advance_paid) : '—'}</td>
                <td>{r.payable > 0 && <button type="button" className="primary-action" onClick={() => setPaying({ supplier: r, bill: null })}>Pay</button>}</td>
              </tr>
              {open[r.supplier_id] && r.bills.map((b: Row) => {
                const st = dueState(b);
                return (
                  <tr key={b.grn_id} style={{ background: '#faf9f5' }}>
                    <td /><td colSpan={2} style={{ paddingLeft: 24 }}>{b.grn_number} <span style={hint}>received {day(b.received_date)}{b.supplier_invoice_no ? ` · invoice ${b.supplier_invoice_no}` : ''}</span></td>
                    <td style={{ textAlign: 'right' }}>{money(b.outstanding)}{b.outstanding < b.amount - 0.009 ? <div style={hint}>of {money(b.amount)}</div> : null}</td>
                    <td colSpan={2}><Pill text={st.text} tone={st.tone} /> <span style={hint}>due {day(b.due_date)}</span></td><td />
                    <td><button type="button" className="quiet-button" onClick={() => setPaying({ supplier: r, bill: b })}>Pay this bill</button></td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody></table></div>
      )}

      <h3 style={{ margin: '22px 0 6px' }}>Payments made</h3>
      {pays.rows.length === 0 ? <p className="empty-state">{pays.loading ? 'Loading…' : 'No payments yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Payment</th><th>Date</th><th>Supplier</th><th>Against</th><th>Mode</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead><tbody>
          {pays.rows.map((p) => <tr key={p.id}><td><b>{p.payment_number}</b></td><td>{day(p.payment_date)}</td><td>{p.school_suppliers?.supplier_name ?? '—'}</td><td>{p.school_grns?.grn_number ?? 'Oldest bills first'}</td><td>{p.mode ?? '—'}</td><td>{p.reference_no ?? '—'}</td><td style={{ textAlign: 'right' }}>{money(p.amount)}</td><td><button type="button" className="quiet-button" onClick={() => void remove(p)}>Delete</button></td></tr>)}
        </tbody></table></div>
      )}

      {paying && industryId && <PayModal supplier={paying.supplier} bill={paying.bill} industryId={industryId} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); setError(''); setMessage(m); void refresh(); }} />}
    </PageShell>
  );
}