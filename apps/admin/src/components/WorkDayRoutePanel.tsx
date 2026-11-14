import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { api } from '../lib/api';
import './WorkDayRoutePanel.css';

// Phase 3: real GPS route of a rep's work day. Data comes from the phone's 1-minute GPS points
// (field_activity_pings) through GET /work-days/overview and GET /work-days/:id/route.

const POLL_MS = 30000;

type DayStatus = 'online' | 'signal_lost' | 'ended';
type Overview = {
  id: string;
  employeeCode: string;
  repName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  status: DayStatus;
  pointCount: number;
  distanceKm: number;
  lastSeenAt: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  mockedPoints: number;
};
type RoutePoint = { latitude: number; longitude: number; accuracyMeters: number | null; capturedAt: string; visitId: string | null; mocked: boolean };
type RouteVisit = {
  id: string;
  status: string;
  check_in_time: string;
  check_out_time: string | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_within_geofence: boolean | null;
  outcome: string | null;
  unlisted_client_name: string | null;
  clients: { client_code?: string; client_name?: string } | null;
};
type RouteData = {
  session: { id: string; repName: string; started_at: string; ended_at: string | null; end_reason: string | null };
  distanceKm: number;
  points: RoutePoint[];
  visits: RouteVisit[];
};

const STATUS_TEXT: Record<DayStatus, string> = { online: 'Online', signal_lost: 'Signal lost', ended: 'Day ended' };
const STATUS_PILL: Record<DayStatus, string> = { online: 'on_field', signal_lost: 'offline', ended: 'checked_out' };

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function todayLocal() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the browser's timezone
}
function ago(iso: string | null) {
  if (!iso) return 'No GPS yet';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} m ago` : `${Math.floor(hours / 24)} d ago`;
}

// Zooms to the route once per selected day, so the 30-second refresh does not reset the admin's zoom.
function FitRoute({ points, routeKey }: { points: [number, number][]; routeKey: string }) {
  const map = useMap();
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (points.length === 0 || fittedFor.current === routeKey) return;
    fittedFor.current = routeKey;
    if (points.length === 1) { map.setView(points[0], 16); return; }
    map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
  }, [map, points, routeKey]);
  return null;
}

export function WorkDayRoutePanel() {
  const [date, setDate] = useState(todayLocal);
  const [rows, setRows] = useState<Overview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const result = await api<{ data: { rows: Overview[] } }>(`/work-days/overview?date=${date}`);
      setRows(result.data.rows ?? []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load work days.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    setLoading(true);
    void loadOverview();
    if (date !== todayLocal()) return undefined; // past days do not change
    const id = window.setInterval(() => void loadOverview(), POLL_MS);
    return () => window.clearInterval(id);
  }, [date, loadOverview]);

  const loadRoute = useCallback(async (id: string, silent = false) => {
    if (!silent) setRouteLoading(true);
    try {
      const result = await api<{ data: RouteData }>(`/work-days/${id}/route`);
      setRoute(result.data);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the route.');
    } finally {
      setRouteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) { setRoute(null); return undefined; }
    void loadRoute(selectedId);
    const selected = rows.find((row) => row.id === selectedId);
    if (selected && selected.status === 'ended') return undefined;
    const id = window.setInterval(() => void loadRoute(selectedId, true), POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadRoute]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? null;
  const line = useMemo<[number, number][]>(() => (route?.points ?? []).map((p) => [p.latitude, p.longitude]), [route]);
  const visitMarks = useMemo(() => (route?.visits ?? []).filter((v) => v.check_in_lat != null && v.check_in_lng != null), [route]);
  const fitPoints = useMemo<[number, number][]>(
    () => [...line, ...visitMarks.map((v) => [v.check_in_lat as number, v.check_in_lng as number] as [number, number])],
    [line, visitMarks],
  );
  const mockedInRoute = route?.points.filter((p) => p.mocked).length ?? 0;

  return (
    <section className="page-panel">
      <div className="wdr-toolbar">
        <label>Date <input type="date" value={date} max={todayLocal()} onChange={(event) => { setDate(event.target.value || todayLocal()); setSelectedId(null); }} /></label>
        <button type="button" className="wdr-refresh" onClick={() => { void loadOverview(); if (selectedId) void loadRoute(selectedId, true); }}>Refresh</button>
        <span className="wdr-hint">{date === todayLocal() ? 'Live: updates every 30 seconds' : 'Past day'}</span>
      </div>
      {error && <p className="gps-error-inline" style={{ marginBottom: '1rem' }}>{error}</p>}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Sales Rep</th><th>Status</th><th>Day</th><th>Last seen</th><th>GPS points</th><th>Distance</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === selectedId ? 'wdr-row-active' : ''}>
                <td><strong>{row.repName}</strong><div className="wdr-sub">{row.employeeCode}</div></td>
                <td>
                  <span className="gps-status-pill" data-status={STATUS_PILL[row.status]}>{STATUS_TEXT[row.status]}</span>
                  {row.mockedPoints > 0 && <div className="wdr-warn">{row.mockedPoints} fake-GPS point{row.mockedPoints === 1 ? '' : 's'}</div>}
                </td>
                <td>{clock(row.startedAt)} – {row.endedAt ? clock(row.endedAt) : 'running'}{row.endReason === 'auto' && <div className="wdr-sub">Auto-closed</div>}</td>
                <td>{row.status === 'ended' ? '—' : ago(row.lastSeenAt)}</td>
                <td>{row.pointCount}</td>
                <td><strong>{row.distanceKm.toFixed(1)} km</strong></td>
                <td><button type="button" className="wdr-view" onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}>{row.id === selectedId ? 'Hide route' : 'View route'}</button></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7}><div className="gps-marker-empty">No rep started a work day on this date.</div></td></tr>
            )}
            {loading && rows.length === 0 && <tr><td colSpan={7}>Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <div className="wdr-route">
          <h3>{selectedRow?.repName ?? route?.session.repName ?? 'Route'}: route trail</h3>
          {routeLoading && !route && <p>Loading route…</p>}
          {route && (
            <>
              <div className="gps-route-summary">
                <span>Started <strong>{clock(route.session.started_at)}</strong></span>
                <span>{route.session.ended_at ? <>Ended <strong>{clock(route.session.ended_at)}</strong></> : <strong>Day still running</strong>}</span>
                <span>Distance <strong>{route.distanceKm.toFixed(1)} km</strong></span>
                <span>GPS points <strong>{route.points.length}</strong></span>
                <span>Visits <strong>{route.visits.length}</strong></span>
              </div>
              {mockedInRoute > 0 && <p className="wdr-warn">{mockedInRoute} point{mockedInRoute === 1 ? '' : 's'} came from a fake/mock GPS app. Check this rep's route carefully.</p>}
              {line.length === 0 && visitMarks.length === 0 ? (
                <div className="gps-map-canvas"><div className="gps-marker-empty">No GPS points received for this day yet.</div></div>
              ) : (
                <div className="gps-map-canvas">
                  <MapContainer center={fitPoints[0] ?? [0, 0]} zoom={14} scrollWheelZoom className="gps-leaflet-map wdr-map">
                    <FitRoute points={fitPoints} routeKey={selectedId} />
                    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.85 }} />}
                    {line.length > 0 && (
                      <CircleMarker center={line[0]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }}>
                        <Tooltip direction="top">Start {clock(route.points[0].capturedAt)}</Tooltip>
                      </CircleMarker>
                    )}
                    {line.length > 1 && (
                      <CircleMarker center={line[line.length - 1]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: route.session.ended_at ? '#64748b' : '#dc2626', fillOpacity: 1 }}>
                        <Tooltip direction="top">{route.session.ended_at ? 'Last point' : 'Last seen'} {clock(route.points[route.points.length - 1].capturedAt)}</Tooltip>
                      </CircleMarker>
                    )}
                    {visitMarks.map((visit) => (
                      <CircleMarker key={visit.id} center={[visit.check_in_lat as number, visit.check_in_lng as number]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: visit.check_in_within_geofence === false ? '#f59e0b' : '#0f172a', fillOpacity: 1 }}>
                        <Tooltip direction="right" permanent>{visit.clients?.client_name ?? visit.unlisted_client_name ?? 'Visit'}</Tooltip>
                      </CircleMarker>
                    ))}
                  </MapContainer>
                  <div className="gps-map-legend">
                    <span><i style={{ background: '#16a34a' }} /> Day start</span>
                    <span><i style={{ background: '#dc2626' }} /> Last seen</span>
                    <span><i style={{ background: '#0f172a' }} /> Client visit</span>
                    <span><i style={{ background: '#f59e0b' }} /> Visit outside geofence</span>
                  </div>
                </div>
              )}
              {route.visits.length > 0 && (
                <div className="data-table-wrap" style={{ marginTop: '1rem' }}>
                  <table className="data-table">
                    <thead><tr><th>Client</th><th>Check-in</th><th>Check-out</th><th>Location check</th><th>Outcome</th></tr></thead>
                    <tbody>
                      {route.visits.map((visit) => (
                        <tr key={visit.id}>
                          <td>{visit.clients?.client_name ?? visit.unlisted_client_name ?? 'Unlisted client'}</td>
                          <td>{clock(visit.check_in_time)}</td>
                          <td>{visit.check_out_time ? clock(visit.check_out_time) : 'In progress'}</td>
                          <td><span className="gps-badge" data-kind={visit.check_in_within_geofence === true ? 'verified' : visit.check_in_within_geofence === false ? 'mismatch' : 'unavailable'}>{visit.check_in_within_geofence === true ? 'At client' : visit.check_in_within_geofence === false ? 'Outside geofence' : 'No data'}</span></td>
                          <td>{visit.outcome ? visit.outcome.replace(/_/g, ' ') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}