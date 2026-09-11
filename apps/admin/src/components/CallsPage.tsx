import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase'; // NEW
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import './MasterDataPages.css';

type Call = {
  id: string;
  provider: string;
  direction: string;
  phone_number: string;
  status: string;
  started_at?: string | null;
  duration_seconds?: number | null;
  clients?: { client_code?: string | null; client_name?: string | null } | null;
  sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null;
  // NEW
  notes?: string | null;
  outcome?: string | null;
  recording_url?: string | null;
  lead_id?: string | null;
};

function dateLabel(value?: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function durationLabel(seconds?: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
function totalDurationLabel(totalSeconds: number) {
  if (!totalSeconds) return '0m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Calls carry a single provider `status` string (e.g. 'completed', 'missed',
// 'no_answer', 'busy', 'failed', 'in_progress'). We bucket it into a coarse
// connection outcome for the Status badge, while the raw, human-readable
// status still shows in the Outcome column — no new data is invented, this
// is purely a presentation split of the one field the API already returns.
const MISSED_STATUSES = new Set(['missed', 'no_answer', 'no-answer']);
const FAILED_STATUSES = new Set(['failed', 'busy']);
type CallBucket = 'answered' | 'missed' | 'failed' | 'other';
function bucketOf(status: string): CallBucket {
  const s = (status || '').toLowerCase();
  if (MISSED_STATUSES.has(s)) return 'missed';
  if (FAILED_STATUSES.has(s)) return 'failed';
  if (!s) return 'other';
  return 'answered';
}
function outcomeLabel(status: string) {
  if (!status) return '—';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
const BUCKET_BADGE: Record<CallBucket, string> = { answered: 'status-completed', missed: 'inactive', failed: 'status-cancelled', other: 'status-pending' };
const BUCKET_LABEL: Record<CallBucket, string> = { answered: 'Answered', missed: 'Missed', failed: 'Failed', other: 'Unknown' };

export function CallsPage() {
  const { config } = useIndustry();
  const { activeIndustry, clientMatchesActiveIndustry } = useIndustryScope();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Call | null>(null);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<'' | 'inbound' | 'outbound'>('');
  const [outcome, setOutcome] = useState<'' | CallBucket>('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setCalls((await api<{ data: Call[] }>('/telephony/calls')).data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load call history.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  // Re-fetch on industry switch so the KPI strip and table reflect the
  // active industry's clients, same convention as every other Core Module.
  useEffect(() => { void load(); }, [activeIndustry]);

  // NEW — everything below this line in this block is additive.
  const [notConfigured, setNotConfigured] = useState(false);
  useEffect(() => {
    api<{ isConfigured: boolean }>('/telephony/settings').then((res) => setNotConfigured(!res.isConfigured)).catch(() => {});
  }, []);

  // NEW — Supabase Realtime: live row inserts/updates land straight in
  // state, no polling and no manual refresh needed.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const channel = client
      .channel('telephony_calls')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'telephony_calls' }, (payload) => {
        setCalls((prev) => {
          const incoming = payload.new as Call | undefined;
          if (!incoming?.id) return prev;
          const exists = prev.some((c) => c.id === incoming.id);
          return exists ? prev.map((c) => (c.id === incoming.id ? { ...c, ...incoming } : c)) : [incoming, ...prev];
        });
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, []);

  const scopedCalls = useMemo(() => calls.filter((c) => clientMatchesActiveIndustry(c.clients?.client_code)), [calls, clientMatchesActiveIndustry]);

  const totalCalls = scopedCalls.length;
  const incoming = scopedCalls.filter((c) => c.direction === 'inbound').length;
  const outgoing = scopedCalls.filter((c) => c.direction === 'outbound').length;
  const answered = scopedCalls.filter((c) => bucketOf(c.status) === 'answered').length;
  const missed = scopedCalls.filter((c) => bucketOf(c.status) === 'missed').length;
  const totalDuration = scopedCalls.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0);

  const filtered = useMemo(() => scopedCalls.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.phone_number?.toLowerCase().includes(q) || (c.clients?.client_name ?? '').toLowerCase().includes(q);
    const matchesDirection = !direction || c.direction === direction;
    const matchesOutcome = !outcome || bucketOf(c.status) === outcome;
    return matchesSearch && matchesDirection && matchesOutcome;
  }), [scopedCalls, search, direction, outcome]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => new Date(b.started_at ?? 0).getTime() - new Date(a.started_at ?? 0).getTime()), [filtered]);

  const clearFilters = () => { setSearch(''); setDirection(''); setOutcome(''); };

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
             <div>
          <p className="eyebrow">{config.label.toUpperCase()} · CALL OPERATIONS</p>
          <h2>Calls &amp; IVR</h2>
          <p>Monitor inbound and outbound calls with your {config.terms.partyLabelPlural.toLowerCase()}, recordings and call outcomes.</p>
        </div>
        <button className="quiet-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      {notConfigured && (
        <div className="empty-state" style={{ padding: '12px 16px', marginBottom: '16px' }}>
          <strong>IVR provider connection required</strong> — this page stays usable for configuration and testing, but no real calls can be placed or received until a provider is connected. See <code>SETUP.md</code>.
        </div>
      )}
      <div className="kpi-grid lead-kpi-grid">
                <div className="kpi-card" data-tone="ink"><div className="kpi-icon">☎</div><div><span>Total Calls</span><strong>{totalCalls}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon">↓</div><div><span>Incoming</span><strong>{incoming}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon">↑</div><div><span>Outgoing</span><strong>{outgoing}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Answered</span><strong>{answered}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">⊘</div><div><span>Missed</span><strong>{missed}</strong></div></div>
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">◔</div><div><span>Call Duration</span><strong>{totalDurationLabel(totalDuration)}</strong></div></div>
          </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" value={search} placeholder={`Search phone number or ${config.terms.partyLabel.toLowerCase()} name`} onChange={(e) => setSearch(e.target.value)} />
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
            <option value="">All directions</option>
            <option value="inbound">Incoming</option>
            <option value="outbound">Outgoing</option>
          </select>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="">All outcomes</option>
            <option value="answered">Answered</option>
            <option value="missed">Missed</option>
            <option value="failed">Failed</option>
          </select>
          <button type="button" className="link-button" onClick={clearFilters} disabled={!search && !direction && !outcome}>Clear filters</button>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {loading ? (
        <p>Loading call history…</p>
      ) : sorted.length === 0 ? (
        <div className="empty-state empty-state-lg">
          <div className="empty-state-icon">☎</div>
          {calls.length === 0 ? (
            <>
              <h3>No call activity yet</h3>
              <p>Call activity will appear here once the telephony provider is connected and calls are recorded.</p>
            </>
          ) : scopedCalls.length === 0 ? (
            <>
              <h3>No {config.label} call activity yet</h3>
              <p>No recorded calls are linked to a {config.terms.partyLabel.toLowerCase()} in {config.label} yet. Switch Industry Type to see calls for other industries.</p>
            </>
          ) : (
            <>
              <h3>No calls match your filters</h3>
              <p>Try clearing filters to see all {config.label} call activity.</p>
            </>
          )}
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Call</th><th>{config.terms.partyLabel} / Lead</th><th>Representative</th><th>Direction</th>
                <th>Date &amp; Time</th><th>Duration</th><th>Outcome</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((call) => {
                const bucket = bucketOf(call.status);
                return (
                  <tr key={call.id}>
                    <td><strong>{call.phone_number}</strong><small>{call.provider}</small></td>
                     <td>{call.clients?.client_name ?? <span className="status-badge status-new">Potential lead</span>}</td>
                    <td>{call.sales_representatives?.user_profiles?.display_name ?? call.sales_representatives?.employee_code ?? '—'}</td>
                    <td>
                      <span className={`status-badge ${call.direction === 'inbound' ? 'status-new' : 'status-quoted'}`}>
                        {call.direction === 'inbound' ? '↓ Incoming' : call.direction === 'outbound' ? '↑ Outgoing' : call.direction || '—'}
                      </span>
                    </td>
                    <td>{dateLabel(call.started_at)}</td>
                    <td>{durationLabel(call.duration_seconds)}</td>
                    <td>{outcomeLabel(call.status)}</td>
                    <td><span className={`status-badge ${BUCKET_BADGE[bucket]}`}>{BUCKET_LABEL[bucket]}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="View call details" aria-label="View call details" onClick={() => setViewing(call)}>◉</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">CALL DETAILS</p><h3>{viewing.phone_number}</h3></div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>×</button>
            </div>
                   <dl className="detail-dl">
              <dt>Provider</dt><dd>{viewing.provider || '—'}</dd>
                     <dt>{config.terms.partyLabel} / Lead</dt><dd>{viewing.clients?.client_name ?? <span className="status-badge status-new">Potential lead</span>}</dd>
              <dt>Representative</dt><dd>{viewing.sales_representatives?.user_profiles?.display_name ?? viewing.sales_representatives?.employee_code ?? '—'}</dd>
              <dt>Direction</dt><dd>{viewing.direction === 'inbound' ? 'Incoming' : viewing.direction === 'outbound' ? 'Outgoing' : viewing.direction || '—'}</dd>
              <dt>Date &amp; time</dt><dd>{dateLabel(viewing.started_at)}</dd>
              <dt>Duration</dt><dd>{durationLabel(viewing.duration_seconds)}</dd>
              <dt>Outcome</dt><dd>{outcomeLabel(viewing.status)}</dd>
              <dt>Status</dt><dd><span className={`status-badge ${BUCKET_BADGE[bucketOf(viewing.status)]}`}>{BUCKET_LABEL[bucketOf(viewing.status)]}</span></dd>
            </dl>
                   <p className="detail-note">Recordings will appear here once the connected telephony provider supplies them.</p>
            {viewing.recording_url && <p className="detail-note"><a href={viewing.recording_url} target="_blank" rel="noreferrer">▶ Play recording</a></p>}
            {viewing.notes && <p className="detail-note"><strong>Notes:</strong> {viewing.notes}</p>}
            {viewing.outcome && <p className="detail-note"><strong>Outcome:</strong> {viewing.outcome}</p>}
            {!viewing.clients && (
              <p className="detail-note">This number isn't linked to a {config.terms.partyLabel.toLowerCase()} yet — treat it as a potential lead for {config.label}.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}