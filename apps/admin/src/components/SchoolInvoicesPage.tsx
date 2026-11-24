/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Chips, Kpis, Modal, PageShell, Pill, Row, day, esc, hint, isoToday, messageOf, money, num, openPrint, post, r2, useCompany, useRows } from './schoolUi';

// GST sales invoices. An invoice is created by itself when a School order is dispatched (switch in Company & GST).
// Anything that could not be invoiced automatically waits here with a one-click "Invoice all".

export function printInvoice(doc: Row, company: Row, party: string, ref: string, kind: string) {
  const co = company ?? {};
  const rows = (doc.lines as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_name)}</td><td>${esc(l.hsn_code)}</td><td class="r">${l.quantity}</td><td class="r">${num(l.rate).toFixed(2)}</td><td class="r">${num(l.taxable_value).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${num(l.amount).toFixed(2)}</td></tr>`).join('');
  openPrint(ref, `<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)} ${esc(co.pincode)}<br>GSTIN: ${esc(co.gstin)} · ${esc(co.phone)}</div><hr>
<h3>${esc(kind)} ${esc(ref)}</h3><div>Date: ${esc(doc.invoice_date ?? doc.note_date)}${doc.due_date ? ` · Due: ${esc(doc.due_date)}` : ''}${doc.supply_type ? ` · ${esc(doc.supply_type)}` : ''}<br>Bill to: <b>${esc(party)}</b>${doc.place_of_supply ? ` · Place of supply: ${esc(doc.place_of_supply)}` : ''}${doc.reason ? `<br>Reason: ${esc(doc.reason)}` : ''}</div><br>
<table><tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>GST</th><th>Amount</th></tr>${rows}</table><br>
<table style="width:45%;margin-left:auto"><tr><td>Taxable value</td><td class="r">${num(doc.taxable_amount).toFixed(2)}</td></tr>${num(doc.cgst_amount) ? `<tr><td>CGST</td><td class="r">${num(doc.cgst_amount).toFixed(2)}</td></tr><tr><td>SGST</td><td class="r">${num(doc.sgst_amount).toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="r">${num(doc.igst_amount).toFixed(2)}</td></tr>`}<tr><td>Round off</td><td class="r">${num(doc.round_off).toFixed(2)}</td></tr><tr><td><b>Total</b></td><td class="r"><b>${num(doc.total_amount).toFixed(2)}</b></td></tr></table>
<p>Bank: ${esc(co.bank_name)} A/c ${esc(co.bank_account)} IFSC ${esc(co.bank_ifsc)}</p><p><small>${esc(co.terms)}</small></p>`);
}

export function SchoolInvoicesPage() {
  const inv = useRows('/school/invoices');
  const pending = useRows('/school/invoices/pending-orders');
  const industryId = inv.industryId;
  const company = useCompany(industryId);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<{ order_number: string; reason: string }[]>([]);

  const refresh = async () => { await Promise.all([inv.reload(), pending.reload()]); };
  async function create(o: Row) {
    setBusy(o.id); setError(''); setMessage(''); setFailed([]);
    try { const res = await post<Row>('/school/invoices', { industryTypeId: industryId, orderId: o.id }); setMessage(`Invoice ${res.data.invoice_number} created for ${o.order_number}.`); await refresh(); }
    catch (err) { setError(messageOf(err, 'Unable to create the invoice.')); } finally { setBusy(''); }
  }
  async function invoiceAll() {
    if (!window.confirm(`Create GST invoices for ${pending.rows.length} dispatched order(s)?`)) return;
    setBusy('all'); setError(''); setMessage(''); setFailed([]);
    try {
      const res = await post<{ created: { order_number: string; invoice_number: string }[]; failed: { order_number: string; reason: string }[] }>('/school/invoices/bulk', { industryTypeId: industryId });
      setMessage(res.data.created.length ? `${res.data.created.length} invoice(s) created: ${res.data.created.map((c) => c.invoice_number).join(', ')}.` : 'No invoice could be created.');
      setFailed(res.data.failed); await refresh();
    } catch (err) { setError(messageOf(err, 'Unable to create the invoices.')); } finally { setBusy(''); }
  }
  async function cancel(i: Row) {
    const reason = window.prompt(`Cancel invoice ${i.invoice_number}? Enter the reason:`); if (!reason) return;
    setError(''); setMessage('');
    try { await post(`/school/invoices/${i.id}/cancel?industryTypeId=${industryId}`, { reason }); setMessage(`${i.invoice_number} cancelled. Its order can be invoiced again.`); setView(null); await refresh(); } catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }

  const month = isoToday().slice(0, 7);
  const live = inv.rows.filter((i) => i.status === 'Issued');
  const thisMonth = live.filter((i) => String(i.invoice_date).startsWith(month));
  const gst = (rows: Row[]) => r2(rows.reduce((s, i) => s + num(i.cgst_amount) + num(i.sgst_amount) + num(i.igst_amount), 0));
  const kpis = [
    { label: 'Waiting for an invoice', value: pending.rows.length, tone: pending.rows.length ? ('red' as const) : undefined, sub: 'dispatched orders' },
    { label: 'Invoiced this month', value: money(thisMonth.reduce((s, i) => s + num(i.total_amount), 0)), sub: `${thisMonth.length} invoice(s)` },
    { label: 'GST this month', value: money(gst(thisMonth)) },
    { label: 'Auto-invoicing', value: company ? (company.auto_invoice_on_dispatch === false ? 'Off' : 'On') : '—', sub: 'when an order is dispatched' },
  ];
  const q = search.trim().toLowerCase();
  const shown = inv.rows.filter((i) => (filter === 'All' || i.status === filter) && (!q || `${i.invoice_number} ${i.clients?.client_name ?? ''} ${i.sale_orders?.order_number ?? ''}`.toLowerCase().includes(q)));

  return (
    <PageShell module="GST SALES INVOICES" title="GST sales invoices" description="CGST + SGST inside your state, IGST outside. An invoice is made automatically when an order is dispatched; anything left over is below." error={error || inv.error} message={message} kpis={<Kpis items={kpis} />}
      actions={<>
        <button type="button" className="primary-action" disabled={!pending.rows.length || busy === 'all'} onClick={() => void invoiceAll()}>{busy === 'all' ? 'Creating…' : `Invoice all (${pending.rows.length})`}</button>
        <input placeholder="Search invoice, school or order" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 260 }} />
        <Chips options={['All', 'Issued', 'Cancelled']} value={filter} onChange={setFilter} />
      </>}>
      {!company?.company_name && !inv.loading && <p className="error-message">Save your Company &amp; GST details first. Invoices cannot be created without them.</p>}
      {failed.length > 0 && (
        <div className="error-message"><b>{failed.length} order(s) could not be invoiced:</b>{failed.map((f) => <div key={f.order_number}>{f.order_number}: {f.reason}</div>)}</div>
      )}
      {pending.rows.length > 0 && (<>
        <h3 style={{ margin: '14px 0 6px' }}>Dispatched orders waiting for an invoice ({pending.rows.length})</h3>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Order</th><th>School</th><th>Delivery</th><th style={{ textAlign: 'right' }}>Order value</th><th /></tr></thead><tbody>
          {pending.rows.map((o) => (
            <tr key={o.id}><td><b>{o.order_number}</b></td><td>{o.client_name ?? '—'} {!o.has_tax_info && <Pill text="no state / GSTIN" tone="red" title="Add the school's state or GSTIN first, or the tax split cannot be decided." />}</td><td><Pill text={o.delivery_status} tone={o.delivery_status === 'delivered' ? 'green' : 'blue'} /></td><td style={{ textAlign: 'right' }}>{money(o.total_amount)}</td>
              <td><button type="button" className="quiet-button" disabled={busy === o.id} onClick={() => void create(o)}>{busy === o.id ? 'Creating…' : 'Create invoice'}</button></td></tr>
          ))}
        </tbody></table></div>
      </>)}

      <h3 style={{ margin: '22px 0 6px' }}>Invoices ({shown.length})</h3>
      {shown.length === 0 ? <p className="empty-state">{inv.loading ? 'Loading…' : 'No invoices yet. They appear here when orders are dispatched.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Invoice</th><th>Date</th><th>School</th><th>Order</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th /></tr></thead><tbody>
          {shown.map((i) => (
            <tr key={i.id}><td><b>{i.invoice_number}</b></td><td>{day(i.invoice_date)}</td><td>{i.clients?.client_name ?? '—'}</td><td>{i.sale_orders?.order_number ?? '—'}</td><td style={{ textAlign: 'right' }}>{money(i.taxable_amount)}</td><td style={{ textAlign: 'right' }}>{money(num(i.cgst_amount) + num(i.sgst_amount) + num(i.igst_amount))}</td><td style={{ textAlign: 'right' }}><b>{money(i.total_amount)}</b></td><td><Pill text={i.status} tone={i.status === 'Issued' ? 'green' : 'gray'} /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => setView(i)}>View</button>{' '}<button type="button" className="quiet-button" onClick={() => printInvoice(i, i.company ?? company ?? {}, i.clients?.client_name ?? '', i.invoice_number, 'TAX INVOICE')}>Print</button>{' '}{i.status === 'Issued' && <button type="button" className="quiet-button" onClick={() => void cancel(i)}>Cancel</button>}</td></tr>
          ))}
        </tbody></table></div>
      )}

      {view && (
        <Modal title={`${view.invoice_number} · ${view.status}`} onClose={() => setView(null)}>
          <p style={hint}>{view.clients?.client_name} · order {view.sale_orders?.order_number} · {day(view.invoice_date)}{view.due_date ? ` · due ${day(view.due_date)}` : ''} · {view.supply_type}{view.cancel_reason ? ` · cancelled: ${view.cancel_reason}` : ''}</p>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>GST</th><th>Amount</th></tr></thead><tbody>
            {(view.lines as Row[]).map((l, k) => <tr key={k}><td>{l.product_name}</td><td>{l.hsn_code ?? '—'}</td><td>{l.quantity}</td><td>{money(l.rate)}</td><td>{money(l.taxable_value)}</td><td>{l.gst_percent}%</td><td>{money(l.amount)}</td></tr>)}
          </tbody></table></div>
          <p style={{ textAlign: 'right' }}>Taxable {money(view.taxable_amount)} · GST {money(num(view.cgst_amount) + num(view.sgst_amount) + num(view.igst_amount))} · <b>Total {money(view.total_amount)}</b></p>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => printInvoice(view, view.company ?? company ?? {}, view.clients?.client_name ?? '', view.invoice_number, 'TAX INVOICE')}>Print</button>{view.status === 'Issued' && <button type="button" className="quiet-button" onClick={() => void cancel(view)}>Cancel invoice</button>}</div>
        </Modal>
      )}
    </PageShell>
  );
}