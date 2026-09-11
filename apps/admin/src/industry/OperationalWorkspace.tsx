// ============ NEW CODE ============
import { useMemo, useState } from 'react';
import { VisitDrawer } from './VisitDrawer';
import { computeAutomationAlerts } from './automation';
import type { ActivityEvent, CollectionRecord, FollowUpRecord, IndustryConfig, OrderRecord, ReturnRecord, TargetRecord, VisitStatus, VisitStop } from './types';

interface OperationalWorkspaceProps {
  config: IndustryConfig;
}

function statusLabel(status: VisitStatus) {
  if (status === 'checked_in') return 'in progress';
  if (status === 'completed') return 'completed';
  if (status === 'skipped') return 'skipped';
  return 'pending';
}

function statusClass(status: VisitStatus) {
  if (status === 'completed') return 'status-badge status-completed';
  if (status === 'checked_in') return 'status-badge status-pending';
  if (status === 'skipped') return 'status-badge status-cancelled';
  return 'status-badge';
}

export function OperationalWorkspace({ config }: OperationalWorkspaceProps) {
  const [visits, setVisits] = useState<VisitStop[]>(config.visitsToday);
  const [activeBeat, setActiveBeat] = useState<string | 'all'>('all');
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);
  const [partySearch, setPartySearch] = useState('');

  const [ordersCreated, setOrdersCreated] = useState<OrderRecord[]>([]);
  const [collectionsCreated, setCollectionsCreated] = useState<CollectionRecord[]>([]);
  const [returnsCreated, setReturnsCreated] = useState<ReturnRecord[]>([]);
  const [followUpsCreated, setFollowUpsCreated] = useState<FollowUpRecord[]>(config.followUps);
  const [activity, setActivity] = useState<ActivityEvent[]>(config.activity);
  const [orderSeq, setOrderSeq] = useState(1);

  const orderTotalAdded = ordersCreated.reduce((sum, o) => sum + o.total, 0);
  const collectionTotalAdded = collectionsCreated.reduce((sum, c) => sum + c.amount, 0);

  const baseKpis = config.kpis;
  const visitsCompleted = visits.filter((v) => v.status === 'completed').length;

  const kpis = useMemo(() => {
    return baseKpis.map((k, idx) => {
      if (idx === 0) return { ...k, value: `${visitsCompleted} / ${visits.length}` };
      if (idx === 1 && ordersCreated.length) {
        const existing = Number(baseKpis[1].value.replace(/[^\d]/g, '') || '0');
        const combined = existing + orderTotalAdded;
        return { ...k, value: `₹${combined.toLocaleString('en-IN')}`, sub: `${ordersCreated.length} new ${config.terms.orderLabel.toLowerCase()}(s) this session` };
      }
      if (idx === 2 && collectionsCreated.length) {
        const existing = baseKpis[2].value.replace(/[^\d]/g, '');
        const combined = Number(existing || 0) + collectionTotalAdded;
        return { ...k, value: `₹${combined.toLocaleString('en-IN')}`, sub: `${collectionsCreated.length} new payment(s) this session` };
      }
      return k;
    });
  }, [baseKpis, visitsCompleted, visits.length, ordersCreated, collectionsCreated, orderTotalAdded, collectionTotalAdded, config.terms.orderLabel]);

  const targets: TargetRecord[] = useMemo(() => {
    return config.targets.map((t, idx) => (idx === 0 ? { ...t, achieved: t.achieved + orderTotalAdded } : t));
  }, [config.targets, orderTotalAdded]);

  const filteredVisits = activeBeat === 'all' ? visits : visits.filter((v) => v.beatId === activeBeat);
  const openVisit = visits.find((v) => v.id === openVisitId) ?? null;
  const openParty = openVisit ? config.parties.find((p) => p.id === openVisit.partyId) ?? null : null;

  const filteredParties = config.parties.filter((p) => p.name.toLowerCase().includes(partySearch.toLowerCase()) || p.code.toLowerCase().includes(partySearch.toLowerCase()));

  function pushActivity(text: string, kind: ActivityEvent['kind']) {
    setActivity((prev) => [{ id: `ev-${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text, kind }, ...prev]);
  }

  function handleCheckIn(visitId: string) {
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, status: 'checked_in', checkinTime: v.checkinTime ?? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } : v)));
    const v = visits.find((x) => x.id === visitId);
    const party = v ? config.parties.find((p) => p.id === v.partyId) : null;
    if (party) pushActivity(`Checked in at ${party.name}`, 'checkin');
  }

  function handleCreateOrder(partyId: string, order: OrderRecord) {
    setOrdersCreated((prev) => [order, ...prev]);
    setOrderSeq((n) => n + 1);
    const party = config.parties.find((p) => p.id === partyId);
    pushActivity(`${config.terms.orderLabel} ${order.orderNo} (₹${order.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) created for ${party?.name ?? ''}`, 'order');
  }

  function handleCreateCollection(partyId: string, record: CollectionRecord) {
    setCollectionsCreated((prev) => [record, ...prev]);
    const party = config.parties.find((p) => p.id === partyId);
    pushActivity(`Collection of ₹${record.amount.toLocaleString('en-IN')} recorded at ${party?.name ?? ''}`, 'collection');
  }

  function handleCreateReturn(partyId: string, record: ReturnRecord) {
    setReturnsCreated((prev) => [record, ...prev]);
    const party = config.parties.find((p) => p.id === partyId);
    pushActivity(`${record.kind === 'damage' ? 'Damage' : 'Return'} logged — ${record.itemName} (${record.qty}) at ${party?.name ?? ''}`, 'return');
  }

  function handleCreateFollowUp(partyId: string, record: FollowUpRecord) {
    setFollowUpsCreated((prev) => [record, ...prev]);
    const party = config.parties.find((p) => p.id === partyId);
    pushActivity(`Follow-up scheduled for ${party?.name ?? ''} — ${record.title}`, 'followup');
  }

  function handleCompleteVisit(visitId: string) {
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, status: 'completed' } : v)));
    const v = visits.find((x) => x.id === visitId);
    const party = v ? config.parties.find((p) => p.id === v.partyId) : null;
    if (party) pushActivity(`Visit completed at ${party.name}`, 'checkout');
    setOpenVisitId(null);
  }

  const accentStyle = { '--accent': `var(${config.colorVar})` } as React.CSSProperties;

  return (
    <div className="ops-workspace" style={accentStyle}>
      <section className="workflow-banner">
        <p className="eyebrow">HOW {config.label.toUpperCase()} FIELD SALES WORKS</p>
        <div className="workflow-chain">
          {config.workflow.map((step, i) => (
            <span key={step} className="workflow-step">
              {step}
              {i < config.workflow.length - 1 && <i className="workflow-arrow">→</i>}
            </span>
          ))}
        </div>
      </section>

      <div className="ops-metrics">
        {kpis.map((k) => (
          <div key={k.label} className={`ops-metric tone-${k.tone === 'good' ? '1' : k.tone === 'warn' ? '2' : k.tone === 'bad' ? '3' : ''}`}>
            <p>{k.label.toUpperCase()}</p>
            <strong>{k.value}</strong>
            <small>{k.sub}</small>
          </div>
        ))}
      </div>

      <div className="ops-grid">
        <div>
          <section className="ops-panel">
            <header>
              <div><p className="eyebrow">{config.terms.beatLabelPlural.toUpperCase()}</p><h2>Today's coverage</h2></div>
            </header>
            <div className="beat-chip-row">
              <button className={activeBeat === 'all' ? 'beat-chip active' : 'beat-chip'} onClick={() => setActiveBeat('all')}>All {config.terms.beatLabelPlural.toLowerCase()}</button>
              {config.beats.map((b) => (
                <button key={b.id} className={activeBeat === b.id ? 'beat-chip active' : 'beat-chip'} onClick={() => setActiveBeat(b.id)}>
                  {b.name} <em>{b.stopsDone}/{b.stopsPlanned}</em>
                </button>
              ))}
            </div>

            <div className="table-toolbar"><div><p className="eyebrow">TODAY'S {config.terms.visitLabel.toUpperCase()}S</p><h2>Visit list</h2></div><span className="visit-count">{filteredVisits.length} stops</span></div>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Time</th><th>{config.terms.partyLabel}</th><th>Purpose</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {filteredVisits.map((v) => {
                    const party = config.parties.find((p) => p.id === v.partyId);
                    return (
                      <tr key={v.id}>
                        <td>{v.scheduledTime}</td>
                        <td><strong>{party?.name}</strong><small>{party?.code}</small></td>
                        <td>{v.purpose}</td>
                        <td><span className={statusClass(v.status)}>{statusLabel(v.status)}</span></td>
                        <td><button className="quiet-button" onClick={() => setOpenVisitId(v.id)}>{v.status === 'pending' ? 'Start visit' : v.status === 'completed' ? 'View' : 'Continue'}</button></td>
                      </tr>
                    );
                  })}
                  {!filteredVisits.length && <tr><td colSpan={5} className="empty-row">No visits scheduled on this {config.terms.beatLabel.toLowerCase()}.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ops-panel">
            <header>
              <div><p className="eyebrow">{config.terms.partyLabelPlural.toUpperCase()}</p><h2>{config.terms.partyLabel} directory</h2></div>
            </header>
            <input className="party-search" placeholder={`Search ${config.terms.partyLabelPlural.toLowerCase()}…`} value={partySearch} onChange={(e) => setPartySearch(e.target.value)} />
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>{config.terms.partyLabel}</th><th>Type</th><th>Location</th><th>Outstanding</th><th>Last {config.terms.orderLabel}</th><th /></tr></thead>
                <tbody>
                  {filteredParties.map((p) => {
                    const relatedVisit = visits.find((v) => v.partyId === p.id);
                    return (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong><small>{p.code}</small></td>
                        <td>{p.type}</td>
                        <td>{p.location}</td>
                        <td className={p.outstanding > 0 ? 'text-warn' : ''}>₹{p.outstanding.toLocaleString('en-IN')}</td>
                        <td>{p.lastOrderDate}</td>
                        <td>{relatedVisit ? <button className="quiet-button" onClick={() => setOpenVisitId(relatedVisit.id)}>Open</button> : <span className="text-faint-inline">Not on today's route</span>}</td>
                      </tr>
                    );
                  })}
                  {!filteredParties.length && <tr><td colSpan={6} className="empty-row">No {config.terms.partyLabelPlural.toLowerCase()} match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {(ordersCreated.length > 0 || collectionsCreated.length > 0 || returnsCreated.length > 0) && (
            <section className="ops-panel">
              <header><div><p className="eyebrow">SESSION LEDGER</p><h2>Orders, collections & returns recorded just now</h2></div></header>
              {ordersCreated.length > 0 && <>
                <h5 className="ledger-heading">{config.terms.orderLabel}s</h5>
                <div className="data-table-wrap"><table><thead><tr><th>{config.terms.orderLabel} No.</th><th>{config.terms.partyLabel}</th><th>Lines</th><th>Total</th><th>Time</th></tr></thead><tbody>
                  {ordersCreated.map((o) => <tr key={o.id}><td>{o.orderNo}</td><td>{config.parties.find((p) => p.id === o.partyId)?.name}</td><td>{o.lines.length}</td><td>₹{o.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td><td>{o.createdAt}</td></tr>)}
                </tbody></table></div>
              </>}
              {collectionsCreated.length > 0 && <>
                <h5 className="ledger-heading">Collections</h5>
                <div className="data-table-wrap"><table><thead><tr><th>{config.terms.partyLabel}</th><th>Amount</th><th>Mode</th><th>Time</th></tr></thead><tbody>
                  {collectionsCreated.map((c) => <tr key={c.id}><td>{config.parties.find((p) => p.id === c.partyId)?.name}</td><td>₹{c.amount.toLocaleString('en-IN')}</td><td>{c.mode}</td><td>{c.createdAt}</td></tr>)}
                </tbody></table></div>
              </>}
              {returnsCreated.length > 0 && <>
                <h5 className="ledger-heading">Returns & Damage</h5>
                <div className="data-table-wrap"><table><thead><tr><th>{config.terms.partyLabel}</th><th>Item</th><th>Qty</th><th>Type</th><th>Time</th></tr></thead><tbody>
                  {returnsCreated.map((r) => <tr key={r.id}><td>{config.parties.find((p) => p.id === r.partyId)?.name}</td><td>{r.itemName}</td><td>{r.qty}</td><td className="capitalize">{r.kind}</td><td>{r.createdAt}</td></tr>)}
                </tbody></table></div>
              </>}
            </section>
          )}
        </div>

        <div>
          <section className="ops-panel ops-readiness">
            <header><div><p className="eyebrow">TARGETS</p><h2>Target achievement</h2></div></header>
            {targets.map((t) => {
              const pct = Math.min(100, Math.round((t.achieved / t.target) * 100));
              return (
                <div className="target-row" key={t.label}>
                  <div className="target-row-head"><strong>{t.label}</strong><span>{pct}%</span></div>
                  <div className="target-track"><div className="target-fill" style={{ width: `${pct}%` }} /></div>
                  <small>{t.unit === '₹' ? `₹${t.achieved.toLocaleString('en-IN')} of ₹${t.target.toLocaleString('en-IN')}` : `${t.achieved.toLocaleString('en-IN')} of ${t.target.toLocaleString('en-IN')} ${t.unit}`}</small>
                </div>
              );
            })}
          </section>

          <section className="ops-panel">
            <header><div><p className="eyebrow">FOLLOW-UPS</p><h2>Upcoming activities</h2></div></header>
            <ul className="followup-list">
              {followUpsCreated.map((f) => (
                <li key={f.id}>
                  <strong>{config.parties.find((p) => p.id === f.partyId)?.name}</strong>
                  <p>{f.title}</p>
                  <span>Due {f.dueDate}</span>
                </li>
              ))}
              {!followUpsCreated.length && <li className="empty-row">No follow-ups scheduled.</li>}
            </ul>
          </section>

          <section className="ops-panel">
            <header><div><p className="eyebrow">ACTIVITY</p><h2>Recent activity timeline</h2></div></header>
            <div className="timeline">
              {activity.map((a) => (
                <article key={a.id}>
                  <i className={a.kind} />
                  <div><p>{a.text}</p></div>
                  <time>{a.time}</time>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      {openVisit && openParty && (
        <VisitDrawer
          config={config}
          party={openParty}
          visit={openVisit}
          orderSeq={orderSeq}
          onClose={() => setOpenVisitId(null)}
          onCheckIn={handleCheckIn}
          onCreateOrder={handleCreateOrder}
          onCreateCollection={handleCreateCollection}
          onCreateReturn={handleCreateReturn}
          onCreateFollowUp={handleCreateFollowUp}
          onCompleteVisit={handleCompleteVisit}
        />
      )}
    </div>
  );
}
