import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import './SchoolDeliveryPanel.css';
import './SchoolReturnsPanel.css';

type ReturnRow = {
  id: string; kind: 'return' | 'damage'; quantity: number; status: 'pending' | 'approved' | 'rejected';
  reason?: string | null; restock?: boolean | null; credit_client?: boolean | null; credit_amount?: number | null;
  products?: { product_code?: string; product_name?: string } | null;
};
export type SchoolReturnOrder = {
  id: string; status: string; dispatch_status?: string | null;
  sale_order_items?: Array<{ quantity: number; products?: { id?: string; product_code?: string; product_name?: string } | null }>;
};
const money = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const approvedCredit = (rows: ReturnRow[]) => Math.round(rows.filter((r) => r.status === 'approved').reduce((sum, r) => sum + Number(r.credit_amount ?? 0), 0) * 100) / 100;

/**
 * School only: goods that were dispatched / delivered can come back (wrong or damaged goods). An APPROVED entry is a
 * credit note on the order (the school owes that much less); "restock" also puts good units back on the shelf.
 */
export function SchoolReturnsPanel({ order, onChanged }: { order: SchoolReturnOrder; onChanged: (patch: { returns_credit: number }) => void }) {
  const eligible = (order.status === 'confirmed' || order.status === 'completed') && ['dispatched', 'delivered'].includes(order.dispatch_status ?? 'pending');
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [kind, setKind] = useState<'return' | 'damage'>('return');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [creditClient, setCreditClient] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const products = Array.from(new Map((order.sale_order_items ?? []).filter((i) => i.products?.id).map((i) => [i.products!.id as string, i.products!])).values());

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: ReturnRow[] }>(`/school/orders/${order.id}/returns`);
      setRows(res.data ?? []);
      return res.data ?? [];
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not load the returns.'); return null; }
  }, [order.id]);

  useEffect(() => { if (eligible) void load(); }, [eligible, load]);
  if (!eligible) return null;

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await work(); const fresh = await load(); if (fresh) onChanged({ returns_credit: approvedCredit(fresh) }); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };

  const submit = () => {
    const qty = Number(quantity);
    if (!productId) { setMessage('Choose the product.'); return; }
    if (!(qty > 0)) { setMessage('Enter a quantity greater than zero.'); return; }
    void run(async () => {
      await api('/school/returns', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, productId, quantity: qty, kind, reason: reason.trim() || null, restock: kind === 'return' ? restock : false, creditClient: kind === 'damage' ? creditClient : true }),
      });
      setQuantity(''); setReason('');
    });
  };
  const decide = (id: string, status: 'approved' | 'rejected') => void run(async () => { await api(`/school/returns/${id}/decision`, { method: 'POST', body: JSON.stringify({ status }) }); });
  const remove = (id: string) => void run(async () => { await api(`/school/returns/${id}`, { method: 'DELETE' }); });

  return (
    <div className="qd-panel">
      <div className="qd-panel-head">
        <span>Returns &amp; damage</span>
        <span className="qd-pill ok">{rows.length === 0 ? 'None' : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}</span>
      </div>

      {rows.length > 0 && (
        <div className="sr-list">
          {rows.map((r) => (
            <div className="sr-row" key={r.id}>
              <div className="sr-top">
                <span className="sr-name">{r.products?.product_name ?? 'Product'} × {r.quantity}</span>
                <span className={`qd-pill ${r.status === 'approved' ? 'ok' : 'warn'}`}>{r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Pending'}</span>
              </div>
              <div className="sr-meta">
                {r.kind === 'damage' ? 'Damage' : 'Return'}{r.restock ? ' · back to stock' : ''}{r.kind === 'damage' && r.credit_client === false ? ' · school bears the loss' : ` · credit ${money(r.credit_amount)}`}{r.reason ? ` · ${r.reason}` : ''}
              </div>
              {r.status === 'pending' && (
                <div className="sd-actions">
                  <button type="button" className="sd-btn success" disabled={busy} onClick={() => decide(r.id, 'approved')}>Approve</button>
                  <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => decide(r.id, 'rejected')}>Reject</button>
                  <button type="button" className="sd-btn ghost" disabled={busy} onClick={() => remove(r.id)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sd-form">
        <div className="sr-grid">
          <label className="sd-field">Product
            <select className="sr-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Choose product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.product_code ? `${p.product_code} — ` : ''}{p.product_name}</option>)}
            </select>
          </label>
          <label className="sd-field">Quantity
            <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label className="sd-field">Type
            <select className="sr-select" value={kind} onChange={(e) => setKind(e.target.value as 'return' | 'damage')}>
              <option value="return">Return</option>
              <option value="damage">Damage</option>
            </select>
          </label>
          <label className="sd-field">Reason (optional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Wrong size, torn, etc." />
          </label>
        </div>
        {kind === 'return' && <label className="sr-check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />Good units go back to stock</label>}
        {kind === 'damage' && <label className="sr-check"><input type="checkbox" checked={creditClient} onChange={(e) => setCreditClient(e.target.checked)} />Credit the school (untick if the school bears the loss)</label>}
        {message && <p className="sd-error" role="alert">{message}</p>}
        <div className="sd-actions">
          <button type="button" className="sd-btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
      <p className="sd-hint">An entry waits for approval. Approving it credits the school and, for good returns, puts the units back on the shelf.</p>
    </div>
  );
}