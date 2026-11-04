/* eslint-disable @typescript-eslint/no-explicit-any */
// Pharma Automation Center: one screen for everything the system now does by itself (and the one-click approvals it leaves for a person).
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import './PharmaAutomationPage.css';
import { Actions, Loading, Page, Status, Table, money, money0, msgOf, send, dShow, useIndustryId, useList, useProducts } from './PharmaDistributorPages';

type Row = Record<string, any>;
const go = (module: string) => { window.location.hash = `#industry:pharma:${module}`; };
const TABS = [['today', 'Today'], ['reorder', 'Auto-reorder'], ['sales', 'Invoices & reminders'], ['bills', 'Supplier bills'], ['expiry', 'Expiry & recall'], ['settings', 'Settings']] as const;
type Tab = typeof TABS[number][0];

function useGet<T = Row[]>(path: string, it: string | null, fallback: T) {
  const [data, setData] = useState<T>(fallback); const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!it) return; setLoading(true);
    try { const r = await api<{ data: T }>(`${path}${path.includes('?') ? '&' : '?'}industryTypeId=${encodeURIComponent(it)}`); setData(r.data ?? fallback); setErr(''); }
    catch (e) { setErr(msgOf(e)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, it]);
  useEffect(() => { void load(); }, [load]);
  return { data, err, loading, reload: load };
}
function useAction(it: string | null, after: () => void | Promise<void>) {
  const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const run = async (key: string, method: string, path: string, body: Row | undefined, say: (d: any) => string) => {
    setBusy(key); setErr(''); setMsg('');
    try { const r = await send(method, path, { ...(body ?? {}), industryTypeId: it }); setMsg(say(r.data)); await after(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
  };
  return { busy, msg, err, run };
}
const Card = ({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) => <div className="pha-card"><h3>{title}</h3>{hint && <p className="pd-muted" style={{ margin: '0 0 .7rem' }}>{hint}</p>}{children}</div>;

// ------------------------------------------------------------------ Today
const Stat = ({ label, value, sub, tone, icon, onClick }: { label: string; value: ReactNode; sub?: string; tone?: string; icon?: string; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className="kpi-card" data-tone={tone ?? 'ink'} data-click={onClick ? '1' : '0'} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}>
    {icon && <span className="kpi-ico" aria-hidden="true">{icon}</span>}<div><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div></button>
);
const TODAY_CSS = `
.pt-two{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:18px;align-items:start;margin-top:20px}
@media(max-width:980px){.pt-two{grid-template-columns:1fr}}
.pt-card{border:1px solid #e5e2d8;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 1px 3px rgba(17,24,39,.05)}
.pt-card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid #eeece3}
.pt-card-h h3{margin:0;font-size:15px;color:#111827}
.pt-card-h p{margin:2px 0 0;font-size:12.5px;color:#6b7280}
.pt-badge{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;background:#fef3c7;color:#92400e}
.pt-row{display:flex;align-items:center;gap:14px;width:100%;padding:15px 20px!important;border:0!important;border-bottom:1px solid #f1efe7!important;border-radius:0!important;background:#fff!important;text-align:left;cursor:pointer;color:inherit!important;transition:background .12s}
.pt-row:last-child{border-bottom:0!important}
.pt-row:hover{background:#faf9f5!important}
.pt-ico{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;font-size:17px;flex:none}
.pt-red .pt-ico{background:#fdecea;color:#b42318}.pt-amber .pt-ico{background:#fef3c7;color:#b45309}.pt-blue .pt-ico{background:#e8f0fe;color:#1d4ed8}
.pt-txt{flex:1;min-width:0}
.pt-txt b{display:block;font-size:14px;font-weight:600;color:#111827}
.pt-txt small{display:block;font-size:12.5px;color:#6b7280;margin-top:2px}
.pt-val{font-size:16px;font-weight:700;color:#111827;white-space:nowrap}
.pt-go{color:#9ca3af;font-size:20px}
.pt-clear{padding:38px 20px;text-align:center}
.pt-clear i{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:#e7f6ec;color:#15803d;font-style:normal;font-size:26px;margin:0 auto 12px}
.pt-clear b{display:block;font-size:15px;color:#111827}
.pt-clear small{display:block;color:#6b7280;margin-top:4px;font-size:13px}
.pt-auto-h{background:linear-gradient(135deg,#ecfdf3,#f0f7ff)}
.pt-live{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:#15803d;margin-bottom:4px}
.pt-live::before{content:'';width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 3px #bbf7d0}
.pt-run{height:34px;padding:0 14px!important;border-radius:10px!important;background:#111827!important;color:#fff!important;border:1px solid #111827!important;font-weight:600!important;font-size:13px!important;white-space:nowrap}
.pt-run:hover:not(:disabled){background:#2563eb!important;border-color:#2563eb!important}
.pt-job{display:flex;align-items:center;gap:12px;padding:13px 20px;border-bottom:1px solid #f1efe7}
.pt-job:last-child{border-bottom:0}
.pt-job-ok{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:#dcfce7;color:#15803d;flex:none}
.pt-job-off{background:#f3f4f6;color:#9ca3af}
.pt-job b{display:block;font-size:13.5px;font-weight:600;color:#111827}
.pt-job small{display:block;font-size:12px;color:#6b7280;margin-top:1px}
`;
function Today({ it, openTab }: { it: string; openTab: (t: Tab) => void }) {
  const t = useGet<Row | null>('/pharma/automation/today', it, null);
  const a = useAction(it, t.reload);
  const d = t.data;
  type Item = { tone: 'red' | 'amber' | 'blue'; icon: string; title: string; sub: string; value: string; onClick: () => void };
  const items: Item[] = [];
  if (d) {
    if (d.expiry.expiredWithStock > 0) items.push({ tone: 'red', icon: '✕', title: 'Expired stock', sub: 'Return to supplier or write off', value: String(d.expiry.expiredWithStock), onClick: () => openTab('expiry') });
    if (d.openRecalls > 0) items.push({ tone: 'red', icon: '⚑', title: 'Open recalls', sub: 'Customers are notified automatically', value: String(d.openRecalls), onClick: () => openTab('expiry') });
    if (d.receivables.overdue > 0) items.push({ tone: 'red', icon: '!', title: 'Customer payments overdue', sub: `${d.receivables.overdueInvoices} invoice(s)`, value: money0(d.receivables.overdue), onClick: () => openTab('sales') });
    if (d.payables.overdue > 0) items.push({ tone: 'red', icon: '!', title: 'Supplier bills overdue', sub: `${d.payables.overdueBills} bill(s)`, value: money0(d.payables.overdue), onClick: () => openTab('bills') });
    if (d.goodsDueToday > 0) items.push({ tone: 'amber', icon: '▣', title: 'Goods not received yet', sub: 'Purchase orders past the expected date', value: String(d.goodsDueToday), onClick: () => go('purchase-order') });
    if (d.reorder.suggested > 0) items.push({ tone: 'amber', icon: '↻', title: 'Low stock to reorder', sub: d.reorder.withoutSupplier ? `${d.reorder.withoutSupplier} need a supplier` : 'Draft orders can be created', value: String(d.reorder.suggested), onClick: () => openTab('reorder') });
    if (d.draftPOsToApprove > 0) items.push({ tone: 'blue', icon: '✎', title: 'Draft purchase orders', sub: 'Auto-created, approve to order', value: String(d.draftPOsToApprove), onClick: () => go('purchase-order') });
    if (d.invoicesToIssue > 0) items.push({ tone: 'blue', icon: '▤', title: 'Orders waiting for an invoice', sub: d.settings.auto_invoice === 'off' ? 'Auto-invoice is off' : `Auto-invoice: ${d.settings.auto_invoice}`, value: String(d.invoicesToIssue), onClick: () => openTab('sales') });
  }
  const invoiceOn = !!d && d.settings.auto_invoice !== 'off';
  const jobs: [string, string, boolean][] = [
    ['Reorder drafts', 'Low stock turns into draft purchase orders', true],
    ['Payment reminders', 'Follow-ups, email and WhatsApp before and after due date', true],
    ['Supplier dues', 'Bills tracked by due date from each GRN', true],
    ['Expiry and recall', 'Expired stock flagged, recall notices sent', true],
    ['GST invoices', invoiceOn ? `Issued automatically (${d?.settings.auto_invoice})` : 'Auto-invoice is off. Turn it on in Settings', invoiceOn],
  ];
  return <>
    <style>{TODAY_CSS}</style>
    {(t.err || a.err) && <p className="error-message">{t.err || a.err}</p>}{a.msg && <p className="success-message">{a.msg}</p>}
    {!d ? <p className="pd-muted">Loading…</p> : <>
      <div className="kpi-grid" style={{ '--kpi-count': 4 } as any}>
        <Stat icon="⚡" label="Needs attention" value={items.length} sub={items.length ? 'items to act on' : 'all clear'} tone={items.length ? 'amber' : 'green'} />
        <Stat icon="!" label="Customers overdue" value={money0(d.receivables.overdue)} sub={`${d.receivables.overdueInvoices} invoice(s)`} tone="red" onClick={() => openTab('sales')} />
        <Stat icon="₹" label="Pay suppliers this week" value={money0(d.payables.dueToday + d.payables.dueThisWeek)} sub={`overdue ${money0(d.payables.overdue)}`} tone="blue" onClick={() => openTab('bills')} />
        <Stat icon="⏱" label="Expiring in 30 days" value={d.expiry.within30} sub={`${d.expiry.within90} within 90 days`} tone="amber" onClick={() => openTab('expiry')} />
      </div>
      <div className="pt-two">
        <div className="pt-card">
          <div className="pt-card-h"><div><h3>Needs your attention</h3><p>Only things that need a person. Click a row to open it.</p></div>{items.length > 0 && <span className="pt-badge">{items.length}</span>}</div>
          {items.length === 0
            ? <div className="pt-clear"><i>✓</i><b>All clear</b><small>Nothing needs your action right now.</small></div>
            : items.map((i) => <button key={i.title} type="button" className={`pt-row pt-${i.tone}`} onClick={i.onClick}><span className="pt-ico">{i.icon}</span><span className="pt-txt"><b>{i.title}</b><small>{i.sub}</small></span><span className="pt-val">{i.value}</span><span className="pt-go" aria-hidden="true">›</span></button>)}
        </div>
        <div className="pt-card">
          <div className="pt-card-h pt-auto-h"><div><span className="pt-live">Autopilot on</span><p>Runs by itself every hour</p></div>
            <button className="pt-run" type="button" disabled={!!a.busy} onClick={() => void a.run('run', 'POST', '/pharma/automation/run-all', {}, (r) => `Done. Reorder drafts: ${r.reorderDrafts ?? 0}, invoices issued: ${r.invoices?.issued?.length ?? 0}, reminders raised: ${r.reminders?.followUps ?? 0}, recall notices: ${r.recallNotices ?? 0}.`)}>{a.busy ? 'Running…' : 'Run now'}</button></div>
          {jobs.map(([name, sub, on]) => <div key={name} className="pt-job"><span className={`pt-job-ok${on ? '' : ' pt-job-off'}`}>{on ? '✓' : '–'}</span><div><b>{name}</b><small>{sub}</small></div></div>)}
        </div>
      </div>
    </>}
  </>;
}

// ------------------------------------------------------------------ Auto-reorder
function Reorder({ it }: { it: string }) {
  const plan = useGet<{ items: Row[]; unassigned: Row[] }>('/pharma/automation/reorder-plan', it, { items: [], unassigned: [] });
  const rules = useList('/pharma/automation/reorder-rules', it); const sup = useList('/pharma/suppliers', it); const products = useProducts(it);
  const [f, setF] = useState<Row>({});
  const a = useAction(it, async () => { await Promise.all([plan.reload(), rules.reload()]); });
  return <>
    {(plan.err || a.err) && <p className="error-message">{plan.err || a.err}</p>}{a.msg && <p className="success-message">{a.msg}</p>}
    <div className="pha-flow">
      <div className="pha-step"><b>1</b><div><strong>Stock runs low</strong><span>At or below the reorder level</span></div></div>
      <i aria-hidden="true">→</i>
      <div className="pha-step"><b>2</b><div><strong>Draft PO is created</strong><span>Automatically, every hour, using your rule</span></div></div>
      <i aria-hidden="true">→</i>
      <div className="pha-step"><b>3</b><div><strong>Approve and send</strong><span>Mark Ordered, or let auto-approve do it</span></div></div>
    </div>
    <Card title="Items that need ordering" hint="Stock (plus what is already on order) is at or below the reorder level. Quantity = recent sales or twice the reorder level, whichever is higher, unless you set a fixed quantity below.">
      <div className="master-toolbar"><span className="pd-muted"><span className="pha-pill pha-pill-amber">{plan.data.items.length} item(s) waiting</span> Drafts are created per supplier. Nothing is ordered until you mark the PO as Ordered.</span>
        <button className="primary-action" type="button" disabled={!plan.data.items.length || !!a.busy} onClick={() => void a.run('make', 'POST', '/pharma/automation/reorder/run', {}, (r) => `${r.created.length} draft purchase order(s) created: ${r.created.map((p: Row) => p.po_number).join(', ') || ''}.`)}>Create draft POs</button></div>
      <Table loading={plan.loading} rows={plan.data.items.map((r) => ({ ...r, id: r.product_code }))} hasAny={plan.data.items.length > 0} emptyIcon="" emptyText="Nothing to reorder. Stock is above the reorder levels."
        cols={[{ key: 'product_name', label: 'Product', render: (r) => <strong>{r.product_name}</strong> }, { key: 'stock', label: 'Stock', right: true, render: (r) => <span className="pha-pill pha-pill-red">{r.stock}</span> }, { key: 'reorder_level', label: 'Reorder level', right: true }, { key: 'on_order', label: 'On order', right: true }, { key: 'sold_recent', label: 'Sold (recent)', right: true }, { key: 'qty', label: 'Order qty', right: true, render: (r) => <strong>{r.qty}</strong> }, { key: 'supplier_name', label: 'Supplier', render: (r) => <span className="pha-pill pha-pill-blue">{r.supplier_name}</span> }, { key: 'basis', label: 'Basis', render: (r) => <span className={`pha-pill ${r.basis === 'fixed qty' ? 'pha-pill-green' : ''}`}>{r.basis}</span> }]} />
      {plan.data.unassigned.length > 0 && <><h4 style={{ margin: '1rem 0 .4rem' }}>No supplier known (set a preferred supplier below)</h4>
        <Table rows={plan.data.unassigned.map((r) => ({ ...r, id: r.product_code }))} cols={[{ key: 'product_name', label: 'Product' }, { key: 'stock', label: 'Stock', right: true }, { key: 'qty', label: 'Suggested qty', right: true }]} /></>}
    </Card>
    <Card title="Preferred supplier and fixed quantity" hint="Optional. Without a rule, the supplier of the last goods receipt for that product is used.">
      <div className="fieldset-grid pha-rule-form" style={{ marginBottom: '1rem' }}>
        <label>Product<select value={f.product_code ?? ''} onChange={(e) => setF({ ...f, product_code: e.target.value })}><option value="">Select product</option>{products.map((p: Row) => <option key={p.id} value={p.product_code}>{p.product_code} · {p.product_name}</option>)}</select></label>
        <label>Preferred supplier<select value={f.preferred_supplier_id ?? ''} onChange={(e) => setF({ ...f, preferred_supplier_id: e.target.value })}><option value="">Last supplier</option>{sup.rows.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
        <label>Fixed order qty (optional)<input type="number" min="1" value={f.reorder_qty ?? ''} onChange={(e) => setF({ ...f, reorder_qty: e.target.value })} /></label>
        <div className="pha-field-action"><button type="button" className="primary-action" disabled={!f.product_code || !!a.busy} onClick={() => void a.run('rule', 'PUT', '/pharma/automation/reorder-rules', f, () => 'Rule saved.')}>Save rule</button></div></div>
      <Table loading={rules.loading} rows={rules.rows} hasAny={rules.rows.length > 0} emptyIcon="" emptyText="No rules yet."
        cols={[{ key: 'product_code', label: 'Product code' }, { key: 's', label: 'Supplier', render: (r) => <span className="pha-pill pha-pill-blue">{r.pharma_suppliers?.supplier_name ?? 'Last supplier'}</span> }, { key: 'reorder_qty', label: 'Fixed qty', right: true, render: (r) => r.reorder_qty ?? 'auto' },
          { key: 'a', label: '', render: (r) => <button type="button" className="quiet-button" onClick={() => void a.run('del', 'DELETE', `/pharma/automation/reorder-rules/${r.id}`, undefined, () => 'Rule removed.')}>Remove</button> }]} />
    </Card>
  </>;
}

// ------------------------------------------------------------------ Invoices & reminders
function Sales({ it }: { it: string }) {
  const toIssue = useGet<Row[]>('/pharma/automation/invoices-to-issue', it, []); const dues = useGet<Row[]>('/pharma/automation/invoice-dues', it, []);
  const a = useAction(it, async () => { await Promise.all([toIssue.reload(), dues.reload()]); });
  return <>
    {(toIssue.err || dues.err || a.err) && <p className="error-message">{toIssue.err || dues.err || a.err}</p>}{a.msg && <p className="success-message">{a.msg}</p>}
    <Card title="Orders waiting for a GST invoice" hint="With auto-invoice on (Settings), these are invoiced by the system when they are confirmed or dispatched. Orders it cannot invoice (missing GSTIN/state, no GST %) stay here with the reason shown after a run.">
      <div className="master-toolbar"><span className="pd-muted">{toIssue.data.length} order(s)</span>
        <button className="primary-action" type="button" disabled={!toIssue.data.length || !!a.busy} onClick={() => void a.run('inv', 'POST', '/pharma/automation/invoices/run', {}, (r) => `Issued ${r.issued.length} invoice(s)${r.emailed ? `, emailed ${r.emailed}` : ''}.${r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).map((s: Row) => `${s.order} (${s.reason})`).join('; ')}` : ''}`)}>Issue invoices now</button></div>
      <Table loading={toIssue.loading} rows={toIssue.data.map((r) => ({ ...r, id: r.order_id }))} hasAny={toIssue.data.length > 0} emptyIcon="" emptyText="Every dispatched order has an invoice."
        cols={[{ key: 'order_number', label: 'Order' }, { key: 'client_name', label: 'Customer' }, { key: 'status', label: 'Status', render: (r) => <Status s={String(r.status)} /> }, { key: 'dispatch_status', label: 'Dispatch' }, { key: 'created_at', label: 'Created', render: (r) => dShow(r.created_at) }]} />
    </Card>
    <Card title="Unpaid invoices and payment reminders" hint="Reminders go out automatically before the due date, on it, and after it (see Settings): a follow-up for the rep, plus email / WhatsApp when configured. Payments recorded in Collections update this list.">
      <div className="master-toolbar"><span className="pd-muted">{dues.data.length} open invoice(s)</span>
        <button className="primary-action" type="button" disabled={!!a.busy} onClick={() => void a.run('rem', 'POST', '/pharma/automation/reminders/run', {}, (r) => `Checked ${r.checked}. New follow-ups: ${r.followUps}, emails: ${r.emails}, WhatsApp: ${r.whatsapp}.`)}>Send reminders now</button></div>
      <Table loading={dues.loading} rows={dues.data.map((r) => ({ ...r, id: r.invoice_id }))} hasAny={dues.data.length > 0} emptyIcon="" emptyText="No unpaid invoices."
        cols={[{ key: 'invoice_number', label: 'Invoice' }, { key: 'client_name', label: 'Customer' }, { key: 'due_date', label: 'Due', render: (r) => dShow(r.due_date) },
          { key: 'days_overdue', label: 'Days', render: (r) => r.days_overdue > 0 ? <span className="pd-over">{r.days_overdue} overdue</span> : r.days_overdue === 0 ? 'due today' : `in ${-r.days_overdue}` },
          { key: 'total', label: 'Invoice', right: true, render: (r) => money(r.total) }, { key: 'paid', label: 'Paid', right: true, render: (r) => money(r.paid) }, { key: 'open', label: 'Open', right: true, render: (r) => money(r.open) },
          { key: 'a', label: 'Actions', render: (r) => <>{r.whatsapp ? <a className="quiet-button pha-wa" href={r.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : <span className="pd-muted">no phone</span>}{' '}<button type="button" className="quiet-button" onClick={() => go('customer-outstanding')}>Collect</button></> }]} />
    </Card>
  </>;
}

// ------------------------------------------------------------------ Supplier bills
function Bills({ it }: { it: string }) {
  const bills = useGet<Row[]>('/pharma/automation/supplier-bills', it, []);
  return <>
    {bills.err && <p className="error-message">{bills.err}</p>}
    <Card title="Supplier bills by due date" hint="Each GRN is a bill due on the goods-received date plus the supplier's payment terms. Payments and purchase returns are applied to the oldest bill first.">
      <Table loading={bills.loading} rows={bills.data.map((r) => ({ ...r, id: r.grn_id }))} hasAny={bills.data.length > 0} emptyIcon="" emptyText="No unpaid supplier bills."
        cols={[{ key: 'supplier_name', label: 'Supplier' }, { key: 'grn_number', label: 'GRN' }, { key: 'supplier_invoice_no', label: 'Supplier invoice' }, { key: 'bill_date', label: 'Bill date', render: (r) => dShow(r.bill_date) }, { key: 'due_date', label: 'Due', render: (r) => dShow(r.due_date) },
          { key: 'days_overdue', label: 'Status', render: (r) => r.days_overdue > 0 ? <span className="pd-over">{r.days_overdue} day(s) overdue</span> : r.days_overdue === 0 ? 'due today' : `due in ${-r.days_overdue} day(s)` },
          { key: 'amount', label: 'Bill', right: true, render: (r) => money(r.amount) }, { key: 'open', label: 'Open', right: true, render: (r) => money(r.open) },
          { key: 'a', label: '', render: () => <button type="button" className="quiet-button" onClick={() => go('supplier-payment')}>Pay</button> }]} />
    </Card>
  </>;
}

// ------------------------------------------------------------------ Expiry & recall
function Expiry({ it }: { it: string }) {
  const exp = useGet<Row[]>('/pharma/automation/expiry-actions', it, []); const recalls = useList('/pharma/recalls', it);
  const [cust, setCust] = useState<{ code: string; rows: Row[] } | null>(null);
  const a = useAction(it, async () => { await Promise.all([exp.reload(), recalls.reload()]); });
  const showCustomers = async (r: Row) => { try { const x = await api<{ data: Row[] }>(`/pharma/automation/recall/${r.id}/customers?industryTypeId=${it}`); setCust({ code: r.recall_code, rows: x.data }); } catch (e) { alert(msgOf(e)); } };
  return <>
    {(exp.err || recalls.err || a.err) && <p className="error-message">{exp.err || recalls.err || a.err}</p>}{a.msg && <p className="success-message">{a.msg}</p>}
    <Card title="Near-expiry stock: what to do" hint="Within 90 days: push sales. Within 30 days: return to the supplier. Returning posts a purchase return, takes the stock out of the batch and reduces what you owe the supplier.">
      <Table loading={exp.loading} rows={exp.data.map((r) => ({ ...r, id: r.batch_id }))} hasAny={exp.data.length > 0} emptyIcon="" emptyText="No batches expiring within 90 days."
        cols={[{ key: 'product_name', label: 'Product' }, { key: 'batch_number', label: 'Batch' }, { key: 'expiry_date', label: 'Expiry', render: (r) => dShow(r.expiry_date) }, { key: 'days_left', label: 'Days left', right: true, render: (r) => r.days_left < 0 ? <span className="pd-over">{r.days_left}</span> : r.days_left }, { key: 'quantity', label: 'Qty', right: true }, { key: 'stock_value', label: 'Value', right: true, render: (r) => money0(r.stock_value) }, { key: 'supplier_name', label: 'Supplier' }, { key: 'action', label: 'Suggested action' },
          { key: 'a', label: '', render: (r) => r.can_return ? <button type="button" className="quiet-button" disabled={!!a.busy} onClick={() => { if (confirm(`Return all ${r.quantity} unit(s) of batch ${r.batch_number} to ${r.supplier_name}?`)) void a.run(`ret${r.batch_id}`, 'POST', '/pharma/automation/supplier-return', { batch_number: r.batch_number, source_type: 'expiry' }, (d) => `Purchase return ${d.return_number} posted.`); }}>Return to supplier</button> : null }]} />
    </Card>
    <Card title="Open recalls" hint="Customers who received the batch are notified automatically (email / WhatsApp when configured; the list below always has a WhatsApp link).">
      <Table loading={recalls.loading} rows={recalls.rows.filter((r) => r.status !== 'Closed')} hasAny={recalls.rows.some((r) => r.status !== 'Closed')} emptyIcon="" emptyText="No open recalls."
        cols={[{ key: 'recall_code', label: 'Recall' }, { key: 'product_name', label: 'Product' }, { key: 'batch_number', label: 'Batch' }, { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status', render: (r) => <Status s={String(r.status)} /> },
          { key: 'a', label: 'Actions', render: (r) => <>
            <button type="button" className="quiet-button" onClick={() => void showCustomers(r)}>Customers</button>{' '}
            <button type="button" className="quiet-button" disabled={!!a.busy} onClick={() => void a.run(`n${r.id}`, 'POST', `/pharma/automation/recall/${r.id}/notify`, {}, (d) => `Notified ${d.customers} new customer(s) (${d.emails} email, ${d.whatsapp} WhatsApp).`)}>Notify</button>{' '}
            <button type="button" className="quiet-button" disabled={!!a.busy} onClick={() => { if (confirm(`Return the remaining stock of batch ${r.batch_number} to its supplier?`)) void a.run(`r${r.id}`, 'POST', `/pharma/automation/recall/${r.id}/supplier-return`, {}, (d) => `Purchase return ${d.return_number} posted.`); }}>Return to supplier</button></> }]} />
      {cust && <div style={{ marginTop: '1rem' }}><h4>Customers who received the batch · {cust.code}</h4>
        <Table rows={cust.rows.map((r) => ({ ...r, id: r.client_id }))} hasAny={cust.rows.length > 0} emptyIcon="" emptyText="No customer received this batch."
          cols={[{ key: 'client_name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'orders', label: 'Orders', render: (r) => (r.orders ?? []).join(', ') }, { key: 'units', label: 'Units', right: true }, { key: 'w', label: '', render: (r) => r.whatsapp ? <a className="quiet-button pha-wa" href={r.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null }]} /></div>}
    </Card>
  </>;
}

// ------------------------------------------------------------------ Settings
function Settings({ it }: { it: string }) {
  const s = useGet<Row | null>('/pharma/automation/settings', it, null); const [f, setF] = useState<Row>({}); const [saving, setSaving] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (s.data) setF(s.data); }, [s.data]);
  const save = async () => { setSaving(true); setErr(''); setMsg(''); try { await send('PUT', '/pharma/automation/settings', { ...f, industryTypeId: it }); setMsg('Saved.'); await s.reload(); } catch (e) { setErr(msgOf(e)); } finally { setSaving(false); } };
  if (!s.data) return <p className="pd-muted">{s.err || 'Loading'}</p>;
  return <Card title="Automation settings" hint="Auto-invoice only applies to orders created after you switch it on. Email needs SMTP in the API environment. WhatsApp auto-send needs WHATSAPP_WEBHOOK_URL (your WhatsApp Business provider); without it you still get one-click WhatsApp links.">
    {(err || s.err) && <p className="error-message">{err || s.err}</p>}{msg && <p className="success-message">{msg}</p>}
    <div className="fieldset-grid">
      <label><input type="checkbox" checked={!!f.auto_reorder} onChange={(e) => setF({ ...f, auto_reorder: e.target.checked })} /> Create draft purchase orders automatically</label>
      <label>Reorder cover (days of sales)<input type="number" min="7" max="180" value={f.cover_days ?? 30} onChange={(e) => setF({ ...f, cover_days: e.target.value })} /></label>
      <label>Auto-invoice<select value={f.auto_invoice ?? 'off'} onChange={(e) => setF({ ...f, auto_invoice: e.target.value })}><option value="off">Off (manual)</option><option value="confirm">When the order is confirmed</option><option value="dispatch">When the order is dispatched</option></select></label>
      <label><input type="checkbox" checked={!!f.email_invoice} onChange={(e) => setF({ ...f, email_invoice: e.target.checked })} /> Email the invoice to the customer</label>
      <label><input type="checkbox" checked={!!f.auto_reminders} onChange={(e) => setF({ ...f, auto_reminders: e.target.checked })} /> Send payment reminders automatically</label>
      <label>Remind this many days before due<input type="number" min="0" max="30" value={f.remind_before_days ?? 3} onChange={(e) => setF({ ...f, remind_before_days: e.target.value })} /></label>
      <label>Overdue reminder after (days)<input type="number" min="1" max="90" value={f.remind_after_days ?? 7} onChange={(e) => setF({ ...f, remind_after_days: e.target.value })} /></label>
      <label><input type="checkbox" checked={!!f.auto_send_po} onChange={(e) => setF({ ...f, auto_send_po: e.target.checked })} /> Email / WhatsApp each purchase order to the supplier when it is ordered</label>
      <label>Auto-approve draft reorder POs up to (₹, 0 = off)<input type="number" min="0" value={f.auto_approve_po_below ?? 0} onChange={(e) => setF({ ...f, auto_approve_po_below: e.target.value })} /></label>
      <label>Expired stock<select value={f.auto_expiry_return ?? 'off'} onChange={(e) => setF({ ...f, auto_expiry_return: e.target.value })}><option value="off">I will return it myself</option><option value="expired">Return to the supplier automatically</option></select></label>
      <label>Escalate invoices overdue by (days, 0 = off)<input type="number" min="0" max="365" value={f.escalate_days ?? 0} onChange={(e) => setF({ ...f, escalate_days: e.target.value })} /></label>
      <label>Hold new orders when overdue by (days, 0 = off)<input type="number" min="0" max="365" value={f.credit_hold_days ?? 0} onChange={(e) => setF({ ...f, credit_hold_days: e.target.value })} /></label>
      <label><input type="checkbox" checked={!!f.digest_enabled} onChange={(e) => setF({ ...f, digest_enabled: e.target.checked })} /> Send me a daily summary</label>
      <label>Send at (hour 0-23, India time)<input type="number" min="0" max="23" value={f.digest_hour ?? 8} onChange={(e) => setF({ ...f, digest_hour: e.target.value })} /></label>
      <label>Summary email (also gets escalations)<input type="email" value={f.digest_email ?? ''} onChange={(e) => setF({ ...f, digest_email: e.target.value })} /></label>
      <label>Summary WhatsApp number<input value={f.digest_phone ?? ''} onChange={(e) => setF({ ...f, digest_phone: e.target.value })} /></label>
      <button type="button" className="quiet-button" onClick={() => void send('POST', '/pharma/automation/digest/send', { industryTypeId: it }).then((r) => alert(`Sent. Email: ${(r.data as any).emailed ? 'yes' : 'no'}, WhatsApp: ${(r.data as any).whatsapp ? 'yes' : 'no'}.`)).catch((e) => setErr(msgOf(e)))}>Send a test summary now</button></div>
    <Actions onCancel={() => setF(s.data ?? {})} onSave={() => void save()} saving={saving} label="Save settings" />
  </Card>;
}

export function PharmaAutomationPage() {
  const it = useIndustryId(); const [tab, setTab] = useState<Tab>('today');
  if (!it) return <Loading />;
  return <Page eyebrow="AUTOMATION" title="Automation Center" desc="What the system does for you: reorders, invoices, reminders, supplier due dates, expiry and recall actions.">
    <div className="pha"><div className="pha-tabs">{TABS.map(([k, label]) => <button key={k} type="button" className={`quiet-button${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{label}</button>)}</div>
    {tab === 'today' && <Today it={it} openTab={setTab} />}{tab === 'reorder' && <Reorder it={it} />}{tab === 'sales' && <Sales it={it} />}
    {tab === 'bills' && <Bills it={it} />}{tab === 'expiry' && <Expiry it={it} />}{tab === 'settings' && <Settings it={it} />}
  </div></Page>;
}