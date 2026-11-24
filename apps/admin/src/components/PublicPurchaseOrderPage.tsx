/* eslint-disable @typescript-eslint/no-explicit-any */
import { CSSProperties, useEffect, useState } from 'react';

// Public page a supplier lands on from the purchase order e-mail (no login). Route: /po/:token
// Loading it reports "opened" to the buyer; Confirm / Decline answers the order. Backed by /public/school-po/:token.
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v ?? 0));
const page: CSSProperties = { minHeight: '100vh', background: '#f4f6f8', display: 'flex', justifyContent: 'center', padding: '28px 12px', fontFamily: 'Segoe UI, Helvetica, Arial, sans-serif', color: '#1f2937', boxSizing: 'border-box' };
const card: CSSProperties = { width: '100%', maxWidth: 760, background: '#fff', border: '1px solid #e5e9ef', borderRadius: 12, overflow: 'hidden', alignSelf: 'flex-start' };
const th: CSSProperties = { textAlign: 'left', padding: '10px 12px', background: '#f1f5f9', color: '#475569', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' };
const td: CSSProperties = { padding: '11px 12px', borderBottom: '1px solid #eef2f7', fontSize: 14 };
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? 'Something went wrong. Please try again.');
  return json.data;
}

export function PublicPurchaseOrderPage({ token }: { token: string }) {
  const [po, setPo] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState('');
  const [ship, setShip] = useState({ invoice_no: '', vehicle_no: '', eta: '', note: '' });
  const [shipped, setShipped] = useState(false);
  const [shipError, setShipError] = useState('');

  useEffect(() => {
    const t = encodeURIComponent(token);
    call(`/public/school-po/${t}`).then((d) => { setPo(d); void call(`/public/school-po/${t}/opened`, 'POST', {}).catch(() => undefined); }).catch((e) => setError(e.message));
  }, [token]);

  async function answer(decision: 'confirm' | 'decline') {
    if (decision === 'decline' && !window.confirm('Decline this purchase order?')) return;
    setSaving(true); setError('');
    try { const r = await call(`/public/school-po/${encodeURIComponent(token)}/respond`, 'POST', { decision, delivery_date: date || undefined, note }); setDone(r.supplier_response); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.'); } finally { setSaving(false); }
  }

  async function sendShipment() {
    setSaving(true); setShipError('');
    try { await call(`/public/school-po/${encodeURIComponent(token)}/shipped`, 'POST', ship); setShipped(true); }
    catch (e) { setShipError(e instanceof Error ? e.message : 'Unable to save.'); } finally { setSaving(false); }
  }

  if (error && !po) return <main style={page}><div style={{ ...card, padding: 32, textAlign: 'center' }}><h2>Purchase order unavailable</h2><p>{error}</p></div></main>;
  if (!po) return <main style={page}><div style={{ ...card, padding: 32, textAlign: 'center' }}>Loading purchase order…</div></main>;
  const answered = done || po.supplier_response;

  return (
    <main style={page}>
      <div style={card}>
        <header style={{ background: '#0f172a', color: '#fff', padding: '20px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 19, fontWeight: 700 }}>{po.company?.name ?? 'Purchase order'}</span>
          <span style={{ color: '#f59e0b', fontWeight: 700, letterSpacing: 1, fontSize: 12 }}>PURCHASE ORDER · {po.po_number}</span>
        </header>
        <div style={{ padding: '22px 26px' }}>
          <p style={{ margin: '0 0 4px', color: '#475569', fontSize: 14 }}>To: <b>{po.supplier_name}</b></p>
          <p style={{ margin: '0 0 16px', color: '#475569', fontSize: 14 }}>Order date {String(po.order_date).slice(0, 10)}{po.expected_date ? ` · Needed by ${String(po.expected_date).slice(0, 10)}` : ''}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e2e8f0' }}>
              <thead><tr><th style={th}>Item</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Rate</th><th style={{ ...th, textAlign: 'right' }}>GST</th><th style={{ ...th, textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>{(po.lines as Record<string, any>[]).map((l, i) => <tr key={i}><td style={td}>{l.product_name}<div style={{ fontSize: 12, color: '#94a3b8' }}>{l.product_code}</div></td><td style={{ ...td, textAlign: 'right' }}>{l.quantity}</td><td style={{ ...td, textAlign: 'right' }}>{money(l.rate)}</td><td style={{ ...td, textAlign: 'right' }}>{l.gst_percent}%</td><td style={{ ...td, textAlign: 'right' }}>{money(l.amount)}</td></tr>)}</tbody>
            </table>
          </div>
          <p style={{ textAlign: 'right', margin: '12px 0 0', color: '#64748b', fontSize: 14 }}>Sub-total {money(po.subtotal)} · GST {money(po.tax_amount)}</p>
          <p style={{ textAlign: 'right', margin: '2px 0 0', fontSize: 20, fontWeight: 700 }}>Total {money(po.total_amount)}</p>
          {po.notes && <p style={{ fontSize: 14, color: '#475569' }}><b>Notes:</b> {po.notes}</p>}

          {answered ? (
            <div style={{ marginTop: 22, padding: 18, borderRadius: 10, background: answered === 'Confirmed' ? '#ecfdf3' : '#fef3f2', border: '1px solid ' + (answered === 'Confirmed' ? '#abefc6' : '#fecdca') }}>
              <b>{answered === 'Confirmed' ? '✓ Thank you. You confirmed this order.' : 'You declined this order.'}</b>
              {(po.supplier_delivery_date || date) && answered === 'Confirmed' && <div style={{ fontSize: 14, marginTop: 4 }}>Delivery promised by {String(po.supplier_delivery_date ?? date).slice(0, 10)}.</div>}
              <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>The buyer has been informed. You can close this page.</div>
            </div>
          ) : po.can_respond ? (
            <div style={{ marginTop: 22, padding: 18, borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 10px' }}>Your response</h3>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>When can you deliver? (optional)<input type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 14 }}>Note (optional)<textarea style={{ ...input, minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
              {error && <p style={{ color: '#b42318', fontSize: 14 }}>{error}</p>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" disabled={saving} onClick={() => void answer('confirm')} style={{ background: '#16a34a', color: '#fff', border: 0, borderRadius: 8, padding: '12px 26px', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Confirm order</button>
                <button type="button" disabled={saving} onClick={() => void answer('decline')} style={{ background: '#fff', color: '#b42318', border: '1px solid #fda29b', borderRadius: 8, padding: '12px 22px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>Decline</button>
              </div>
            </div>
          ) : <p style={{ marginTop: 20, color: '#64748b' }}>This order is {String(po.status).toLowerCase()} and can no longer be answered.</p>}

          {po.can_ship && (
            <div style={{ marginTop: 18, padding: 18, borderRadius: 10, background: '#f8f7ff', border: '1px solid #ddd6fe' }}>
              <h3 style={{ margin: '0 0 4px' }}>Shipment details</h3>
              {shipped || po.shipped_at ? (
                <p style={{ margin: 0, fontSize: 14 }}><b>✓ Shipment noted.</b> The buyer's warehouse can now see this order as arriving{po.shipment_invoice_no || ship.invoice_no ? ` with invoice ${po.shipment_invoice_no || ship.invoice_no}` : ''}.</p>
              ) : (<>
                <p style={{ margin: '0 0 10px', fontSize: 13, color: '#475569' }}>Sent the goods? Tell the buyer so the warehouse is ready. This also confirms the order.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                  <label style={{ fontSize: 13 }}>Your invoice no.<input style={input} value={ship.invoice_no} onChange={(e) => setShip({ ...ship, invoice_no: e.target.value })} /></label>
                  <label style={{ fontSize: 13 }}>Vehicle / LR no.<input style={input} value={ship.vehicle_no} onChange={(e) => setShip({ ...ship, vehicle_no: e.target.value })} /></label>
                  <label style={{ fontSize: 13 }}>Arriving on<input type="date" style={input} value={ship.eta} onChange={(e) => setShip({ ...ship, eta: e.target.value })} /></label>
                </div>
                {shipError && <p style={{ color: '#b42318', fontSize: 14 }}>{shipError}</p>}
                <button type="button" disabled={saving} onClick={() => void sendShipment()} style={{ marginTop: 12, background: '#5925dc', color: '#fff', border: 0, borderRadius: 8, padding: '11px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Mark as shipped</button>
              </>)}
            </div>
          )}
        </div>
        <footer style={{ padding: '14px 26px', background: '#f8fafc', borderTop: '1px solid #e5e9ef', fontSize: 12, color: '#64748b' }}>{po.company?.name} {po.company?.address} {po.company?.gstin ? `· GSTIN ${po.company.gstin}` : ''} {po.company?.phone ?? ''} {po.company?.email ?? ''}</footer>
      </div>
    </main>
  );
}