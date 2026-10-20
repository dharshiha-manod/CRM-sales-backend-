// FILE: admin/src/components/FmcgShipmentDetail.tsx
// FMCG > Shipments > View page. Opened from the eye icon in the Shipments list
// (hash route #industry:fmcg:shipment:<id>). Read-only overview of one shipment;
// Dispatch / Deliver / Edit / Cancel reuse the same dialogs as the list page.
import { Fragment } from 'react';
import type { Shipment, Mode, Status } from './FmcgShipmentsPage';
import './MasterDataPages.css';
import './FmcgShipmentsPage.css';

const STATUS_LABEL: Record<Status, string> = { packed: 'Packed', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const todayLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const qty = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const customsTone = (status: string) => (status === 'Cleared' ? 'ok' : status === 'Held' || status === 'Rejected' ? 'bad' : 'warn');

type Props = {
  shipment: Shipment | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onAction: (shipment: Shipment, mode: Mode) => void;
};

export function FmcgShipmentDetail({ shipment: s, loading, error, onBack, onAction }: Props) {
  const back = <button type="button" className="sv-back" onClick={onBack}>← Back to Shipments</button>;

  if (!s) {
    return (
      <div className="sv-page">
        {back}
        {error && <p className="error-message">{error}</p>}
        <div className="sv-card sv-empty">
          {loading ? <strong>Loading shipment…</strong> : <><strong>Shipment not found</strong><span>It may have been removed, or belongs to another industry.</span></>}
        </div>
      </div>
    );
  }

  const today = todayLocal();
  const international = s.market === 'international';
  const late = s.status === 'dispatched' && !!s.expected_arrival && s.expected_arrival < today;
  const stage = s.status === 'packed' ? 0 : s.status === 'dispatched' ? 1 : s.status === 'delivered' ? 2 : -1;
  const timeline: Array<[string, string | null]> = [['Packed', s.created_at.slice(0, 10)], ['Dispatched', s.shipped_at], ['Delivered', s.delivered_at]];
  const shortQty = s.items.reduce((a, i) => a + i.short_quantity, 0);
  const damagedQty = s.items.reduce((a, i) => a + i.damaged_quantity, 0);
  const delivered = s.status === 'delivered';
  const gateDocs = s.paperwork ? s.paperwork.docs_verified < s.paperwork.docs_required : false;
  const gateCustoms = s.paperwork ? s.paperwork.customs !== 'Cleared' : false;
  const blocked = s.status === 'packed' && (gateDocs || gateCustoms);

  return (
    <div className="sv-page">
      {back}
      {error && <p className="error-message">{error}</p>}

      <div className="sv-header">
        <div className="sv-title">
          <span className="sp-avatar sv-avatar">{initials(s.client_name)}</span>
          <div>
            <p className="eyebrow">FMCG · SHIPMENT</p>
            <h2>{s.shipment_no}</h2>
            <div className="sv-chips">
              <span className={`sp-status sp-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
              <span className={`sp-chip ${international ? 'intl' : 'local'}`}>{international ? 'International' : 'Local'}</span>
              {late && <span className="sp-pill bad">Overdue</span>}
              <span className="sv-sub">Order {s.order_number} · {s.client_name}{s.client_code ? ` (${s.client_code})` : ''}</span>
            </div>
          </div>
        </div>
        <div className="sv-actions">
          {s.status === 'packed' && <button type="button" className="primary-action" onClick={() => onAction(s, 'dispatch')}>Dispatch</button>}
          {s.status === 'dispatched' && <button type="button" className="primary-action" onClick={() => onAction(s, 'deliver')}>Mark delivered</button>}
          {delivered && <button type="button" className="quiet-button" onClick={() => onAction(s, 'deliver')}>Delivery proof (POD)</button>}
          {s.status !== 'cancelled' && <button type="button" className="quiet-button" onClick={() => onAction(s, 'edit')}>Edit</button>}
          {s.status === 'packed' && <button type="button" className="sp-btn danger" onClick={() => onAction(s, 'cancel')}>Cancel shipment</button>}
        </div>
      </div>

      <div className="sv-card">
        {stage >= 0 ? (
          <ol className="sp-track" aria-label="Shipment progress">
            {timeline.map(([label, date], i) => (
              <li key={label} className={stage === 2 || i < stage ? 'done' : i === stage ? 'current' : ''}>
                <span className="sp-track-dot" />
                <strong>{label}</strong>
                <small>{date ? fmtDate(date) : 'Pending'}</small>
              </li>
            ))}
          </ol>
        ) : <p className="sp-cancel-note">This shipment was cancelled. Its quantity went back to the order.</p>}
      </div>

      {blocked && (
        <div className="sp-gate">
          <strong>Before this can be dispatched</strong>
          <ul>
            {gateDocs && s.paperwork && <li>Verified export documents: {s.paperwork.docs_verified} of {s.paperwork.docs_required} — <a href="#industry:fmcg:trade-documents">Trade Documents</a></li>}
            {gateCustoms && s.paperwork && <li>Export customs is {s.paperwork.customs} — <a href="#industry:fmcg:customs-clearance">Customs &amp; Clearance</a></li>}
          </ul>
        </div>
      )}

      <div className="sv-stats">
        <div><span>Total quantity</span><strong>{qty(s.total_quantity)}</strong></div>
        <div><span>Shipped on</span><strong>{fmtDate(s.shipped_at)}</strong></div>
        <div className={late ? 'sv-late' : undefined}><span>{international ? 'ETA' : 'Due date'}</span><strong>{fmtDate(s.expected_arrival)}</strong></div>
        <div><span>Delivered on</span><strong>{fmtDate(s.delivered_at)}</strong></div>
      </div>

      <div className="sv-grid">
        <section className="sp-panel sv-wide">
          <h4>Items</h4>
          <table className="sp-items">
            <thead>
              <tr>
                <th>Product</th><th className="num">Shipped</th>
                {delivered && <><th className="num">Short</th><th className="num">Damaged</th><th className="num">Received OK</th></>}
              </tr>
            </thead>
            <tbody>
              {s.items.map((i, idx) => (
                <tr key={`${s.id}-${idx}`}>
                  <td>{i.product_name}</td><td className="num">{qty(i.quantity)}</td>
                  {delivered && <><td className="num">{qty(i.short_quantity)}</td><td className="num">{qty(i.damaged_quantity)}</td><td className="num">{qty(i.quantity - i.short_quantity - i.damaged_quantity)}</td></>}
                </tr>
              ))}
              <tr className="total">
                <td>Total</td><td className="num">{qty(s.total_quantity)}</td>
                {delivered && <><td className="num">{qty(shortQty)}</td><td className="num">{qty(damagedQty)}</td><td className="num">{qty(s.total_quantity - shortQty - damagedQty)}</td></>}
              </tr>
            </tbody>
          </table>
        </section>

        <section className="sp-panel">
          <h4>Client &amp; order</h4>
          <dl className="sp-dl">
            <div><dt>Client</dt><dd>{s.client_name}</dd></div>
            <div><dt>Client code</dt><dd>{s.client_code || '—'}</dd></div>
            <div><dt>Market</dt><dd>{international ? 'International' : 'Local'}</dd></div>
            <div><dt>Order</dt><dd>{s.order_number}</dd></div>
            <div><dt>Order status</dt><dd>{s.order_status || '—'}</dd></div>
          </dl>
        </section>

        <section className="sp-panel">
          <h4>Carrier &amp; documents</h4>
          <dl className="sp-dl">
            <div><dt>{international ? 'Container / AWB / BL' : 'Vehicle / LR no.'}</dt><dd>{s.transport_ref || '—'}</dd></div>
            <div><dt>Transporter</dt><dd>{s.transporter_name || '—'}</dd></div>
            <div><dt>Driver</dt><dd>{s.driver_name ? `${s.driver_name}${s.driver_phone ? ` · ${s.driver_phone}` : ''}` : '—'}</dd></div>
            <div><dt>Invoice no.</dt><dd>{s.invoice_no || '—'}</dd></div>
            {international ? (
              <Fragment>
                <div><dt>Incoterm</dt><dd>{s.terms?.incoterm || '—'}</dd></div>
                <div><dt>Route</dt><dd>{s.terms?.port_of_loading || s.terms?.port_of_discharge ? `${s.terms?.port_of_loading || '—'} → ${s.terms?.port_of_discharge || '—'}` : '—'}</dd></div>
              </Fragment>
            ) : (
              <div><dt>E-way bill</dt><dd>{s.eway_bill_no ? `${s.eway_bill_no}${s.eway_bill_valid_until ? ` (valid until ${fmtDate(s.eway_bill_valid_until)})` : ''}` : '—'}</dd></div>
            )}
          </dl>
        </section>

        {international && (
          <section className="sp-panel">
            <h4>Export paperwork</h4>
            {s.paperwork ? (
              <div className="sp-paper">
                <a className={`sp-pill ${s.paperwork.docs_verified >= s.paperwork.docs_required ? 'ok' : 'warn'}`} href="#industry:fmcg:trade-documents">Documents {s.paperwork.docs_verified}/{s.paperwork.docs_required} verified</a>
                <a className={`sp-pill ${customsTone(s.paperwork.customs)}`} href="#industry:fmcg:customs-clearance">Customs: {s.paperwork.customs}</a>
              </div>
            ) : <p className="sv-muted">No export paperwork linked to this shipment.</p>}
          </section>
        )}

        {delivered && (
          <section className="sp-panel">
            <h4>Delivery receipt</h4>
            <dl className="sp-dl">
              <div><dt>Received by</dt><dd>{s.received_by || '—'}</dd></div>
              <div><dt>Delivered on</dt><dd>{fmtDate(s.delivered_at)}</dd></div>
              <div>
                <dt>Condition</dt>
                <dd>{shortQty || damagedQty
                  ? <span className="sp-pill warn">Short {qty(shortQty)} · Damaged {qty(damagedQty)}</span>
                  : <span className="sp-pill ok">All received in good condition</span>}</dd>
              </div>
              <div><dt>Proof of delivery</dt><dd>{s.pod_file_url ? <a href={s.pod_file_url} target="_blank" rel="noreferrer">View document</a> : '—'}</dd></div>
            </dl>
            {damagedQty > 0 && <p className="sp-hint">Damaged goods still need a Sales Return entry. <a href="#industry:fmcg:sales-return-damage">Open Sales Return &amp; Damage</a></p>}
          </section>
        )}

        {s.notes ? <section className="sp-panel"><h4>Notes</h4><p className="sp-note-text">{s.notes}</p></section> : null}
      </div>
    </div>
  );
}