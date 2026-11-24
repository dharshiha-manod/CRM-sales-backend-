/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Chips, Kpis, Modal, PageShell, Pill, ProductCombobox, Row, Product, at, day, esc, hint, isoToday, messageOf, money, num, openPrint, post, r2, useCompany, useProducts, useRows } from './schoolUi';

// Receiving desk. Goods that are due come to the warehouse as a list ("Arriving"); the person at the dock checks the
// quantities and posts the receipt in one step. Nothing is typed twice: supplier, products, rates and GST come from the PO,
// and the supplier's invoice number comes from the shipment notice the supplier sent from the PO e-mail link.
// Posting adds the stock, moves the PO to Partially received / Received, and creates the supplier bill (see Supplier Bills).

const BUCKETS = ['All', 'Overdue', 'Today', 'This week', 'Later', 'No date'];
const SOURCE: Record<string, { text: string; tone: string }> = { manual: { text: 'Manual', tone: 'gray' }, 'po-quick': { text: 'From PO', tone: 'blue' }, shipment: { text: 'From shipment', tone: 'purple' } };
const bucketTone = (b: string) => (b === 'Overdue' ? 'red' : b === 'Today' ? 'amber' : b === 'This week' ? 'blue' : 'gray');

function printGrn(g: Row, company: Row | null) {
  const co = company ?? {}; const s = g.school_suppliers ?? {};
  const rows = (g.lines as Row[]).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_code)} — ${esc(l.product_name)}</td><td class="r">${l.quantity}</td><td class="r">${num(l.rate).toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${num(l.amount).toFixed(2)}</td></tr>`).join('');
  openPrint(g.grn_number, `<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)}<br>GSTIN: ${esc(co.gstin)}</div><hr><h3>GOODS RECEIPT NOTE ${esc(g.grn_number)}</h3>
<div class="cols"><div><b>Supplier:</b> ${esc(s.supplier_name)}<br><b>Supplier invoice:</b> ${esc(g.supplier_invoice_no || '—')}<br><b>PO:</b> ${esc(g.school_purchase_orders?.po_number || 'Direct purchase')}</div><div><b>Received on:</b> ${esc(g.received_date)}<br><b>Received by:</b> ${esc(g.received_by || '—')}</div></div>
<table><tr><th>#</th><th>Item</th><th>Qty received</th><th>Rate</th><th>GST</th><th>Amount</th></tr>${rows}</table><p style="text-align:right"><b>Total ${num(g.total_amount).toFixed(2)}</b></p><br><br><div style="display:flex;justify-content:space-between"><span>Received by</span><span>Checked by</span></div>`);
}

// ------------------------------------------------------------------------------------------ receive against a PO
function ReceiveModal({ arrival, industryId, onClose, onDone }: { arrival: Row; industryId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const lines = arrival.lines as Row[];
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [String(l.product_id), String(l.pending)])));
  const [form, setForm] = useState({ received_date: isoToday(), supplier_invoice_no: arrival.shipment_invoice_no ?? '', received_by: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const total = r2(lines.reduce((s, l) => s + num(qty[String(l.product_id)]) * num(l.rate) * (1 + num(l.gst_percent) / 100), 0));
  const counted = lines.filter((l) => num(qty[String(l.product_id)]) > 0).length;
  const short = lines.filter((l) => num(qty[String(l.product_id)]) < num(l.pending)).length;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    for (const l of lines) if (num(qty[String(l.product_id)]) > num(l.pending) + 1e-9) return setError(`${l.product_name}: only ${l.pending} still pending.`);
    if (!counted) return setError('Enter the received quantity for at least one product.');
    setBusy(true);
    try {
      const res = await post<Row>(`/school/purchase-orders/${arrival.po_id}/receive?industryTypeId=${industryId}`, { ...form, industryTypeId: industryId, lines: lines.map((l) => ({ product_id: l.product_id, quantity: num(qty[String(l.product_id)]) })) });
      onDone(`${res.data.grn_number} posted. Stock updated${short ? `, ${short} item(s) still pending on ${arrival.po_number}` : `, ${arrival.po_number} fully received`}.`);
    } catch (err) { setError(messageOf(err, 'Unable to post.')); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Receive goods · ${arrival.po_number}`} onClose={onClose} wide>
      <form className="master-modal-form" onSubmit={submit}>
        <p style={{ ...hint, margin: 0, flexShrink: 0 }}>{arrival.supplier_name}{arrival.shipped_at ? <> · <Pill text="Shipped" tone="purple" title={`Shipment notice ${at(arrival.shipped_at)}`} /> {arrival.shipment_vehicle_no ? `vehicle / LR ${arrival.shipment_vehicle_no}` : ''}</> : ''}. Quantities are filled from the order. Change only what actually arrived.</p>
        <div className="field-grid">
          <label>Supplier invoice no.<input value={form.supplier_invoice_no} onChange={(e) => setForm({ ...form, supplier_invoice_no: e.target.value })} placeholder="From the delivery challan / invoice" /></label>
          <label>Received on<input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></label>
          <label>Received by<input value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} placeholder="Name of the person at the dock" /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Damaged box, short supply…" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" className="quiet-button" onClick={() => setQty(Object.fromEntries(lines.map((l) => [String(l.product_id), String(l.pending)])))}>Everything arrived as ordered</button>
          <button type="button" className="quiet-button" onClick={() => setQty(Object.fromEntries(lines.map((l) => [String(l.product_id), '0'])))}>Clear all</button>
        </div>
        <div style={{ overflowX: 'auto', flexShrink: 0 }}>
          <table><thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Ordered</th><th style={{ textAlign: 'right' }}>Received before</th><th style={{ textAlign: 'right' }}>Pending</th><th style={{ width: 140 }}>Receiving now</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
            {lines.map((l) => {
              const q = num(qty[String(l.product_id)]);
              return (
                <tr key={String(l.product_id)}>
                  <td>{l.product_code} — {l.product_name}</td><td style={{ textAlign: 'right' }}>{l.ordered}</td><td style={{ textAlign: 'right' }}>{l.received}</td><td style={{ textAlign: 'right' }}><b>{l.pending}</b></td>
                  <td><input type="number" min="0" max={l.pending} step="any" style={{ width: '100%', borderColor: q > l.pending ? '#b42318' : undefined }} value={qty[String(l.product_id)] ?? ''} onChange={(e) => setQty({ ...qty, [String(l.product_id)]: e.target.value })} /></td>
                  <td style={{ textAlign: 'right' }}>{money(q * num(l.rate) * (1 + num(l.gst_percent) / 100))}</td>
                </tr>
              );
            })}
          </tbody></table>
        </div>
        <p style={{ textAlign: 'right', margin: '4px 0', fontWeight: 700, flexShrink: 0 }}>Receipt value {money(total)} <span style={{ ...hint, fontWeight: 400 }}>· {counted} of {lines.length} item(s){short ? `, ${short} short` : ''}</span></p>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Posting…' : 'Confirm & post receipt'}</button></div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------ direct purchase (no PO)
type DLine = { product_id: string; quantity: string; rate: string; gst_percent: string };
function DirectModal({ industryId, suppliers, products, onClose, onDone }: { industryId: string; suppliers: Row[]; products: Product[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [form, setForm] = useState({ supplier_id: '', received_date: isoToday(), supplier_invoice_no: '', received_by: '', notes: '' });
  const [lines, setLines] = useState<DLine[]>([{ product_id: '', quantity: '', rate: '', gst_percent: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const supplier = suppliers.find((s) => s.id === form.supplier_id);
  const none = useMemo(() => new Map<string, { rate: number; gst: number }>(), []);
  const blank = (ls: DLine[]) => (ls.length && !ls[ls.length - 1].product_id ? ls : [...ls, { product_id: '', quantity: '', rate: '', gst_percent: '' }]);
  function pick(i: number, id: string) {
    const p = byId.get(id); if (!p) return;
    if (lines.some((l, k) => k !== i && l.product_id === id)) return setError(`${p.product_name} is already listed.`);
    setError('');
    setLines((ls) => blank(ls.map((l, k) => (k === i ? { product_id: id, quantity: l.quantity || '1', rate: p.cost_price != null ? String(p.cost_price) : l.rate, gst_percent: p.tax_percent != null ? String(p.tax_percent) : l.gst_percent } : l))));
    window.setTimeout(() => document.getElementById(`dp-qty-${i}`)?.focus(), 30);
  }
  const valid = lines.filter((l) => l.product_id && num(l.quantity) > 0);
  const total = r2(valid.reduce((s, l) => s + num(l.quantity) * num(l.rate) * (1 + num(l.gst_percent) / 100), 0));
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!form.supplier_id) return setError('Select a supplier.');
    if (!valid.length) return setError('Add at least one product with a received quantity.');
    setBusy(true);
    try {
      const res = await post<Row>('/school/grns', { ...form, industryTypeId: industryId, source: 'manual', lines: valid.map(({ product_id, quantity, rate }) => ({ product_id, quantity, rate })) });
      onDone(`${res.data.grn_number} posted. Stock updated.`);
    } catch (err) { setError(messageOf(err, 'Unable to post.')); } finally { setBusy(false); }
  }
  return (
    <Modal title="Receive goods without a PO" onClose={onClose} wide>
      <form className="master-modal-form" onSubmit={submit}>
        <div className="field-grid">
          <label>Supplier *<select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}><option value="">Select supplier</option>{suppliers.filter((s) => s.status === 'Active').map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.supplier_name}</option>)}</select></label>
          <label>Supplier invoice no.<input value={form.supplier_invoice_no} onChange={(e) => setForm({ ...form, supplier_invoice_no: e.target.value })} /></label>
          <label>Received on<input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} /></label>
          <label>Received by<input value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} /></label>
        </div>
        <div style={{ overflowX: 'auto', flexShrink: 0 }}>
          <table><thead><tr><th style={{ width: 32 }}>#</th><th>Product</th><th style={{ width: 110 }}>Qty</th><th style={{ width: 130 }}>Rate (₹)</th><th style={{ width: 90 }}>GST %</th><th style={{ width: 130, textAlign: 'right' }}>Amount</th><th /></tr></thead><tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><ProductCombobox products={products} value={l.product_id} onPick={(id) => pick(i, id)} supplierId={form.supplier_id} supplierName={supplier?.supplier_name ?? ''} lastPaid={none} /></td>
                <td><input id={`dp-qty-${i}`} type="number" min="0" step="any" style={{ width: '100%' }} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} /></td>
                <td><input type="number" min="0" step="any" style={{ width: '100%' }} value={l.rate} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, rate: e.target.value } : x)))} /></td>
                <td><input type="number" min="0" max="100" step="any" style={{ width: '100%' }} value={l.gst_percent} onChange={(e) => setLines((ls) => ls.map((x, k) => (k === i ? { ...x, gst_percent: e.target.value } : x)))} /></td>
                <td style={{ textAlign: 'right' }}>{l.product_id ? money(num(l.quantity) * num(l.rate) * (1 + num(l.gst_percent) / 100)) : '—'}</td>
                <td><button type="button" className="quiet-button" onClick={() => setLines((ls) => blank(ls.filter((_, k) => k !== i)))}>✕</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <p style={{ textAlign: 'right', fontWeight: 700, margin: '4px 0', flexShrink: 0 }}>Receipt value {money(total)}</p>
        {error && <p className="error-message">{error}</p>}
        <div className="modal-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Posting…' : 'Post receipt'}</button></div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------ page
export function SchoolGrnPage() {
  const grns = useRows('/school/grns');
  const arr = useRows('/school/arrivals');
  const suppliers = useRows('/school/suppliers');
  const industryId = grns.industryId;
  const products = useProducts(industryId);
  const company = useCompany(industryId);
  const [bucket, setBucket] = useState('All');
  const [search, setSearch] = useState('');
  const [hStatus, setHStatus] = useState('All');
  const [receiving, setReceiving] = useState<Row | null>(null);
  const [direct, setDirect] = useState(false);
  const [view, setView] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = async () => { await Promise.all([grns.reload(), arr.reload()]); };
  // Coming from a PO ("Receive goods"): open that PO's receipt straight away.
  useEffect(() => {
    const wanted = sessionStorage.getItem('school-receive-po');
    if (!wanted || !arr.rows.length) return;
    const hit = arr.rows.find((a) => a.po_id === wanted);
    sessionStorage.removeItem('school-receive-po');
    if (hit) setReceiving(hit);
  }, [arr.rows]);
  useEffect(() => { const t = window.setInterval(() => { void arr.reload(); }, 60000); return () => window.clearInterval(t); }, [arr.reload]);

  const finish = async (msg: string) => { setReceiving(null); setDirect(false); setError(''); setMessage(msg); await refresh(); };
  async function receiveAll(a: Row) {
    if (!window.confirm(`Receive everything pending on ${a.po_number} (${a.pending_qty} units, ${money(a.pending_value)})?\n\nOnly do this if the full quantity has arrived.`)) return;
    setBusyId(a.po_id); setError(''); setMessage('');
    try { const res = await post<Row>(`/school/purchase-orders/${a.po_id}/receive?industryTypeId=${industryId}`, { industryTypeId: industryId }); await finish(`${res.data.grn_number} posted. Stock updated, ${a.po_number} fully received.`); }
    catch (err) { setError(messageOf(err, 'Unable to receive.')); } finally { setBusyId(''); }
  }
  async function cancelGrn(g: Row) {
    if (!window.confirm(`Cancel ${g.grn_number}? The received stock will be taken back.`)) return;
    setError(''); setMessage('');
    try { await post(`/school/grns/${g.id}/cancel?industryTypeId=${industryId}`, {}); setMessage(`${g.grn_number} cancelled and its stock taken back.`); setView(null); await refresh(); } catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }

  const month = isoToday().slice(0, 7);
  const posted = grns.rows.filter((g) => g.status === 'Posted');
  const kpis = [
    { label: 'Arriving today', value: arr.rows.filter((a) => a.bucket === 'Today').length },
    { label: 'Overdue arrivals', value: arr.rows.filter((a) => a.bucket === 'Overdue').length, tone: 'red' as const },
    { label: 'Awaiting receipt', value: money(arr.rows.reduce((s, a) => s + num(a.pending_value), 0)), sub: `${arr.rows.length} open order(s)` },
    { label: 'Received this month', value: money(posted.filter((g) => String(g.received_date).startsWith(month)).reduce((s, g) => s + num(g.total_amount), 0)) },
  ];
  const q = search.trim().toLowerCase();
  const shownArr = arr.rows.filter((a) => (bucket === 'All' || a.bucket === bucket) && (!q || `${a.po_number} ${a.supplier_name}`.toLowerCase().includes(q)));
  const shownGrn = grns.rows.filter((g) => (hStatus === 'All' || g.status === hStatus) && (!q || `${g.grn_number} ${g.school_suppliers?.supplier_name ?? ''} ${g.supplier_invoice_no ?? ''}`.toLowerCase().includes(q)));

  return (
    <PageShell module="GOODS RECEIPT" title="Receiving desk" description="Goods that are due, ready to book in. Check the quantities and confirm: stock, the PO and the supplier bill update by themselves." error={error || arr.error || grns.error} message={message}
      kpis={<Kpis items={kpis} />}
      actions={<>
        <input placeholder="Search PO, GRN, supplier or invoice" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 260 }} />
        <button type="button" className="quiet-button" onClick={() => setDirect(true)}>Receive without a PO</button>
      </>}>
      <h3 style={{ margin: '14px 0 6px' }}>Arriving ({shownArr.length})</h3>
      <Chips options={BUCKETS} value={bucket} onChange={setBucket} />
      {shownArr.length === 0 ? <p className="empty-state">{arr.loading ? 'Loading…' : arr.rows.length ? 'Nothing in this group.' : 'No orders are waiting for goods. Send a purchase order and it will appear here.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>PO</th><th>Supplier</th><th>Due</th><th>Shipment</th><th style={{ textAlign: 'right' }}>Pending</th><th style={{ textAlign: 'right' }}>Value</th><th /></tr></thead><tbody>
          {shownArr.map((a) => (
            <tr key={a.po_id}>
              <td><b>{a.po_number}</b></td><td>{a.supplier_name}</td>
              <td style={{ whiteSpace: 'nowrap' }}><Pill text={a.bucket === 'Overdue' ? `Overdue ${a.days_late}d` : a.bucket} tone={bucketTone(a.bucket)} /> <span style={hint}>{a.due_date ? day(a.due_date) : ''}</span></td>
              <td>{a.shipped_at ? <span title={`Shipment notice ${at(a.shipped_at)}`}><Pill text="Shipped" tone="purple" /> <span style={hint}>{[a.shipment_invoice_no && `inv ${a.shipment_invoice_no}`, a.shipment_vehicle_no].filter(Boolean).join(' · ')}</span></span> : a.supplier_response === 'Confirmed' ? <Pill text="Confirmed" tone="green" /> : <span style={hint}>—</span>}</td>
              <td style={{ textAlign: 'right' }}>{a.pending_qty}<div style={hint}>{a.lines.length} item(s)</div></td>
              <td style={{ textAlign: 'right' }}>{money(a.pending_value)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="primary-action" disabled={busyId === a.po_id} onClick={() => void receiveAll(a)}>{busyId === a.po_id ? 'Posting…' : 'Receive all'}</button>{' '}
                <button type="button" className="quiet-button" onClick={() => setReceiving(a)}>Check &amp; receive</button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      <h3 style={{ margin: '22px 0 6px' }}>Receipts ({shownGrn.length})</h3>
      <Chips options={['All', 'Posted', 'Cancelled']} value={hStatus} onChange={setHStatus} />
      {shownGrn.length === 0 ? <p className="empty-state">{grns.loading ? 'Loading…' : 'No goods receipts yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>PO</th><th>Supplier invoice</th><th>Received by</th><th>Entered</th><th style={{ textAlign: 'right' }}>Value</th><th>Status</th><th /></tr></thead><tbody>
          {shownGrn.map((g) => {
            const src = SOURCE[g.source] ?? SOURCE.manual;
            return (
              <tr key={g.id}>
                <td><b>{g.grn_number}</b></td><td>{day(g.received_date)}</td><td>{g.school_suppliers?.supplier_name ?? '—'}</td><td>{g.school_purchase_orders?.po_number ?? 'Direct'}</td><td>{g.supplier_invoice_no ?? '—'}</td><td>{g.received_by ?? '—'}</td>
                <td><Pill text={src.text} tone={src.tone} /></td><td style={{ textAlign: 'right' }}>{money(g.total_amount)}</td><td><Pill text={g.status} tone={g.status === 'Posted' ? 'green' : 'gray'} /></td>
                <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="quiet-button" onClick={() => setView(g)}>View</button>{' '}<button type="button" className="quiet-button" onClick={() => printGrn(g, company)}>Print</button>{' '}{g.status === 'Posted' && <button type="button" className="quiet-button" onClick={() => void cancelGrn(g)}>Cancel</button>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}

      {receiving && industryId && <ReceiveModal arrival={receiving} industryId={industryId} onClose={() => setReceiving(null)} onDone={(m) => void finish(m)} />}
      {direct && industryId && <DirectModal industryId={industryId} suppliers={suppliers.rows} products={products} onClose={() => setDirect(false)} onDone={(m) => void finish(m)} />}
      {view && (
        <Modal title={`${view.grn_number} · ${view.status}`} onClose={() => setView(null)}>
          <p style={hint}>{view.school_suppliers?.supplier_name} · {view.school_purchase_orders?.po_number ?? 'Direct purchase'} · received {day(view.received_date)}{view.received_by ? ` by ${view.received_by}` : ''}{view.supplier_invoice_no ? ` · invoice ${view.supplier_invoice_no}` : ''}{view.notes ? ` · ${view.notes}` : ''}</p>
          <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr></thead><tbody>
            {(view.lines as Row[]).map((l, i) => <tr key={i}><td>{l.product_code} — {l.product_name}</td><td>{l.quantity}</td><td>{money(l.rate)}</td><td>{l.gst_percent}%</td><td>{money(l.amount)}</td></tr>)}
          </tbody></table></div>
          <p style={{ textAlign: 'right' }}><b>Total {money(view.total_amount)}</b></p>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => printGrn(view, company)}>Print</button>{view.status === 'Posted' && <button type="button" className="quiet-button" onClick={() => void cancelGrn(view)}>Cancel receipt</button>}</div>
        </Modal>
      )}
    </PageShell>
  );
}