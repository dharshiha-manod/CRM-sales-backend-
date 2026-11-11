import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';

// Textile purchase side: Suppliers / Mills -> Purchase Orders -> Goods Receipt (creates the fabric rolls).
// Backed by /textile/suppliers, /textile/purchase-orders and /textile/grns.

type Supplier = {
  id: string; supplier_code: string; supplier_name: string; supplier_type: string; contact_person?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; city?: string | null; state?: string | null; gstin?: string | null; pan?: string | null;
  payment_terms_days: number; notes?: string | null; status: string;
};
type PoLine = { product_code: string; product_name: string; colour: string | null; quantity: number; received_quantity: number; rate: number; gst_percent: number };
type PurchaseOrder = {
  id: string; po_number: string; supplier_id: string; order_date: string; expected_date?: string | null; tolerance_percent: number;
  notes?: string | null; status: string; lines: PoLine[]; total_amount: number; textile_suppliers?: { supplier_name?: string } | null;
};
type GrnLine = { roll_number: string; product_name: string; colour: string | null; length_meters: number; quality_grade: string | null; inspection: string };
type Grn = {
  id: string; grn_number: string; received_date: string; supplier_invoice_no?: string | null; total_rolls: number; total_metres: number;
  total_amount: number; status: string; cancel_reason?: string | null; lines: GrnLine[]; supplier_id?: string; transporter?: string | null;
  textile_suppliers?: { supplier_name?: string } | null; textile_purchase_orders?: { po_number?: string } | null;
};
type Product = { id: string; product_code: string; product_name: string; unit?: string | null; cost_price?: number | null; tax_percent?: number | null; textile_details?: { colors?: { name: string }[]; gsm?: number | null; width?: number | null; widthUnit?: 'in' | 'cm' | null; lengthPerRoll?: number | null; lengthUnit?: 'm' | 'yd' | null } | null };

const money = (v: number | null | undefined) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const metres = (v: number) => `${Math.round(v * 100) / 100} m`;
const today = () => new Date().toISOString().slice(0, 10);
const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const colourNames = (p: Product | undefined) => (p?.textile_details?.colors ?? []).map((c) => c.name).filter(Boolean);
const GRN_PREFILL_KEY = 'textile.grn.prefillPo';

function useRows<T>(path: string, industryTypeId: string | null) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!industryTypeId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api<{ data: T[] }>(`${path}?industryTypeId=${industryTypeId}`);
      setRows(res.data ?? []);
    } catch (caught) {
      setError(messageOf(caught, 'Unable to load records.'));
    } finally {
      setLoading(false);
    }
  }, [path, industryTypeId]);
  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, reload: load };
}

function useProducts(industryTypeId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!industryTypeId) return;
    let cancelled = false;
    api<{ data: Product[] }>(`/products?industryTypeId=${industryTypeId}`)
      .then((res) => { if (!cancelled) setProducts(res.data ?? []); })
      .catch(() => { /* the form simply shows no products */ });
    return () => { cancelled = true; };
  }, [industryTypeId]);
  return products;
}

function Shell({ module, title, description, toolbar, error, message, children }: { module: string; title: string; description: string; toolbar?: ReactNode; error?: string; message?: string; children: ReactNode }) {
  const { config } = useIndustry();
  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">{config.label.toUpperCase()} · {module}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {toolbar && <div className="master-toolbar">{toolbar}</div>}
      {error && <p className="error-message">{error}</p>}
      {message && <p className="success-message">{message}</p>}
      {children}
    </section>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className="modal-backdrop modal-backdrop--center" role="dialog" aria-modal="true">
      <div className={`master-modal master-modal--center${wide ? ' master-modal--wide' : ''}`} style={wide ? { width: 'min(1100px, 96vw)', maxHeight: '92vh', overflowY: 'auto' } : { maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="modal-heading">
          <h3>{title}</h3>
          <button type="button" className="quiet-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Empty = ({ loading, text }: { loading: boolean; text: string }) => <p className="empty-state">{loading ? 'Loading…' : text}</p>;

// =================================================================== Suppliers / Mills
const SUPPLIER_FIELDS: { key: keyof Supplier; label: string; type?: 'select' | 'number' | 'textarea'; options?: string[]; required?: boolean; placeholder?: string }[] = [
  { key: 'supplier_name', label: 'Supplier / mill name', required: true },
  { key: 'supplier_type', label: 'Type', type: 'select', options: ['Mill', 'Trader', 'Agent'] },
  { key: 'contact_person', label: 'Contact person' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'gstin', label: 'GSTIN', placeholder: '33AABCM1234F1Z4' },
  { key: 'pan', label: 'PAN', placeholder: 'AABCM1234F' },
  { key: 'payment_terms_days', label: 'Payment terms (days)', type: 'number' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'inactive'] },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];
const blankSupplier = (): Record<string, string> => ({ supplier_name: '', supplier_type: 'Mill', payment_terms_days: '30', status: 'active' });

export function TextileSuppliersPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const { rows, loading, error, reload } = useRows<Supplier>('/textile/suppliers', activeIndustryTypeId);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>(blankSupplier());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => [r.supplier_code, r.supplier_name, r.city, r.gstin].some((v) => String(v ?? '').toLowerCase().includes(q))) : rows;
  }, [rows, search]);

  function openForm(supplier: Supplier | null) {
    setEditing(supplier);
    setFormError('');
    setForm(supplier ? Object.fromEntries(SUPPLIER_FIELDS.map((f) => [f.key, String(supplier[f.key] ?? '')])) : blankSupplier());
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const body = JSON.stringify({ ...form, industryTypeId: activeIndustryTypeId });
      await api(editing ? `/textile/suppliers/${editing.id}` : '/textile/suppliers', { method: editing ? 'PATCH' : 'POST', body });
      setOpen(false);
      setMessage(editing ? 'Supplier updated.' : 'Supplier added.');
      await reload();
    } catch (caught) {
      setFormError(messageOf(caught, 'Unable to save the supplier.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(supplier: Supplier) {
    if (!window.confirm(`Delete ${supplier.supplier_name}?`)) return;
    try {
      await api(`/textile/suppliers/${supplier.id}`, { method: 'DELETE' });
      setMessage('Supplier deleted.');
      await reload();
    } catch (caught) {
      setMessage('');
      window.alert(messageOf(caught, 'Unable to delete the supplier.'));
    }
  }

  return (
    <Shell module="SUPPLIERS / MILLS" title="Suppliers & mills" description="The mills and traders you buy fabric from. Every purchase order and goods receipt is linked to one of them."
      error={error} message={message}
      toolbar={<><input className="master-search" placeholder="Search supplier, city or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /><button type="button" className="primary-action" onClick={() => openForm(null)}>Add supplier</button></>}>
      {shown.length === 0 ? <Empty loading={loading} text="No suppliers yet. Add your first mill or trader." /> : (
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>City</th><th>GSTIN</th><th>Terms</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td>{s.supplier_code}</td><td>{s.supplier_name}</td><td>{s.supplier_type}</td><td>{s.city ?? '—'}</td><td>{s.gstin ?? '—'}</td>
                <td>{s.payment_terms_days} days</td><td><span className="status-badge">{s.status}</span></td>
                <td><button type="button" className="quiet-button" onClick={() => openForm(s)}>Edit</button> <button type="button" className="quiet-button" onClick={() => void remove(s)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <Modal title={editing ? `Edit ${editing.supplier_name}` : 'Add supplier'} onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              {SUPPLIER_FIELDS.map((f) => (
                <label key={f.key}>{f.label}{f.required ? ' *' : ''}
                  {f.type === 'select' ? (
                    <select value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>{f.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                  ) : f.type === 'textarea' ? (
                    <textarea value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  ) : (
                    <input type={f.type === 'number' ? 'number' : 'text'} min={f.type === 'number' ? 0 : undefined} placeholder={f.placeholder} value={form[f.key] ?? ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  )}
                </label>
              ))}
            </div>
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary-action" disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}

// =================================================================== Purchase orders
type FormLine = { product_code: string; colour: string; quantity: string; rate: string; gst_percent: string };
const blankLine = (): FormLine => ({ product_code: '', colour: '', quantity: '', rate: '', gst_percent: '' });

export function TextilePurchaseOrdersPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const { rows, loading, error, reload } = useRows<PurchaseOrder>('/textile/purchase-orders', activeIndustryTypeId);
  const suppliers = useRows<Supplier>('/textile/suppliers', activeIndustryTypeId).rows;
  const products = useProducts(activeIndustryTypeId);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [head, setHead] = useState({ supplier_id: '', order_date: today(), expected_date: '', tolerance_percent: '0', notes: '' });
  const [lines, setLines] = useState<FormLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0) * (1 + (Number(l.gst_percent) || 0) / 100), 0), [lines]);

  function openForm(po: PurchaseOrder | null) {
    setEditingId(po?.id ?? null);
    setFormError('');
    setHead(po
      ? { supplier_id: po.supplier_id, order_date: po.order_date, expected_date: po.expected_date ?? '', tolerance_percent: String(po.tolerance_percent ?? 0), notes: po.notes ?? '' }
      : { supplier_id: '', order_date: today(), expected_date: '', tolerance_percent: '0', notes: '' });
    setLines(po ? po.lines.map((l) => ({ product_code: l.product_code, colour: l.colour ?? '', quantity: String(l.quantity), rate: String(l.rate), gst_percent: String(l.gst_percent) })) : [blankLine()]);
    setOpen(true);
  }

  function setLine(index: number, patch: Partial<FormLine>) {
    setLines((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function pickProduct(index: number, code: string) {
    const p = products.find((x) => x.product_code === code);
    setLine(index, { product_code: code, colour: '', rate: p?.cost_price != null ? String(p.cost_price) : '', gst_percent: p?.tax_percent != null ? String(p.tax_percent) : '' });
  }

  async function save(markOrdered: boolean) {
    setBusy(true);
    setFormError('');
    try {
      const payload = { ...head, lines: lines.filter((l) => l.product_code || Number(l.quantity) > 0) };
      if (editingId) {
        await api(`/textile/purchase-orders/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        if (markOrdered) await api(`/textile/purchase-orders/${editingId}`, { method: 'PATCH', body: JSON.stringify({ status: 'Ordered' }) });
      } else {
        await api('/textile/purchase-orders', { method: 'POST', body: JSON.stringify({ ...payload, industryTypeId: activeIndustryTypeId, status: markOrdered ? 'Ordered' : 'Draft' }) });
      }
      setOpen(false);
      setMessage(markOrdered ? 'Purchase order placed.' : 'Purchase order saved as draft.');
      await reload();
    } catch (caught) {
      setFormError(messageOf(caught, 'Unable to save the purchase order.'));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(po: PurchaseOrder, status: 'Ordered' | 'Cancelled' | 'Closed') {
    if (status !== 'Ordered' && !window.confirm(`${status === 'Cancelled' ? 'Cancel' : 'Close'} ${po.po_number}?`)) return;
    try {
      await api(`/textile/purchase-orders/${po.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMessage(`${po.po_number} is now ${status}.`);
      await reload();
    } catch (caught) {
      window.alert(messageOf(caught, 'Unable to change the status.'));
    }
  }
  async function remove(po: PurchaseOrder) {
    if (!window.confirm(`Delete draft ${po.po_number}?`)) return;
    try {
      await api(`/textile/purchase-orders/${po.id}`, { method: 'DELETE' });
      setMessage('Draft deleted.');
      await reload();
    } catch (caught) {
      window.alert(messageOf(caught, 'Unable to delete the order.'));
    }
  }

  return (
    <Shell module="PURCHASE ORDERS" title="Purchase orders" description="Order fabric from your mills. When the goods arrive, receive them against the order in Goods Receipt and the rolls are created for you."
      error={error} message={message} toolbar={<button type="button" className="primary-action" onClick={() => openForm(null)}>New purchase order</button>}>
      {rows.length === 0 ? <Empty loading={loading} text="No purchase orders yet." /> : (
        <table>
          <thead><tr><th>PO number</th><th>Supplier</th><th>Date</th><th>Ordered / received</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((po) => {
              const ordered = po.lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
              const received = po.lines.reduce((s, l) => s + Number(l.received_quantity || 0), 0);
              return (
                <tr key={po.id}>
                  <td>{po.po_number}</td><td>{po.textile_suppliers?.supplier_name ?? '—'}</td><td>{po.order_date}</td>
                  <td>{metres(ordered)} / {metres(received)}</td><td>{money(po.total_amount)}</td><td><span className="status-badge">{po.status}</span></td>
                  <td>
                    {po.status === 'Draft' && <><button type="button" className="quiet-button" onClick={() => openForm(po)}>Edit</button> <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Ordered')}>Place order</button> <button type="button" className="quiet-button" onClick={() => void remove(po)}>Delete</button></>}
                    {(po.status === 'Ordered' || po.status === 'Partially Received') && <button type="button" className="primary-action" onClick={() => { sessionStorage.setItem(GRN_PREFILL_KEY, po.id); window.location.hash = '#industry:textile:goods-receipt'; }}>Receive goods</button>}{' '}
                    {po.status === 'Ordered' && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Cancelled')}>Cancel</button>}
                    {po.status === 'Partially Received' && <button type="button" className="quiet-button" onClick={() => void setStatus(po, 'Closed')}>Close short</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && (
              <Modal wide title={editingId ? 'Edit purchase order' : 'New purchase order'} onClose={() => setOpen(false)}>
          <div className="master-modal-form">
          <div className="field-grid">
            <label>Supplier *
              <select value={head.supplier_id} onChange={(e) => setHead({ ...head, supplier_id: e.target.value })}>
                <option value="">Select supplier</option>
                {suppliers.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.supplier_name} ({s.supplier_code})</option>)}
              </select>
            </label>
            <label>Order date<input type="date" value={head.order_date} onChange={(e) => setHead({ ...head, order_date: e.target.value })} /></label>
            <label>Expected delivery<input type="date" value={head.expected_date} onChange={(e) => setHead({ ...head, expected_date: e.target.value })} /></label>
            <label>Over/short tolerance %<input type="number" min={0} max={100} value={head.tolerance_percent} onChange={(e) => setHead({ ...head, tolerance_percent: e.target.value })} /></label>
          </div>
          <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Fabric product</th><th>Colour</th><th>Metres</th><th>Rate / m</th><th>GST %</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const colours = colourNames(products.find((p) => p.product_code === l.product_code));
                return (
                  <tr key={i}>
                    <td><select value={l.product_code} onChange={(e) => pickProduct(i, e.target.value)}><option value="">Select product</option>{products.map((p) => <option key={p.id} value={p.product_code}>{p.product_name} ({p.product_code})</option>)}</select></td>
                    <td>{colours.length ? <select value={l.colour} onChange={(e) => setLine(i, { colour: e.target.value })}><option value="">Select colour</option>{colours.map((c) => <option key={c} value={c}>{c}</option>)}</select> : '—'}</td>
                    <td><input type="number" min={0} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                    <td><input type="number" min={0} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                    <td><input type="number" min={0} max={100} value={l.gst_percent} onChange={(e) => setLine(i, { gst_percent: e.target.value })} /></td>
                    <td><button type="button" className="quiet-button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, x) => x !== i))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <p><button type="button" className="quiet-button" onClick={() => setLines([...lines, blankLine()])}>Add another fabric line</button> <strong style={{ marginLeft: '1rem' }}>Total with GST: {money(total)}</strong></p>
          <label>Notes<textarea value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></label>
          {formError && <p className="error-message">{formError}</p>}
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => void save(false)}>Save as draft</button>
                       <button type="button" className="primary-action" disabled={busy} onClick={() => void save(true)}>{busy ? 'Saving…' : 'Save & place order'}</button>
          </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

// =================================================================== Goods receipt (creates the rolls)
type RollRow = { roll_number: string; product_code: string; colour: string; length_meters: string; lot_number: string; gsm: string; width_inches: string; quality_grade: string; warehouse_location: string; inspection: string };
const lineKey = (l: PoLine) => `${l.product_code}|${l.colour ?? ''}`;
// One roll per fabric line that still has metres pending; length = pending metres (split it with "Add these rolls" if it arrives as several rolls).
// GSM, width (converted to inches) and standard roll length come from the product master.
const fabricDefaults = (products: Product[], code: string) => {
  const td = products.find((p) => p.product_code === code)?.textile_details;
  const width = td?.width == null ? '' : String(td.widthUnit === 'cm' ? Math.round((Number(td.width) / 2.54) * 100) / 100 : td.width);
  const perRoll = td?.lengthPerRoll ? Math.round(Number(td.lengthPerRoll) * (td.lengthUnit === 'yd' ? 0.9144 : 1) * 100) / 100 : 0;
  return { gsm: td?.gsm == null ? '' : String(td.gsm), width_inches: width, perRoll };
};
// Each PO line with metres pending becomes one roll of those metres. Split it with "Add these rolls" if the mill sends several rolls.
const rollsFromPo = (order: PurchaseOrder, products: Product[]): RollRow[] => order.lines.flatMap((l) => {
  const left = Math.round((Number(l.quantity || 0) - Number(l.received_quantity || 0)) * 100) / 100;
  if (!(left > 0)) return [];
  const d = fabricDefaults(products, l.product_code);
  const base = { roll_number: '', product_code: l.product_code, colour: l.colour ?? '', lot_number: '', gsm: d.gsm, width_inches: d.width_inches, quality_grade: '', warehouse_location: '', inspection: 'Pass' };
  return [{ ...base, length_meters: String(left) }];
});

export function TextileGrnPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const { rows, loading, error, reload } = useRows<Grn>('/textile/grns', activeIndustryTypeId);
   const orders = useRows<PurchaseOrder>('/textile/purchase-orders', activeIndustryTypeId);
  const products = useProducts(activeIndustryTypeId);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Grn | null>(null);
  const [head, setHead] = useState({ po_id: '', received_date: today(), supplier_invoice_no: '', transporter: '', vehicle_number: '', lr_number: '', notes: '' });
  const [rolls, setRolls] = useState<RollRow[]>([]);
  const [bulk, setBulk] = useState({ key: '', count: '1', length: '', lot: '', location: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  const receivable = useMemo(() => orders.rows.filter((po) => po.status === 'Ordered' || po.status === 'Partially Received'), [orders.rows]);
  const po = receivable.find((x) => x.id === head.po_id);
  const lastTransporter = (supplierId: string) => rows.find((g) => g.supplier_id === supplierId && g.transporter)?.transporter ?? '';
   const totalMetres = rolls.reduce((s, r) => s + (Number(r.length_meters) || 0), 0);

  // Arrived from "Receive goods" on the Purchase Orders page: open the form with that PO and its rolls already filled in.
  useEffect(() => {
     const id = sessionStorage.getItem(GRN_PREFILL_KEY);
       if (!id || !orders.rows.length || !products.length || loading) return;
    const target = orders.rows.find((x) => x.id === id && (x.status === 'Ordered' || x.status === 'Partially Received'));
    sessionStorage.removeItem(GRN_PREFILL_KEY);
    if (!target) return;
    setFormError('');
    setHead({ po_id: target.id, received_date: today(), supplier_invoice_no: '', transporter: lastTransporter(target.supplier_id), vehicle_number: '', lr_number: '', notes: '' });
      setRolls(rollsFromPo(target, products));
    setBulk({ key: '', count: '1', length: '', lot: '', location: '' });
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [orders.rows, products, loading]);

  function openForm() {
    setFormError('');
    setHead({ po_id: '', received_date: today(), supplier_invoice_no: '', transporter: '', vehicle_number: '', lr_number: '', notes: '' });
    setRolls([]);
    setBulk({ key: '', count: '1', length: '', lot: '', location: '' });
    setOpen(true);
  }

  function addBulk() {
    const line = po?.lines.find((l) => lineKey(l) === bulk.key);
    const count = Math.floor(Number(bulk.count));
    if (!line || !(count > 0) || !(Number(bulk.length) > 0)) { setFormError('Choose the fabric line, the number of rolls and the length of each roll.'); return; }
    setFormError('');
    const fresh: RollRow[] = Array.from({ length: count }, () => ({
      roll_number: '', product_code: line.product_code, colour: line.colour ?? '', length_meters: bulk.length, lot_number: bulk.lot,
          gsm: fabricDefaults(products, line.product_code).gsm, width_inches: fabricDefaults(products, line.product_code).width_inches, quality_grade: '', warehouse_location: bulk.location, inspection: 'Pass',
    }));
    setRolls((current) => [...current, ...fresh]);
  }
  function setRoll(index: number, patch: Partial<RollRow>) {
    setRolls((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await api('/textile/grns', { method: 'POST', body: JSON.stringify({ ...head, industryTypeId: activeIndustryTypeId, rolls }) });
      setOpen(false);
      setMessage('Goods received. The rolls are now in Fabric Roll and the purchase order is updated.');
      await reload();
      await orders.reload();
    } catch (caught) {
      setFormError(messageOf(caught, 'Unable to post the goods receipt.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelGrn(grn: Grn) {
    const reason = window.prompt(`Reason for cancelling ${grn.grn_number}?`);
    if (!reason) return;
    try {
      await api(`/textile/grns/${grn.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
      setMessage(`${grn.grn_number} cancelled and its rolls removed.`);
      await reload();
      await orders.reload();
    } catch (caught) {
      window.alert(messageOf(caught, 'Unable to cancel the receipt.'));
    }
  }

  return (
    <Shell module="GOODS RECEIPT" title="Goods receipt" description="Receive fabric against a purchase order. Each roll is created in stock with its lot, length and quality result — no roll is typed in twice."
      error={error} message={message} toolbar={<button type="button" className="primary-action" onClick={openForm}>Receive goods</button>}>
      {rows.length === 0 ? <Empty loading={loading} text="No goods receipts yet." /> : (
        <table>
          <thead><tr><th>GRN</th><th>PO</th><th>Supplier</th><th>Date</th><th>Rolls</th><th>Metres</th><th>Value</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td>{g.grn_number}</td><td>{g.textile_purchase_orders?.po_number ?? '—'}</td><td>{g.textile_suppliers?.supplier_name ?? '—'}</td><td>{g.received_date}</td>
                <td>{g.total_rolls}</td><td>{metres(g.total_metres)}</td><td>{money(g.total_amount)}</td><td><span className="status-badge">{g.status}</span></td>
                <td><button type="button" className="quiet-button" onClick={() => setViewing(g)}>View</button>{g.status === 'Posted' && <> <button type="button" className="quiet-button" onClick={() => void cancelGrn(g)}>Cancel</button></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {viewing && (
        <Modal wide title={`${viewing.grn_number} — ${viewing.total_rolls} rolls`} onClose={() => setViewing(null)}>
          {viewing.cancel_reason && <p className="error-message">Cancelled: {viewing.cancel_reason}</p>}
          <table>
            <thead><tr><th>Roll</th><th>Fabric</th><th>Colour</th><th>Length</th><th>Grade</th><th>Inspection</th></tr></thead>
            <tbody>{viewing.lines.map((l) => <tr key={l.roll_number}><td>{l.roll_number}</td><td>{l.product_name}</td><td>{l.colour ?? '—'}</td><td>{metres(l.length_meters)}</td><td>{l.quality_grade ?? '—'}</td><td>{l.inspection}</td></tr>)}</tbody>
          </table>
        </Modal>
      )}

      {open && (
               <Modal wide title="Receive goods" onClose={() => setOpen(false)}>
          <form className="master-modal-form" onSubmit={save}>
            <div className="field-grid">
              <label>Purchase order *
                  <select value={head.po_id} onChange={(e) => { const picked = receivable.find((x) => x.id === e.target.value); setHead({ ...head, po_id: e.target.value, transporter: head.transporter || (picked ? lastTransporter(picked.supplier_id) : '') }); setRolls(picked ? rollsFromPo(picked, products) : []); setBulk({ ...bulk, key: '' }); }}>
                  <option value="">Select an open order</option>
                  {receivable.map((p) => <option key={p.id} value={p.id}>{p.po_number} — {p.textile_suppliers?.supplier_name ?? 'Supplier'}</option>)}
                </select>
              </label>
              <label>Received date<input type="date" value={head.received_date} onChange={(e) => setHead({ ...head, received_date: e.target.value })} /></label>
              <label>Supplier invoice no.<input value={head.supplier_invoice_no} onChange={(e) => setHead({ ...head, supplier_invoice_no: e.target.value })} /></label>
              <label>Transporter<input value={head.transporter} onChange={(e) => setHead({ ...head, transporter: e.target.value })} /></label>
              <label>Vehicle number<input value={head.vehicle_number} onChange={(e) => setHead({ ...head, vehicle_number: e.target.value })} /></label>
              <label>LR number<input value={head.lr_number} onChange={(e) => setHead({ ...head, lr_number: e.target.value })} /></label>
            </div>

            {po && (
              <fieldset className="modal-fieldset">
                <legend>Add rolls in bulk</legend>
                <div className="field-grid">
                  <label>Fabric line
                    <select value={bulk.key} onChange={(e) => setBulk({ ...bulk, key: e.target.value })}>
                      <option value="">Select line</option>
                      {po.lines.map((l) => <option key={lineKey(l)} value={lineKey(l)}>{l.product_name}{l.colour ? ` (${l.colour})` : ''} — {metres(Math.max(0, l.quantity - l.received_quantity))} pending</option>)}
                    </select>
                  </label>
                  <label>Number of rolls<input type="number" min={1} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} /></label>
                  <label>Length of each (m)<input type="number" min={0} value={bulk.length} onChange={(e) => setBulk({ ...bulk, length: e.target.value })} /></label>
                  <label>Lot number<input value={bulk.lot} onChange={(e) => setBulk({ ...bulk, lot: e.target.value })} /></label>
                  <label>Warehouse location<input value={bulk.location} onChange={(e) => setBulk({ ...bulk, location: e.target.value })} placeholder="e.g. Rack B-12" /></label>
                </div>
                <button type="button" className="quiet-button" onClick={addBulk}>Add these rolls</button>
              </fieldset>
            )}

            {rolls.length > 0 && (
              <>
                <table>
                  <thead><tr><th>#</th><th>Fabric</th><th>Roll no. (auto if blank)</th><th>Length (m)</th><th>Lot</th><th>GSM</th><th>Width (in)</th><th>Grade</th><th>Location</th><th>Quality check</th><th /></tr></thead>
                  <tbody>
                    {rolls.map((r, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{po?.lines.find((l) => l.product_code === r.product_code)?.product_name ?? r.product_code}{r.colour ? ` (${r.colour})` : ''}</td>
                        <td><input value={r.roll_number} onChange={(e) => setRoll(i, { roll_number: e.target.value })} /></td>
                        <td><input type="number" min={0} value={r.length_meters} onChange={(e) => setRoll(i, { length_meters: e.target.value })} /></td>
                        <td><input value={r.lot_number} onChange={(e) => setRoll(i, { lot_number: e.target.value })} /></td>
                        <td><input type="number" min={0} value={r.gsm} onChange={(e) => setRoll(i, { gsm: e.target.value })} /></td>
                        <td><input type="number" min={0} value={r.width_inches} onChange={(e) => setRoll(i, { width_inches: e.target.value })} /></td>
                        <td><select value={r.quality_grade} onChange={(e) => setRoll(i, { quality_grade: e.target.value })}><option value="">—</option><option>A</option><option>B</option><option>C</option><option>Reject</option></select></td>
                        <td><input value={r.warehouse_location} onChange={(e) => setRoll(i, { warehouse_location: e.target.value })} /></td>
                        <td><select value={r.inspection} onChange={(e) => setRoll(i, { inspection: e.target.value })}><option>Pass</option><option>Fail</option><option value="Pending">Pending (inspect later)</option></select></td>
                        <td><button type="button" className="quiet-button" onClick={() => setRolls(rolls.filter((_, x) => x !== i))}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p><strong>{rolls.length} rolls · {metres(totalMetres)}</strong></p>
              </>
            )}

            <label>Notes<textarea value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></label>
            {formError && <p className="error-message">{formError}</p>}
            <div className="modal-actions">
              <button type="button" className="quiet-button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="primary-action" disabled={busy || !head.po_id || rolls.length === 0}>{busy ? 'Posting…' : 'Post goods receipt'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}