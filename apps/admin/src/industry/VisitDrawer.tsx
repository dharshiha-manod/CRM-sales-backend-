import { useMemo, useState } from 'react';
import type { CollectionRecord, FollowUpRecord, IndustryConfig, OrderLineRecord, OrderRecord, Party, ReturnRecord, VisitStop } from './types';

type DrawerTab = 'overview' | 'order' | 'collection' | 'returns' | 'followup';

interface OrderLine {
  itemId: string;
  qty: string;
}

interface VisitDrawerProps {
  config: IndustryConfig;
  party: Party;
  visit: VisitStop;
  orderSeq: number;
  onClose: () => void;
  onCheckIn: (visitId: string) => void;
  onCreateOrder: (partyId: string, order: OrderRecord) => void;
  onCreateCollection: (partyId: string, record: CollectionRecord) => void;
  onCreateReturn: (partyId: string, record: ReturnRecord) => void;
  onCreateFollowUp: (partyId: string, record: FollowUpRecord) => void;
  onCompleteVisit: (visitId: string) => void;
}

function mockCoords() {
  const lat = (12.85 + Math.random() * 0.4).toFixed(4);
  const lng = (80.05 + Math.random() * 0.35).toFixed(4);
  return `${lat}° N, ${lng}° E`;
}

export function VisitDrawer({ config, party, visit, orderSeq, onClose, onCheckIn, onCreateOrder, onCreateCollection, onCreateReturn, onCreateFollowUp, onCompleteVisit }: VisitDrawerProps) {
  const alreadyIn = visit.status !== 'pending';
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkedIn, setCheckedIn] = useState(alreadyIn);
  const [checkinLoc, setCheckinLoc] = useState(visit.checkinLocation ?? '');
  const [tab, setTab] = useState<DrawerTab>('overview');

  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [lastOrder, setLastOrder] = useState<OrderRecord | null>(null);

  const [collAmount, setCollAmount] = useState('');
  const [collMode, setCollMode] = useState('Cash');
  const [collRef, setCollRef] = useState('');
  const [collDone, setCollDone] = useState(false);

  const [retItemId, setRetItemId] = useState('');
  const [retQty, setRetQty] = useState('1');
  const [retReason, setRetReason] = useState('');
  const [retKind, setRetKind] = useState<'return' | 'damage'>('return');
  const [retDone, setRetDone] = useState(false);

  const [fuTitle, setFuTitle] = useState('');
  const [fuDate, setFuDate] = useState('');
  const [fuDone, setFuDone] = useState(false);

  const [visitClosed, setVisitClosed] = useState(visit.status === 'completed');

  function doCheckIn() {
    setCheckingIn(true);
    window.setTimeout(() => {
      const loc = mockCoords();
      setCheckinLoc(loc);
      setCheckedIn(true);
      setCheckingIn(false);
      onCheckIn(visit.id);
    }, 700);
  }

  function scanBarcode() {
    setScanOpen(true);
    setScanning(true);
    window.setTimeout(() => {
      const item = config.catalog[Math.floor(Math.random() * config.catalog.length)];
      setLines((prev) => (prev.some((l) => l.itemId === item.id) ? prev : [...prev, { itemId: item.id, qty: '1' }]));
      setScanning(false);
    }, 900);
  }

  function addItem(itemId: string) {
    if (!itemId) return;
    setLines((prev) => (prev.some((l) => l.itemId === itemId) ? prev : [...prev, { itemId, qty: '1' }]));
  }

  function updateQty(itemId: string, qty: string) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  const totalQty = lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);
  const activeScheme = useMemo(() => {
    const eligible = config.schemes.filter((s) => totalQty >= s.minQty);
    return eligible.sort((a, b) => b.discountPercent - a.discountPercent)[0] ?? null;
  }, [totalQty, config.schemes]);

  const computedLines: OrderLineRecord[] = lines
    .map((l): OrderLineRecord | null => {
      const item = config.catalog.find((c) => c.id === l.itemId);
      if (!item) return null;
      const qty = Number(l.qty || 0);
      const gross = item.price * qty;
      const discountPercent = activeScheme?.discountPercent ?? 0;
      const total = gross - (gross * discountPercent) / 100;
      return { itemName: item.name, qty, rate: item.price, discountPercent, schemeLabel: activeScheme?.label, total };
    })
    .filter((l): l is OrderLineRecord => l !== null);

  const orderTotal = computedLines.reduce((sum, l) => sum + l.total, 0);

  function submitOrder() {
    const order: OrderRecord = {
      id: `ord-${visit.id}-${orderSeq}`,
      orderNo: `${config.key.toUpperCase()}-${1000 + orderSeq}`,
      partyId: party.id,
      lines: computedLines,
      total: orderTotal,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    onCreateOrder(party.id, order);
    setLastOrder(order);
    setLines([]);
    setOrderNotes('');
  }

  function submitCollection() {
    if (!collAmount || Number(collAmount) <= 0) return;
    onCreateCollection(party.id, { id: `coll-${visit.id}`, partyId: party.id, amount: Number(collAmount), mode: collMode, reference: collRef, createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    setCollDone(true);
  }

  function submitReturn() {
    if (!retItemId) return;
    const item = config.catalog.find((c) => c.id === retItemId);
    if (!item) return;
    onCreateReturn(party.id, { id: `ret-${visit.id}`, partyId: party.id, itemName: item.name, qty: Number(retQty || 0), reason: retReason, kind: retKind, createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    setRetDone(true);
  }

  function submitFollowUp() {
    if (!fuTitle || !fuDate) return;
    onCreateFollowUp(party.id, { id: `fu-${visit.id}`, partyId: party.id, title: fuTitle, dueDate: fuDate, status: 'pending' });
    setFuDone(true);
  }

  function finishVisit() {
    onCompleteVisit(visit.id);
    setVisitClosed(true);
  }

  const accentStyle = { '--accent': `var(${config.colorVar})` } as React.CSSProperties;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="visit-drawer" style={accentStyle}>
        <div className="visit-drawer-head">
          <div>
            <p className="eyebrow">{config.terms.visitLabel.toUpperCase()} · {visit.scheduledTime}</p>
            <h3>{party.name}</h3>
            <p className="drawer-sub">{party.code} · {party.type} · {party.location}</p>
          </div>
          <div className="drawer-head-actions">
            {checkedIn && <span className="status-badge status-completed">Checked in</span>}
            {visitClosed && <span className="status-badge status-confirmed">Visit complete</span>}
            <button className="icon-action" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        {!checkedIn ? (
          <div className="checkin-panel">
            <p className="eyebrow">STEP 1 — {config.terms.partyLabel.toUpperCase()} CHECK-IN</p>
            <h4>Confirm you have arrived at {party.name}</h4>
            <p className="drawer-sub">GPS location will be captured to confirm this {config.terms.visitLabel.toLowerCase()}, matching the field {config.terms.repLabel.toLowerCase()} workflow.</p>
            <dl className="mini-dl">
              <dt>Contact</dt><dd>{party.contactPerson} · {party.phone}</dd>
              <dt>Purpose</dt><dd>{visit.purpose}</dd>
              <dt>Outstanding</dt><dd>₹{party.outstanding.toLocaleString('en-IN')}</dd>
            </dl>
            <button className="primary-action" disabled={checkingIn} onClick={doCheckIn}>{checkingIn ? 'Capturing GPS location…' : '📍 Check in now'}</button>
          </div>
        ) : (
          <>
            <div className="checkin-confirm">✓ Checked in at {checkinLoc || visit.checkinLocation} {visit.checkinTime ? `· ${visit.checkinTime}` : ''}</div>
            <div className="drawer-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview & History</button>
              <button role="tab" aria-selected={tab === 'order'} className={tab === 'order' ? 'active' : ''} onClick={() => setTab('order')}>{config.terms.itemLabel} & {config.terms.orderLabel}</button>
              <button role="tab" aria-selected={tab === 'collection'} className={tab === 'collection' ? 'active' : ''} onClick={() => setTab('collection')}>Collection</button>
              <button role="tab" aria-selected={tab === 'returns'} className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}>Returns & Damage</button>
              <button role="tab" aria-selected={tab === 'followup'} className={tab === 'followup' ? 'active' : ''} onClick={() => setTab('followup')}>Follow-up</button>
            </div>

            {tab === 'overview' && (
              <div className="drawer-tab-panel">
                <div className="detail-panel">
                  <dl>
                    {party.fields.map((f) => <div key={f.label} className="dl-row"><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
                    <div className="dl-row"><dt>Credit Limit</dt><dd>₹{party.creditLimit.toLocaleString('en-IN')}</dd></div>
                    <div className="dl-row"><dt>Outstanding</dt><dd className={party.outstanding > 0 ? 'text-warn' : ''}>₹{party.outstanding.toLocaleString('en-IN')}</dd></div>
                    <div className="dl-row"><dt>Last {config.terms.orderLabel}</dt><dd>{party.lastOrderDate} {party.lastOrderValue ? `· ₹${party.lastOrderValue.toLocaleString('en-IN')}` : ''}</dd></div>
                  </dl>
                </div>
                <h5>Recent history</h5>
                <ul className="history-list">
                  {party.history.map((h, i) => <li key={i}><span>{h.date}</span><p>{h.text}</p>{h.value && <b>{h.value}</b>}</li>)}
                </ul>
              </div>
            )}

            {tab === 'order' && (
              <div className="drawer-tab-panel">
                <p className="eyebrow">STEP — SELECT {config.terms.itemLabel.toUpperCase()}</p>
                <div className="order-select-row">
                  <select value="" onChange={(e) => addItem(e.target.value)}>
                    <option value="">Select {config.terms.itemLabel.toLowerCase()}…</option>
                    {config.catalog.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                  <button type="button" className="secondary-action" disabled={scanning} onClick={scanBarcode}>{scanning ? 'Scanning…' : `▤ ${config.terms.scanLabel}`}</button>
                </div>
                {scanOpen && (
                  <div className="scan-mock">
                    {scanning ? <p>Scanning for nearby {config.terms.itemLabel.toLowerCase()}…</p> : <p>✓ Scan matched — item added to the {config.terms.orderLabel.toLowerCase()} below.</p>}
                  </div>
                )}

                {lines.length > 0 && (
                  <div className="data-table-wrap order-lines-table">
                    <table>
                      <thead><tr><th>{config.terms.itemLabel}</th>{config.catalogColumns.map((c) => <th key={c.key}>{c.label}</th>)}<th>{config.terms.stockLabel.split('/')[0].trim()}</th><th>Qty</th><th>Rate</th><th>Total</th><th /></tr></thead>
                      <tbody>
                        {lines.map((line) => {
                          const item = config.catalog.find((c) => c.id === line.itemId);
                          if (!item) return null;
                          const qty = Number(line.qty || 0);
                          const gross = item.price * qty;
                          const disc = activeScheme?.discountPercent ?? 0;
                          const total = gross - (gross * disc) / 100;
                          const lowStock = item.stock < 30;
                          return (
                            <tr key={line.itemId}>
                              <td><strong>{item.name}</strong><small>{item.code}</small></td>
                              {config.catalogColumns.map((c) => <td key={c.key}>{item.attributes.find((a) => a.label === c.key)?.value ?? '—'}</td>)}
                              <td><span className={lowStock ? 'status-badge status-cancelled' : 'status-badge status-completed'}>{item.stock} {item.unit}</span></td>
                              <td><input type="number" min="1" value={line.qty} onChange={(e) => updateQty(line.itemId, e.target.value)} className="qty-input" /></td>
                              <td>₹{item.price.toLocaleString('en-IN')}</td>
                              <td>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                              <td><button type="button" className="text-action" onClick={() => removeLine(line.itemId)}>Remove</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={`scheme-banner ${activeScheme ? 'scheme-active' : ''}`}>
                  <p className="eyebrow">{config.terms.schemeLabel.toUpperCase()}</p>
                  {activeScheme ? <p><strong>{activeScheme.label}</strong> applied — {activeScheme.discountPercent}% off ({activeScheme.note}).</p> : <p>Add more quantity to unlock a {config.terms.schemeLabel.toLowerCase()}. Available slabs: {config.schemes.map((s) => `${s.label} (${s.discountPercent}%)`).join(', ')}.</p>}
                </div>

                <textarea value={orderNotes} placeholder={`${config.terms.orderLabel} notes (optional)`} onChange={(e) => setOrderNotes(e.target.value)} />
                <div className="order-total-row"><span>{config.terms.orderLabel} total</span><strong>₹{orderTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</strong></div>
                <button className="primary-action" disabled={!lines.length} onClick={submitOrder}>Create {config.terms.orderLabel.toLowerCase()}</button>

                {lastOrder && (
                  <div className="order-confirmation">
                    <p className="eyebrow">✓ {config.terms.orderLabel.toUpperCase()} CONFIRMED</p>
                    <h5>{lastOrder.orderNo}</h5>
                    <p>{lastOrder.lines.length} line item(s) · ₹{lastOrder.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} · {lastOrder.createdAt}</p>
                  </div>
                )}
              </div>
            )}

            {tab === 'collection' && (
              <div className="drawer-tab-panel">
                <p className="eyebrow">RECORD COLLECTION</p>
                {party.outstanding > 0 && <p className="drawer-sub">Outstanding on account: ₹{party.outstanding.toLocaleString('en-IN')}</p>}
                <div className="form-grid-drawer">
                  <input type="number" min="1" placeholder="Amount received" value={collAmount} onChange={(e) => setCollAmount(e.target.value)} />
                  <select value={collMode} onChange={(e) => setCollMode(e.target.value)}>
                    <option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option><option>Other</option>
                  </select>
                  <input placeholder="Reference / cheque no. (optional)" value={collRef} onChange={(e) => setCollRef(e.target.value)} />
                </div>
                <button className="secondary-action" disabled={!collAmount || collDone} onClick={submitCollection}>{collDone ? '✓ Collection recorded' : 'Record collection'}</button>
              </div>
            )}

            {tab === 'returns' && (
              <div className="drawer-tab-panel">
                <p className="eyebrow">SALES RETURN / DAMAGE</p>
                <div className="form-grid-drawer">
                  <select value={retItemId} onChange={(e) => setRetItemId(e.target.value)}>
                    <option value="">Select {config.terms.itemLabel.toLowerCase()}…</option>
                    {config.catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input type="number" min="1" value={retQty} onChange={(e) => setRetQty(e.target.value)} placeholder="Quantity" />
                  <select value={retKind} onChange={(e) => setRetKind(e.target.value as 'return' | 'damage')}>
                    <option value="return">Sales return</option>
                    <option value="damage">Damage write-off</option>
                  </select>
                </div>
                <textarea value={retReason} placeholder="Reason" onChange={(e) => setRetReason(e.target.value)} />
                <button className="secondary-action" disabled={!retItemId || retDone} onClick={submitReturn}>{retDone ? '✓ Recorded' : 'Record entry'}</button>
              </div>
            )}

            {tab === 'followup' && (
              <div className="drawer-tab-panel">
                <p className="eyebrow">SCHEDULE FOLLOW-UP</p>
                <div className="form-grid-drawer">
                  <input placeholder="Next action" value={fuTitle} onChange={(e) => setFuTitle(e.target.value)} />
                  <input type="date" value={fuDate} onChange={(e) => setFuDate(e.target.value)} />
                </div>
                <button className="secondary-action" disabled={!fuTitle || !fuDate || fuDone} onClick={submitFollowUp}>{fuDone ? '✓ Follow-up scheduled' : 'Schedule follow-up'}</button>
              </div>
            )}

            <div className="drawer-footer">
              {!visitClosed ? <button className="primary-action" onClick={finishVisit}>Complete visit & update dashboard</button> : <p className="success-note">✓ Visit completed — dashboard, activity feed and targets updated.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
