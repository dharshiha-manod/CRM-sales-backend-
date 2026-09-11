import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import {
  DEFAULT_VERIFICATION_RADIUS_METERS,
  distanceMeters,
  formatDistance,
  routeDistanceMeters,
} from '../gps/geo';
import type { Coordinates } from '../gps/geo';
import type { GpsMatchStatus, RepFieldStatus, TrackingPoint, TrackingSession } from '../gps/types';
import './GpsTrackingPage.css';
import './MasterDataPages.css';

// Real GPS Verify & Tracking module. Every number on this page is computed
// from live backend records (/field-visits, /field-visits/live, /clients,
// /sales-representatives) — there is no seeded/mock data left. See
// gps/geo.ts for the shared Haversine math and verification radius.

const LIVE_POLL_MS = 20000;
const MISMATCH_REVIEW_KEY = 'fs-gps-mismatch-reviews';

// ---- Shapes returned by the existing API (mirrors DashboardPage/FieldActivityPage) ----
type ClientRef = { client_code?: string; client_name?: string } | null;
type RepRef = { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;

type Visit = {
  id: string;
  status: string;
  check_in_time: string;
  check_out_time?: string | null;
  outcome?: string | null;
  // Confirmed present on /field-visits/live (see DashboardPage's live feed).
  // Left optional here because every read below is null-guarded — if the
  // plain /field-visits list ever omits these, the page shows fewer GPS
  // numbers instead of breaking.
  check_in_lat?: number | null;
  check_in_lng?: number | null;
  check_out_lat?: number | null;
  check_out_lng?: number | null;
  clients?: ClientRef;
  sales_representatives?: RepRef;
};

type LiveVisit = Visit & { latest_ping?: { latitude: number; longitude: number } | null };

type Representative = { id: string; employee_code: string; status: 'active' | 'inactive'; user_profiles?: { display_name?: string | null } | null };

type Client = { id: string; client_code: string; client_name: string; address?: string | null; city?: string | null; latitude?: number | null; longitude?: number | null; industry_type_id?: string | null };

type RepRow = {
  repId: string;
  repName: string;
  status: RepFieldStatus;
  clientName: string | null;
  latitude: number | null;
  longitude: number | null;
  since: string | null;
  gpsStatus: GpsMatchStatus;
  distanceFromClient: number | null;
  visitsToday: number;
  distanceKm: number;
};

const STATUS_LABEL: Record<RepFieldStatus, string> = {
  at_client: 'At Client',
  on_field: 'On Field',
  checked_out: 'Checked Out',
  offline: 'Offline',
};

type Tab = 'dashboard' | 'repList' | 'map' | 'trackingHistory' | 'clientLocations' | 'exceptions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'repList', label: 'Sales Rep Tracking' },
  { key: 'map', label: 'Map View' },
  { key: 'trackingHistory', label: 'Tracking History' },
  { key: 'clientLocations', label: 'Client Locations' },
  { key: 'exceptions', label: 'Location Mismatches' },
];

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function pointCoords(lat?: number | null, lng?: number | null): Coordinates | null {
  return lat != null && lng != null ? { latitude: lat, longitude: lng } : null;
}
function clientCoordsFrom(byCode: Map<string, Client>, code?: string | null): Coordinates | null {
  if (!code) return null;
  const c = byCode.get(code);
  return c && c.latitude != null && c.longitude != null ? { latitude: c.latitude, longitude: c.longitude } : null;
}
/** 'no_data' means one or both coordinates are missing, not that verification failed. */
function matchStatus(point: Coordinates | null, client: Coordinates | null): { status: GpsMatchStatus; distance: number | null } {
  if (!point || !client) return { status: 'no_data', distance: null };
  const distance = distanceMeters(point, client);
  return { status: distance <= DEFAULT_VERIFICATION_RADIUS_METERS ? 'verified' : 'mismatch', distance };
}
function gpsBadgeKind(status: GpsMatchStatus): 'verified' | 'mismatch' | 'unavailable' {
  return status === 'no_data' ? 'unavailable' : status;
}
function gpsBadgeLabel(status: GpsMatchStatus): string {
  if (status === 'verified') return 'Verified';
  if (status === 'mismatch') return 'Mismatch';
  return 'No GPS data';
}

// Mismatch review decisions have no backend table yet — persisted client-side
// in localStorage, the same approach RouteBeatPage uses for beats. The
// mismatch list itself is always computed fresh from real visit/client data.
type ReviewDecision = 'approved' | 'rejected';
function loadReviews(): Record<string, ReviewDecision> {
  try {
    const raw = window.localStorage.getItem(MISMATCH_REVIEW_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveReviews(next: Record<string, ReviewDecision>) {
  try {
    window.localStorage.setItem(MISMATCH_REVIEW_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export function GpsTrackingPage() {
  const { config } = useIndustry();
  const { matchesActiveIndustry, clientMatchesActiveIndustry } = useIndustryScope();

  const [tab, setTab] = useState<Tab>('dashboard');
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<TrackingSession | null>(null);

  const [visits, setVisits] = useState<Visit[]>([]);
  const [live, setLive] = useState<LiveVisit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [reps, setReps] = useState<Representative[]>([]);
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [savingClientId, setSavingClientId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewDecision>>(loadReviews);

  async function load() {
    try {
      const [visitsRes, liveRes, clientsRes, repsRes] = await Promise.all([
        api<{ data: Visit[] }>('/field-visits'),
        api<{ data: LiveVisit[] }>('/field-visits/live'),
        api<{ data: Client[] }>('/clients'),
        api<{ data: Representative[] }>('/sales-representatives'),
      ]);
      setVisits(visitsRes.data ?? []);
      setLive(liveRes.data ?? []);
      setClients(clientsRes.data ?? []);
      setReps(repsRes.data ?? []);
      setLastSynced(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load GPS data.');
    }
  }

  // Initial load, then poll the live feed so "Currently Tracking" and the
  // map stay current while the admin has this page open.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Everything below is scoped to the active Industry Type via the same
  // client-industry mapping ClientsPage/FieldActivityPage already use —
  // switching Industry Type swaps every dataset on this page.
  const scopedClients = useMemo(() => clients.filter((c) => matchesActiveIndustry(c.industry_type_id)), [clients, matchesActiveIndustry]);
  const scopedVisits = useMemo(() => visits.filter((v) => clientMatchesActiveIndustry(v.clients?.client_code)), [visits, clientMatchesActiveIndustry]);
  const scopedLive = useMemo(() => live.filter((v) => clientMatchesActiveIndustry(v.clients?.client_code)), [live, clientMatchesActiveIndustry]);
  const scopedRepCodes = useMemo(
    () => new Set(scopedVisits.map((v) => v.sales_representatives?.employee_code).filter((c): c is string => !!c)),
    [scopedVisits],
  );
  const scopedReps = useMemo(() => reps.filter((r) => scopedRepCodes.has(r.employee_code)), [reps, scopedRepCodes]);
  const clientByCode = useMemo(() => new Map(clients.map((c) => [c.client_code, c])), [clients]);
  const todaysScopedVisits = useMemo(() => scopedVisits.filter((v) => isToday(v.check_in_time)), [scopedVisits]);

  const liveByRepCode = useMemo(() => {
    const map = new Map<string, LiveVisit>();
    for (const v of scopedLive) {
      const code = v.sales_representatives?.employee_code;
      if (code) map.set(code, v);
    }
    return map;
  }, [scopedLive]);

  const lastVisitByRepCode = useMemo(() => {
    const map = new Map<string, Visit>();
    for (const v of [...scopedVisits].sort((a, b) => a.check_in_time.localeCompare(b.check_in_time))) {
      const code = v.sales_representatives?.employee_code;
      if (code) map.set(code, v); // ascending sort -> last write is the most recent visit
    }
    return map;
  }, [scopedVisits]);

  // Today's per-rep visit count and field-travel distance, built by walking
  // each rep's check-in/check-out coordinates in order and summing the
  // real Haversine distance between them.
  const { totalDistanceKm, repStats } = useMemo(() => {
    const byRep = new Map<string, { points: TrackingPoint[]; visitsToday: number }>();
    for (const v of [...todaysScopedVisits].sort((a, b) => a.check_in_time.localeCompare(b.check_in_time))) {
      const code = v.sales_representatives?.employee_code;
      if (!code) continue;
      const entry = byRep.get(code) ?? { points: [], visitsToday: 0 };
      entry.visitsToday += 1;
      const inPoint = pointCoords(v.check_in_lat, v.check_in_lng);
      if (inPoint) entry.points.push({ ...inPoint, timestamp: v.check_in_time });
      const outPoint = pointCoords(v.check_out_lat, v.check_out_lng);
      if (outPoint && v.check_out_time) entry.points.push({ ...outPoint, timestamp: v.check_out_time });
      byRep.set(code, entry);
    }
    const stats = new Map<string, { visitsToday: number; distanceKm: number }>();
    let totalMeters = 0;
    for (const [code, entry] of byRep) {
      const meters = routeDistanceMeters(entry.points);
      totalMeters += meters;
      stats.set(code, { visitsToday: entry.visitsToday, distanceKm: meters / 1000 });
    }
    return { totalDistanceKm: totalMeters / 1000, repStats: stats };
  }, [todaysScopedVisits]);

  const verification = useMemo(() => {
    let verified = 0;
    let mismatch = 0;
    for (const v of todaysScopedVisits) {
      const { status } = matchStatus(pointCoords(v.check_in_lat, v.check_in_lng), clientCoordsFrom(clientByCode, v.clients?.client_code));
      if (status === 'verified') verified += 1;
      else if (status === 'mismatch') mismatch += 1;
    }
    return { verified, mismatch };
  }, [todaysScopedVisits, clientByCode]);

  const activeSalesReps = scopedReps.filter((r) => r.status === 'active').length;
  const liveFieldVisits = scopedLive.length;

  const repRows: RepRow[] = useMemo(() => scopedReps.map((rep) => {
    const name = rep.user_profiles?.display_name ?? rep.employee_code;
    const stats = repStats.get(rep.employee_code);
    const liveVisit = liveByRepCode.get(rep.employee_code);

    if (liveVisit) {
      const point = pointCoords(liveVisit.latest_ping?.latitude ?? liveVisit.check_in_lat, liveVisit.latest_ping?.longitude ?? liveVisit.check_in_lng);
      const client = clientCoordsFrom(clientByCode, liveVisit.clients?.client_code);
      const { status, distance } = matchStatus(point, client);
      return {
        repId: rep.employee_code,
        repName: name,
        status: status === 'verified' ? 'at_client' : 'on_field',
        clientName: liveVisit.clients?.client_name ?? null,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        since: liveVisit.check_in_time,
        gpsStatus: status,
        distanceFromClient: distance,
        visitsToday: stats?.visitsToday ?? 0,
        distanceKm: stats?.distanceKm ?? 0,
      };
    }

    const lastVisit = lastVisitByRepCode.get(rep.employee_code);
    const lastPoint = lastVisit ? pointCoords(lastVisit.check_out_lat ?? lastVisit.check_in_lat, lastVisit.check_out_lng ?? lastVisit.check_in_lng) : null;
    return {
      repId: rep.employee_code,
      repName: name,
      status: stats ? 'checked_out' : 'offline',
      clientName: lastVisit?.clients?.client_name ?? null,
      latitude: lastPoint?.latitude ?? null,
      longitude: lastPoint?.longitude ?? null,
      since: lastVisit?.check_out_time ?? lastVisit?.check_in_time ?? null,
      gpsStatus: 'no_data',
      distanceFromClient: null,
      visitsToday: stats?.visitsToday ?? 0,
      distanceKm: stats?.distanceKm ?? 0,
    };
  }), [scopedReps, repStats, liveByRepCode, lastVisitByRepCode, clientByCode]);

  const mappableReps = useMemo(() => repRows.filter((r): r is RepRow & { latitude: number; longitude: number } => r.latitude != null && r.longitude != null), [repRows]);
  const selectedRep = repRows.find((r) => r.repId === selectedRepId) ?? null;

  // Tracking History: group each rep's real visits by calendar day and
  // connect their actual check-in/check-out coordinates — a real path
  // through real points, not a simulated GPS trail.
  const sessions: TrackingSession[] = useMemo(() => {
    const byKey = new Map<string, Visit[]>();
    for (const v of scopedVisits) {
      const code = v.sales_representatives?.employee_code;
      if (!code) continue;
      const key = `${code}|${v.check_in_time.slice(0, 10)}`;
      const list = byKey.get(key) ?? [];
      list.push(v);
      byKey.set(key, list);
    }
    const result: TrackingSession[] = [];
    for (const [key, group] of byKey) {
      const [code, date] = key.split('|');
      const sorted = [...group].sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
      const first = sorted[0];
      const allCheckedOut = sorted.every((v) => v.check_out_time);
      const points: TrackingPoint[] = [];
      let verifiedCount = 0;
      let mismatchCount = 0;
      for (const v of sorted) {
        const inPoint = pointCoords(v.check_in_lat, v.check_in_lng);
        if (inPoint) points.push({ ...inPoint, timestamp: v.check_in_time });
        const outPoint = pointCoords(v.check_out_lat, v.check_out_lng);
        if (outPoint && v.check_out_time) points.push({ ...outPoint, timestamp: v.check_out_time });
        const { status } = matchStatus(inPoint, clientCoordsFrom(clientByCode, v.clients?.client_code));
        if (status === 'verified') verifiedCount += 1;
        else if (status === 'mismatch') mismatchCount += 1;
      }
      result.push({
        id: key,
        repId: code,
        repName: first.sales_representatives?.user_profiles?.display_name ?? first.sales_representatives?.employee_code ?? code,
        date,
        startTime: first.check_in_time,
        endTime: allCheckedOut ? sorted[sorted.length - 1].check_out_time ?? null : null,
        distanceKm: routeDistanceMeters(points) / 1000,
        points,
        visitsCount: sorted.length,
        verifiedCount,
        mismatchCount,
        trackingActive: !allCheckedOut,
      });
    }
    return result.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }, [scopedVisits, clientByCode]);

  // Location Mismatches: every one of today's check-ins that fell outside
  // the verification radius, computed live — not a fixed seeded list.
  const mismatches = useMemo(() => todaysScopedVisits
    .map((v) => ({ visit: v, ...matchStatus(pointCoords(v.check_in_lat, v.check_in_lng), clientCoordsFrom(clientByCode, v.clients?.client_code)) }))
    .filter((m) => m.status === 'mismatch')
    .map((m) => ({
      id: m.visit.id,
      repName: m.visit.sales_representatives?.user_profiles?.display_name ?? m.visit.sales_representatives?.employee_code ?? 'Unassigned rep',
      clientName: m.visit.clients?.client_name ?? 'Unknown client',
      distance: m.distance ?? 0,
      checkInTime: m.visit.check_in_time,
      decision: reviews[m.visit.id],
    })), [todaysScopedVisits, clientByCode, reviews]);

  function reviewMismatch(id: string, decision: ReviewDecision) {
    setReviews((current) => {
      const next = { ...current, [id]: decision };
      saveReviews(next);
      return next;
    });
  }

  async function setClientLocation(clientId: string) {
    if (!navigator.geolocation) {
      setError('Location services are not available in this browser.');
      return;
    }
    setSavingClientId(clientId);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000 }));
      await api(`/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update client location.');
    } finally {
      setSavingClientId(null);
    }
  }

  return (
    <>
      <section className="page-panel">
        <div className="page-panel-heading">
          <div>
            <p className="eyebrow">FIELD OPERATIONS</p>
            <h2>GPS Verify &amp; Tracking</h2>
            <p>Verify Sales Representative visits and review field movement for the active Industry Type.</p>
          </div>
          <button type="button" className="secondary-action" onClick={() => void load()}>
            {lastSynced ? `Refresh · Synced ${timeLabel(lastSynced.toISOString())}` : 'Refresh'}
          </button>
        </div>
        <div className="gps-industry-banner">
          <span>Showing GPS activity for</span>
          <strong>{config.label}</strong>
          <span>— Sales Reps, clients and visits from other industries are hidden.</span>
        </div>
        {error && <p className="gps-error-inline" style={{ marginBottom: '1rem' }}>{error}</p>}
        <div className="gps-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {tab === 'dashboard' && (
        <section className="page-panel">
          <div className="kpi-grid lead-kpi-grid">
            <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">♙</div><div><span>Active Sales Reps</span><strong>{activeSalesReps}</strong></div></div>
            <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-blue">⦿</div><div><span>Live Field Visits</span><strong>{liveFieldVisits}</strong></div></div>
            <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Verified Visits Today</span><strong>{verification.verified}</strong></div></div>
            <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">⚠</div><div><span>Location Mismatches Today</span><strong>{verification.mismatch}</strong></div></div>
            <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">↗</div><div><span>Total Distance Today</span><strong>{totalDistanceKm.toFixed(1)} km</strong></div></div>
          </div>
          {scopedReps.length === 0 && (
            <div className="empty-state empty-state-lg">
              <div className="empty-state-icon">📍</div>
              <h3>No GPS activity for {config.label} yet</h3>
              <p>Sales Representative check-ins and field movement for this industry will appear here.</p>
            </div>
          )}
        </section>
      )}

      {tab === 'repList' && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">LIVE STATUS</p><h2>Sales Rep Tracking List</h2></div>
            <span className="visit-count">{repRows.length} representatives</span>
          </div>
          {repRows.length === 0 ? (
            <div className="empty-state empty-state-lg"><div className="empty-state-icon">📍</div><h3>No Sales Reps in {config.label}</h3><p>Reps with a visit against a {config.label} client will appear here.</p></div>
          ) : (
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr><th>Sales Rep</th><th>Current Status</th><th>Current / Last Client</th><th>Since</th><th>GPS Status</th><th>Today's Visits</th><th style={{ textAlign: 'right' }}>Distance</th></tr>
                </thead>
                <tbody>
                  {repRows.map((rep) => (
                    <tr key={rep.repId} onClick={() => { setSelectedRepId(rep.repId); setTab('map'); }} style={{ cursor: 'pointer' }}>
                      <td><strong>{rep.repName}</strong></td>
                      <td><span className="gps-status-pill" data-status={rep.status}>{STATUS_LABEL[rep.status]}</span></td>
                      <td>{rep.clientName ?? '—'}</td>
                      <td>{rep.since ? timeLabel(rep.since) : '—'}</td>
                      <td><span className="gps-badge" data-kind={gpsBadgeKind(rep.gpsStatus)}>{gpsBadgeLabel(rep.gpsStatus)}</span></td>
                      <td>{rep.visitsToday} Visits</td>
                      <td style={{ textAlign: 'right' }}>{rep.distanceKm.toFixed(1)} km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'map' && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">LIVE MAP</p><h2>Field Map View</h2></div>
          </div>
          <div className="gps-map-shell">
            <MapCanvas reps={mappableReps} clientLocations={scopedClients} selectedRepId={selectedRepId} onSelect={setSelectedRepId} />
            {selectedRep ? (
              <div className="gps-marker-detail">
                <h3>{selectedRep.repName}</h3>
                <span className="gps-status-pill" data-status={selectedRep.status}>{STATUS_LABEL[selectedRep.status]}</span>
                <dl>
                  <dt>Current Location</dt><dd>{selectedRep.latitude != null ? `${selectedRep.latitude.toFixed(4)}, ${selectedRep.longitude!.toFixed(4)}` : 'No GPS data'}</dd>
                  <dt>Since</dt><dd>{selectedRep.since ? timeLabel(selectedRep.since) : '—'}</dd>
                  <dt>Current / Last Client</dt><dd>{selectedRep.clientName ?? '—'}</dd>
                  <dt>GPS Status</dt><dd>{gpsBadgeLabel(selectedRep.gpsStatus)}</dd>
                  <dt>Distance from client</dt><dd>{selectedRep.distanceFromClient != null ? formatDistance(selectedRep.distanceFromClient) : '—'}</dd>
                </dl>
              </div>
            ) : (
              <div className="gps-marker-detail"><div className="gps-marker-empty">Select a marker or a row from the Sales Rep Tracking list to see details here.</div></div>
            )}
          </div>
        </section>
      )}

      {tab === 'trackingHistory' && !selectedSession && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">FIELD MOVEMENT</p><h2>Tracking History</h2></div>
            <span className="visit-count">{sessions.length} sessions</span>
          </div>
          {sessions.length === 0 ? (
            <div className="empty-state empty-state-lg"><div className="empty-state-icon">🗺️</div><h3>No tracking sessions for {config.label}</h3><p>A representative's check-ins for this industry will appear here.</p></div>
          ) : (
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Sales Rep</th><th>Date</th><th>Tracking</th><th style={{ textAlign: 'right' }}>Distance</th><th>Visits</th><th>Verified</th><th>Mismatch</th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} onClick={() => setSelectedSession(s)} style={{ cursor: 'pointer' }}>
                      <td><strong>{s.repName}</strong></td>
                      <td>{new Date(s.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td>{timeLabel(s.startTime)} – {s.endTime ? timeLabel(s.endTime) : <span className="gps-status-pill" data-status="on_field">Tracking Active</span>}</td>
                      <td style={{ textAlign: 'right' }}>{s.distanceKm.toFixed(1)} km</td>
                      <td>{s.visitsCount}</td>
                      <td>{s.verifiedCount}</td>
                      <td>{s.mismatchCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'trackingHistory' && selectedSession && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">ROUTE DETAILS</p><h2>{selectedSession.repName}</h2></div>
            <button type="button" className="secondary-action" onClick={() => setSelectedSession(null)}>Back to tracking history</button>
          </div>
          <div className="gps-route-summary">
            <div><span>Date</span><strong>{new Date(selectedSession.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>
            <div><span>Start</span><strong>{timeLabel(selectedSession.startTime)}</strong></div>
            <div><span>End</span><strong>{selectedSession.endTime ? timeLabel(selectedSession.endTime) : 'In progress'}</strong></div>
            <div><span>Total Distance</span><strong>{selectedSession.distanceKm.toFixed(1)} km</strong></div>
          </div>
          <div className="gps-route-summary">
            <div><span>Total Visits</span><strong>{selectedSession.visitsCount}</strong></div>
            <div><span>Verified Visits</span><strong>{selectedSession.verifiedCount}</strong></div>
            <div><span>Location Mismatch</span><strong>{selectedSession.mismatchCount}</strong></div>
            <div><span>Tracking</span><strong>{selectedSession.trackingActive ? 'Active' : 'Off'}</strong></div>
          </div>
          <RouteCanvas session={selectedSession} />
        </section>
      )}

      {tab === 'clientLocations' && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">MASTER DATA</p><h2>Client Location Management</h2></div>
            <span className="visit-count">{scopedClients.length} clients</span>
          </div>
          <div className="data-table-wrap">
            <table>
              <thead><tr><th>Client</th><th>Coordinates</th><th>Address</th><th>GPS Status</th><th /></tr></thead>
              <tbody>
                {scopedClients.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.client_name}</strong></td>
                    <td>{c.latitude != null ? `${c.latitude.toFixed(4)}, ${c.longitude!.toFixed(4)}` : '—'}</td>
                    <td>{c.address ?? c.city ?? '—'}</td>
                    <td>{c.latitude != null ? <span className="gps-badge" data-kind="verified">Set</span> : <span className="gps-badge" data-kind="pending">Not set</span>}</td>
                    <td>
                      <button type="button" className="text-action" disabled={savingClientId === c.id} onClick={() => void setClientLocation(c.id)}>
                        {savingClientId === c.id ? 'Getting location…' : c.latitude != null ? 'Update location' : 'Set Client Location'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-faint-inline" style={{ marginTop: '.6rem' }}>Uses this device's current GPS position. Stand at the client's premises before setting or updating a location.</p>
        </section>
      )}

      {tab === 'exceptions' && (
        <section className="page-panel">
          <div className="page-panel-heading">
            <div><p className="eyebrow">REVIEW QUEUE</p><h2>Location Mismatches — Today</h2></div>
            <span className="visit-count">{mismatches.length} check-ins</span>
          </div>
          {mismatches.length === 0 ? (
            <div className="empty-state empty-state-lg"><div className="empty-state-icon">✓</div><h3>No mismatches today</h3><p>Check-ins outside the {DEFAULT_VERIFICATION_RADIUS_METERS}m verification radius will appear here.</p></div>
          ) : mismatches.map((m) => (
            <div key={m.id} className="gps-verification-card">
              <div className="gps-verification-row">
                <div>
                  <strong>{m.repName}</strong> · {m.clientName}
                  <p className="gps-verification-coords">{formatDistance(m.distance)} from the registered client location · checked in {timeLabel(m.checkInTime)}</p>
                </div>
                <span className="gps-badge" data-kind={m.decision === 'approved' ? 'verified' : m.decision === 'rejected' ? 'mismatch' : 'pending'}>{m.decision ?? 'pending'}</span>
              </div>
              {!m.decision && (
                <div className="gps-mismatch-actions" style={{ marginTop: '.7rem' }}>
                  <button type="button" onClick={() => reviewMismatch(m.id, 'approved')}>Approve as valid</button>
                  <button type="button" className="secondary-action" onClick={() => reviewMismatch(m.id, 'rejected')}>Flag as invalid</button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function MapCanvas({ reps, clientLocations, selectedRepId, onSelect }: {
  reps: { repId: string; repName: string; latitude: number; longitude: number; gpsStatus: GpsMatchStatus }[];
  clientLocations: Client[];
  selectedRepId: string | null;
  onSelect: (id: string) => void;
}) {
  const points = [
    ...reps.map((r) => ({ lat: r.latitude, lng: r.longitude })),
    ...clientLocations.filter((c) => c.latitude != null).map((c) => ({ lat: c.latitude as number, lng: c.longitude as number })),
  ];
  if (points.length === 0) {
    return <div className="gps-map-canvas"><div className="gps-marker-empty">No GPS points to display for this industry yet.</div></div>;
  }
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats) - 0.01, maxLat = Math.max(...lats) + 0.01;
  const minLng = Math.min(...lngs) - 0.01, maxLng = Math.max(...lngs) + 0.01;
  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng || 1)) * 640 + 20;
    const y = (1 - (lat - minLat) / (maxLat - minLat || 1)) * 400 + 20;
    return [x, y] as const;
  };
  return (
    <div className="gps-map-canvas">
      <svg viewBox="0 0 680 440">
        {clientLocations.filter((c) => c.latitude != null).map((c) => {
          const [x, y] = project(c.latitude as number, c.longitude as number);
          return (
            <g key={c.id} className="gps-map-marker" data-status="client" transform={`translate(${x},${y})`}>
              <circle className="marker-dot" r={5} />
              <text x={9} y={4}>{c.client_name}</text>
            </g>
          );
        })}
        {reps.map((rep) => {
          const [x, y] = project(rep.latitude, rep.longitude);
          return (
            <g key={rep.repId} className="gps-map-marker" data-status={rep.gpsStatus === 'mismatch' ? 'mismatch' : 'verified'} transform={`translate(${x},${y})`} onClick={() => onSelect(rep.repId)}>
              <circle className="marker-halo" r={12} />
              <circle className="marker-dot" r={selectedRepId === rep.repId ? 8 : 6} />
              <text x={11} y={4}>{rep.repName}</text>
            </g>
          );
        })}
      </svg>
      <div className="gps-map-legend">
        <span><i style={{ background: 'var(--green)' }} /> Verified rep location</span>
        <span><i style={{ background: 'var(--red)' }} /> Location mismatch</span>
        <span><i style={{ background: 'var(--ink)' }} /> Client / institution</span>
      </div>
    </div>
  );
}

function RouteCanvas({ session }: { session: TrackingSession }) {
  if (session.points.length === 0) return <div className="gps-map-canvas"><div className="gps-marker-empty">No GPS coordinates recorded for this session.</div></div>;
  const lats = session.points.map((p) => p.latitude);
  const lngs = session.points.map((p) => p.longitude);
  const minLat = Math.min(...lats) - 0.005, maxLat = Math.max(...lats) + 0.005;
  const minLng = Math.min(...lngs) - 0.005, maxLng = Math.max(...lngs) + 0.005;
  const project = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng || 1)) * 640 + 20;
    const y = (1 - (lat - minLat) / (maxLat - minLat || 1)) * 360 + 20;
    return [x, y] as const;
  };
  const path = session.points.map((p) => project(p.latitude, p.longitude)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  return (
    <div className="gps-map-canvas" style={{ minHeight: 400 }}>
      <svg viewBox="0 0 680 400">
        <path className="gps-map-route" d={path} />
        {session.points.map((p, i) => {
          const [x, y] = project(p.latitude, p.longitude);
          return (
            <g key={i} className="gps-map-marker" data-status="verified" transform={`translate(${x},${y})`}>
              <circle className="marker-dot" r={5} />
              <text x={9} y={4}>{timeLabel(p.timestamp)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}