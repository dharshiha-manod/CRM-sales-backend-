import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';

// Textile GST sales invoices: Company & GST details, invoices per sales order (created by hand or automatically on dispatch),
// transport / LR details, e-way bill and e-invoice JSON, print and cancel. Backed by /textile/company-profile and /textile/invoices.

type Line = { product_name: string; colour: string | null; hsn_code: string | null; quantity: number; free_quantity: number; rate: number; taxable_value: number; gst_percent: number; cgst: number; sgst: number; igst: number; amount: number; roll_numbers?: string[] };
type Company = Record<string, string | null | undefined>;
type Invoice = {
  id: string; invoice_number: string; invoice_date: string; due_date?: string | null; supply_type: string; place_of_supply?: string | null; status: string;
  taxable_amount: number; cgst_amount: number; sgst_amount: number; igst_amount: number; round_off: number; total_amount: number; lines: Line[]; company?: Company | null;
  transporter_name?: string | null; transporter_gstin?: string | null; vehicle_number?: string | null; lr_number?: string | null; lr_date?: string | null;
  bales?: number | null; transport_mode?: string | null; transport_distance_km?: number | null; cancel_reason?: string | null;
  clients?: { client_name?: string; client_code?: string } | null; sale_orders?: { order_number?: string } | null;
};
type Pending = { id: string; order_number: string; client_name: string | null; total_amount: number; textile_delivery_status?: string | null };
type Export = { payload: unknown; missing: string[]; warnings: string[] };

const money = (v: number | null | undefined) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const COMPANY_FIELDS: { key: string; label: string; textarea?: boolean; placeholder?: string }[] = [
  { key: 'company_name', label: 'Company name *' }, { key: 'gstin', label: 'GSTIN', placeholder: '33AABCM1234F1Z4' }, { key: 'pan', label: 'PAN' },
  { key: 'invoice_prefix', label: 'Invoice prefix', placeholder: 'INV' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
  { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'PIN code (6 digits)' },
  { key: 'bank_name', label: 'Bank name' }, { key: 'bank_account', label: 'Bank account no.' }, { key: 'bank_ifsc', label: 'IFSC' },
  { key: 'address', label: 'Address', textarea: true }, { key: 'terms', label: 'Terms & conditions (printed on invoice)', textarea: true },
];
const TRANSPORT_FIELDS: { key: string; label: string; type?: string; options?: string[]; placeholder?: string }[] = [
  { key: 'transporter_name', label: 'Transporter name' }, { key: 'transporter_gstin', label: 'Transporter GSTIN' },
  { key: 'vehicle_number', label: 'Vehicle number', placeholder: 'TN 75 AB 1234' }, { key: 'lr_number', label: 'LR / GR number' },
  { key: 'lr_date', label: 'LR date', type: 'date' }, { key: 'bales', label: 'Number of bales / rolls', type: 'number' },
  { key: 'transport_mode', label: 'Mode', options: ['Road', 'Rail', 'Air', 'Ship'] }, { key: 'transport_distance_km', label: 'Distance (km)', type: 'number' },
];

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop modal-backdrop--center" role="dialog" aria-modal="true">
      <div className="master-modal master-modal--center" style={{ maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-heading"><h3>{title}</h3><button type="button" className="quiet-button" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function printInvoice(inv: Invoice) {
  const co = inv.company ?? {}; const client = inv.clients?.client_name ?? '';
  const rows = inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.product_name)}${l.colour ? ` (${esc(l.colour)})` : ''}${l.roll_numbers?.length ? `<br><small>Rolls: ${esc(l.roll_numbers.join(', '))}</small>` : ''}</td><td>${esc(l.hsn_code)}</td><td class="r">${l.quantity}${l.free_quantity ? ` + ${l.free_quantity} free` : ''} m</td><td class="r">${l.rate.toFixed(2)}</td><td class="r">${l.taxable_value.toFixed(2)}</td><td class="r">${l.gst_percent}%</td><td class="r">${l.amount.toFixed(2)}</td></tr>`).join('');
  const w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><title>${esc(inv.invoice_number)}</title><style>body{font:13px Arial;margin:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:5px}.r{text-align:right}h2{margin:0}small{color:#555}</style>
<h2>${esc(co.company_name)}</h2><div>${esc(co.address)} ${esc(co.city)} ${esc(co.state)} ${esc(co.pincode)}<br>GSTIN: ${esc(co.gstin)} · ${esc(co.phone)}</div><hr>
<h3>TAX INVOICE ${esc(inv.invoice_number)}</h3><div>Date: ${esc(inv.invoice_date)} · Due: ${esc(inv.due_date)} · Order: ${esc(inv.sale_orders?.order_number)}<br>Bill to: <b>${esc(client)}</b> · Place of supply: ${esc(inv.place_of_supply)} · ${esc(inv.supply_type)}</div><br>
<table><tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Taxable</th><th>GST</th><th>Amount</th></tr>${rows}</table><br>
<table style="width:45%;margin-left:auto"><tr><td>Taxable value</td><td class="r">${inv.taxable_amount.toFixed(2)}</td></tr>${inv.cgst_amount ? `<tr><td>CGST</td><td class="r">${inv.cgst_amount.toFixed(2)}</td></tr><tr><td>SGST</td><td class="r">${inv.sgst_amount.toFixed(2)}</td></tr>` : `<tr><td>IGST</td><td class="r">${inv.igst_amount.toFixed(2)}</td></tr>`}<tr><td>Round off</td><td class="r">${inv.round_off.toFixed(2)}</td></tr><tr><th>Total</th><th class="r">${inv.total_amount.toFixed(2)}</th></tr></table>
<p>Transport: ${esc(inv.transporter_name)} ${esc(inv.vehicle_number)} · LR ${esc(inv.lr_number)} · Bales ${esc(inv.bales)}</p>
<p>Bank: ${esc(co.bank_name)} A/c ${esc(co.bank_account)} IFSC ${esc(co.bank_ifsc)}</p><p><small>${esc(co.terms)}</small></p><script>window.print()</script>`);
  w.document.close();
}

export function TextileInvoicesPage() {
  const { config } = useIndustry();
  const { activeIndustryTypeId } = useIndustryScope();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [companyOpen, setCompanyOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [transportFor, setTransportFor] = useState<Invoice | null>(null);
  const [exportView, setExportView] = useState<{ title: string; file: string; data: Export } | null>(null);

  const load = useCallback(async () => {
    if (!activeIndustryTypeId) return;
    setLoading(true); setError('');
    const q = `?industryTypeId=${activeIndustryTypeId}`;
    try {
      const [inv, pend, prof] = await Promise.all([
        api<{ data: Invoice[] }>(`/textile/invoices${q}`), api<{ data: Pending[] }>(`/textile/invoices/pending-orders${q}`), api<{ data: Company | null }>(`/textile/company-profile${q}`),
      ]);
      setInvoices(inv.data ?? []); setPending(pend.data ?? []); setCompany(prof.data ?? null);
    } catch (e) { setError(messageOf(e, 'Unable to load invoices.')); } finally { setLoading(false); }
  }, [activeIndustryTypeId]);
  useEffect(() => { void load(); }, [load]);

  function openCompany() {
    setForm(Object.fromEntries(COMPANY_FIELDS.map((f) => [f.key, String(company?.[f.key] ?? (f.key === 'invoice_prefix' ? 'INV' : ''))]))); setFormError(''); setCompanyOpen(true);
  }
  async function saveCompany(e: FormEvent) {
    e.preventDefault(); setFormError('');
    try {
      await api('/textile/company-profile', { method: 'PUT', body: JSON.stringify({ ...form, industryTypeId: activeIndustryTypeId }) });
      setCompanyOpen(false); setMessage('Company & GST details saved.'); await load();
    } catch (err) { setFormError(messageOf(err, 'Unable to save.')); }
  }
  async function create(order: Pending) {
    setBusyId(order.id); setError(''); setMessage('');
    try {
      const res = await api<{ data: Invoice }>('/textile/invoices', { method: 'POST', body: JSON.stringify({ orderId: order.id, industryTypeId: activeIndustryTypeId }) });
      setMessage(`Invoice ${res.data.invoice_number} created for order ${order.order_number}.`); await load();
    } catch (err) { setError(messageOf(err, 'Unable to create the invoice.')); } finally { setBusyId(''); }
  }
  async function saveTransport(e: FormEvent) {
    e.preventDefault(); if (!transportFor) return; setFormError('');
    try {
      await api(`/textile/invoices/${transportFor.id}`, { method: 'PATCH', body: JSON.stringify(form) });
      setTransportFor(null); setMessage('Transport details saved.'); await load();
    } catch (err) { setFormError(messageOf(err, 'Unable to save.')); }
  }
  async function cancel(inv: Invoice) {
    const reason = window.prompt(`Cancel invoice ${inv.invoice_number}? Enter the reason:`);
    if (!reason) return;
    try { await api(`/textile/invoices/${inv.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); setMessage('Invoice cancelled.'); await load(); }
    catch (err) { setError(messageOf(err, 'Unable to cancel.')); }
  }
  async function showExport(inv: Invoice, kind: 'eway' | 'einvoice') {
    setBusyId(inv.id); setError('');
    try {
      const res = await api<{ data: Export }>(`/textile/invoices/${inv.id}/${kind}-json`);
      setExportView({ title: `${kind === 'eway' ? 'E-way bill' : 'E-invoice'} · ${inv.invoice_number}`, file: `${kind === 'eway' ? 'eway' : 'einvoice'}-${inv.invoice_number}.json`, data: res.data });
    } catch (err) { setError(messageOf(err, 'Unable to build the file.')); } finally { setBusyId(''); }
  }
  function openTransport(inv: Invoice) {
    setForm(Object.fromEntries(TRANSPORT_FIELDS.map((f) => [f.key, String((inv as unknown as Record<string, unknown>)[f.key] ?? (f.key === 'transport_mode' ? 'Road' : ''))]))); setFormError(''); setTransportFor(inv);
  }

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading"><div>
        <p className="eyebrow">{config.label.toUpperCase()} · GST SALES INVOICES</p><h2>GST sales invoices</h2>
        <p>Invoices are created automatically when an order is dispatched. Add transport / LR details, then download the e-way bill file for the portal.</p>
      </div></div>
      <div className="master-toolbar">
        <button type="button" className="primary-action" onClick={openCompany}>{company?.company_name ? 'Edit Company & GST' : 'Set up Company & GST'}</button>
        {!company?.company_name && <span className="error-message">Save your Company &amp; GST details first: they print on every invoice and switch on automatic invoicing.</span>}
      </div>
      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}

      <h3>Orders waiting for an invoice ({pending.length})</h3>
      {pending.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'Every confirmed order has an invoice.'}</p> : (
        <table><thead><tr><th>Order</th><th>Customer</th><th>Delivery</th><th>Order value</th><th /></tr></thead><tbody>
          {pending.map((o) => (
            <tr key={o.id}><td>{o.order_number}</td><td>{o.client_name ?? '—'}</td><td>{o.textile_delivery_status ?? 'Not dispatched'}</td><td>{money(o.total_amount)}</td>
              <td><button type="button" className="quiet-button" disabled={busyId === o.id} onClick={() => void create(o)}>{busyId === o.id ? 'Creating…' : 'Create invoice'}</button></td></tr>
          ))}
        </tbody></table>
      )}

      <h3>Invoices ({invoices.length})</h3>
      {invoices.length === 0 ? <p className="empty-state">{loading ? 'Loading…' : 'No invoices yet.'}</p> : (
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Order</th><th>Taxable</th><th>GST</th><th>Total</th><th>Transport / LR</th><th>Status</th><th /></tr></thead><tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.invoice_number}</td><td>{inv.invoice_date}</td><td>{inv.clients?.client_name ?? '—'}</td><td>{inv.sale_orders?.order_number ?? '—'}</td>
              <td>{money(inv.taxable_amount)}</td><td>{money(inv.cgst_amount + inv.sgst_amount + inv.igst_amount)}</td><td><b>{money(inv.total_amount)}</b></td>
              <td>{inv.vehicle_number || inv.lr_number ? `${inv.vehicle_number ?? ''} ${inv.lr_number ? `LR ${inv.lr_number}` : ''}` : '—'}</td>
              <td><span className="status-badge">{inv.status}</span></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="quiet-button" onClick={() => printInvoice(inv)}>Print</button>{' '}
                {inv.status === 'Issued' && <>
                  <button type="button" className="quiet-button" onClick={() => openTransport(inv)}>Transport</button>{' '}
                  <button type="button" className="quiet-button" disabled={busyId === inv.id} onClick={() => void showExport(inv, 'eway')}>E-way bill</button>{' '}
                  <button type="button" className="quiet-button" disabled={busyId === inv.id} onClick={() => void showExport(inv, 'einvoice')}>E-invoice</button>{' '}
                  <button type="button" className="quiet-button" onClick={() => void cancel(inv)}>Cancel</button>
                </>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}

      {companyOpen && (
        <Modal title="Company & GST details" onClose={() => setCompanyOpen(false)}>
          <form className="master-modal-form" onSubmit={saveCompany}>
            <div className="field-grid">{COMPANY_FIELDS.map((f) => (
              <label key={f.key}>{f.label}{f.textarea ? <textarea value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /> : <input placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}</label>
            ))}</div>
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setCompanyOpen(false)}>Cancel</button><button type="submit" className="primary-action">Save</button></div>
          </form>
        </Modal>
      )}
      {transportFor && (
        <Modal title={`Transport details · ${transportFor.invoice_number}`} onClose={() => setTransportFor(null)}>
          <form className="master-modal-form" onSubmit={saveTransport}>
            <div className="field-grid">{TRANSPORT_FIELDS.map((f) => (
              <label key={f.key}>{f.label}{f.options
                ? <select value={form[f.key] ?? 'Road'} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                : <input type={f.type ?? 'text'} min={f.type === 'number' ? 0 : undefined} placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />}</label>
            ))}</div>
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setTransportFor(null)}>Cancel</button><button type="submit" className="primary-action">Save</button></div>
          </form>
        </Modal>
      )}
      {exportView && (
        <Modal title={exportView.title} onClose={() => setExportView(null)}>
          {exportView.data.missing.length > 0 && <><p className="error-message">The portal will reject this file until you fix:</p><ul>{exportView.data.missing.map((m) => <li key={m}>{m}</li>)}</ul></>}
          {exportView.data.warnings.length > 0 && <ul>{exportView.data.warnings.map((m) => <li key={m}>{m}</li>)}</ul>}
          <p>Upload this file on the e-way bill / e-invoice portal (or give it to your GST software). The bill number and IRN come from the portal.</p>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setExportView(null)}>Close</button><button type="button" className="primary-action" onClick={() => download(exportView.file, exportView.data.payload)}>Download JSON</button></div>
        </Modal>
      )}
    </section>
  );
}
