/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useState } from 'react';
import { Chips, Kpis, Modal, PageShell, Pill, Row, day, hint, isoToday, messageOf, money, num, post, r2, useCompany, useRows } from './schoolUi';
import { printInvoice } from './SchoolInvoicesPage';

// GST credit notes. Approved sales returns / damage entries (recorded on the order) wait here and become credit notes in one click.
// A credit note is the tax document: it reduces the GST in the register. The school's balance is adjusted by the return itself.

export function SchoolCreditNotesPage() {
  const notes = useRows('/school/credit-notes');
  const returns = useRows('/school/credit-notes/pending-returns');
  const invoices = useRows('/school/invoices');
  const industryId = notes.industryId;
  const company = useCompany(industryId);
  const [filter, setFilter] = useState('All');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<{ invoice_number: string; reason: string }[]>([]);

  const refresh = async () => { await Promise.all([notes.reload(), returns.reload()]); };
  const ready = returns.rows.filter((r) => r.ready);
  async function fromReturns(ids: string[] | null) {
    setBusy(ids ? ids[0] : 'all'); setError(''); setMessage(''); setFailed([]);
    try {
      const res = await post<{ created: string[]; failed: { invoice_number: string; reason: string }[] }>('/school/credit-notes/from-returns', { industryTypeId: industryId, returnIds: ids });
      setMessage(res.data.created.length ? `${res.data.created.length} credit note(s) created: ${res.data.created.join(', ')}.` : 'No credit note could be created.');
      setFailed(res.data.failed); await refresh();
    } catch (err) { setError(messageOf(err, 'Unable to create credit notes.')); } finally { setBusy(''); }
  }
  async function cancel(cn: Row) {
    if (!window.confirm(`Cancel credit note ${cn.credit_note_number}?`)) return;
    setError(''); setMessage('');
    try { await post(`/school/credit-notes/${cn.id}/cancel?industryTypeId=${industryId}`, {}); setMessage(`${cn.credit_note_number} cancelled. Its returns are waiting again.`); await refresh(); } catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }

  const invoice = invoices.rows.find((i) => i.id === invoiceId);
  const lines = (invoice?.lines ?? []) as Row[];
  const estimate = r2(lines.reduce((s, l, i) => s + (num(qty[i]) > 0 ? (num(l.taxable_value) * num(qty[i])) / (num(l.quantity) || 1) * (1 + num(l.gst_percent) / 100) : 0), 0));
  async function save(e: FormEvent) {
    e.preventDefault(); setFormError('');
    const picked = Object.entries(qty).filter(([, v]) => num(v) > 0).map(([i, v]) => ({ index: Number(i), quantity: num(v) }));
    if (!invoiceId) return setFormError('Select the invoice.');
    if (!reason.trim()) return setFormError('Enter the reason.');
    if (!picked.length) return setFormError('Enter a quantity for at least one line.');
    try {
      const res = await post<Row>('/school/credit-notes', { industryTypeId: industryId, invoiceId, reason, lines: picked });
      setOpen(false); setMessage(`Credit note ${res.data.credit_note_number} issued.`); await refresh();
    } catch (err) { setFormError(messageOf(err, 'Unable to issue.')); }
  }

  const month = isoToday().slice(0, 7);
  const live = notes.rows.filter((n) => n.status === 'Issued');
  const monthRows = live.filter((n) => String(n.note_date).startsWith(month));
  const kpis = [
    { label: 'Returns waiting', value: returns.rows.length, tone: returns.rows.length ? ('red' as const) : undefined, sub: `${ready.length} ready for a credit note` },
    { label: 'Credited this month', value: money(monthRows.reduce((s, n) => s + num(n.total_amount), 0)), sub: `${monthRows.length} credit note(s)` },
    { label: 'GST reduced this month', value: money(r2(monthRows.reduce((s, n) => s + num(n.cgst_amount) + num(n.sgst_amount) + num(n.igst_amount), 0))) },
  ];
  const shown = notes.rows.filter((n) => filter === 'All' || n.status === filter);

  return (
    <PageShell module="GST CREDIT NOTES" title="GST credit notes" description="Approved returns and damage entries turn into credit notes in one click. Nothing to type." error={error || notes.error} message={message} kpis={<Kpis items={kpis} />}
      actions={<>
        <button type="button" className="primary-action" disabled={!ready.length || busy === 'all'} onClick={() => void fromReturns(null)}>{busy === 'all' ? 'Creating…' : `Create credit notes for all ready returns (${ready.length})`}</button>
        <button type="button" className="quiet-button" onClick={() => { setInvoiceId(''); setReason(''); setQty({}); setFormError(''); setOpen(true); }}>New credit note manually</button>
        <Chips options={['All', 'Issued', 'Cancelled']} value={filter} onChange={setFilter} />
      </>}>
      {failed.length > 0 && <div className="error-message"><b>Some could not be created:</b>{failed.map((f) => <div key={f.invoice_number}>{f.invoice_number}: {f.reason}</div>)}</div>}
      {returns.rows.length > 0 && (<>
        <h3 style={{ margin: '14px 0 6px' }}>Approved returns waiting for a credit note ({returns.rows.length})</h3>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Order</th><th>School</th><th>Product</th><th style={{ textAlign: 'right' }}>Qty</th><th>Type</th><th>Reason</th><th>Invoice</th><th /></tr></thead><tbody>
          {returns.rows.map((r) => (
            <tr key={r.return_id}><td><b>{r.order_number}</b></td><td>{r.client_name}</td><td>{r.product_code} — {r.product_name}</td><td style={{ textAlign: 'right' }}>{r.quantity}</td><td>{r.kind === 'damage' ? 'Damage' : 'Return'}</td><td>{r.reason ?? '—'}</td>
              <td>{r.ready ? r.invoice_number : <Pill text={r.blocker ?? 'Not ready'} tone="red" />}</td>
              <td>{r.ready ? <button type="button" className="quiet-button" disabled={busy === r.return_id} onClick={() => void fromReturns([r.return_id])}>{busy === r.return_id ? 'Creating…' : 'Create'}</button> : <button type="button" className="quiet-button" onClick={() => { window.location.hash = '#industry:school:gst-invoices'; }}>Go to invoices</button>}</td></tr>
          ))}
        </tbody></table></div>
      </>)}

      <h3 style={{ margin: '22px 0 6px' }}>Credit notes ({shown.length})</h3>
      {shown.length === 0 ? <p className="empty-state">{notes.loading ? 'Loading…' : 'No credit notes yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Credit note</th><th>Date</th><th>School</th><th>Invoice</th><th>Reason</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th /></tr></thead><tbody>
          {shown.map((n) => (
            <tr key={n.id}><td><b>{n.credit_note_number}</b></td><td>{day(n.note_date)}</td><td>{n.clients?.client_name ?? '—'}</td><td>{n.school_invoices?.invoice_number ?? '—'}</td><td>{n.reason}</td><td style={{ textAlign: 'right' }}><b>{money(n.total_amount)}</b></td><td><Pill text={n.status} tone={n.status === 'Issued' ? 'green' : 'gray'} /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => printInvoice(n, company ?? {}, n.clients?.client_name ?? '', n.credit_note_number, 'CREDIT NOTE')}>Print</button>{' '}{n.status === 'Issued' && <button type="button" className="quiet-button" onClick={() => void cancel(n)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table></div>
      )}

      {open && (
        <Modal title="New credit note" onClose={() => setOpen(false)} wide>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Invoice *<select value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setQty({}); }}><option value="">Select invoice</option>{invoices.rows.filter((i) => i.status === 'Issued').map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {i.clients?.client_name}</option>)}</select></label>
              <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rate difference, damaged books" /></label>
            </div>
            {invoice && (<>
              <div style={{ flexShrink: 0 }}><button type="button" className="quiet-button" onClick={() => setQty(Object.fromEntries(lines.map((l, i) => [i, String(l.quantity)])))}>Credit the full invoice</button></div>
              <div style={{ overflowX: 'auto', flexShrink: 0 }}>
                <table><thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Invoiced qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ width: 140 }}>Credit qty</th></tr></thead><tbody>
                  {lines.map((l, i) => <tr key={i}><td>{l.product_name}</td><td style={{ textAlign: 'right' }}>{l.quantity}</td><td style={{ textAlign: 'right' }}>{money(l.rate)}</td><td><input type="number" min="0" max={l.quantity} step="any" style={{ width: '100%' }} value={qty[i] ?? ''} onChange={(e) => setQty({ ...qty, [i]: e.target.value })} /></td></tr>)}
                </tbody></table>
              </div>
              <p style={{ textAlign: 'right', fontWeight: 700, margin: '4px 0', flexShrink: 0 }}>Credit about {money(estimate)} <span style={{ ...hint, fontWeight: 400 }}>(GST included, rounded on issue)</span></p>
            </>)}
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action">Issue credit note</button></div>
          </form>
        </Modal>
      )}
    </PageShell>
  );
}