import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { openRecord } from '../lib/recordFocus';
import { queueVehicleDraft } from '../lib/vehicleDraftHandoff';
import './MasterDataPages.css';

type Check = { key: string; label: string; count: number; samples: string[]; fixable: boolean };
type Health = { checkedAt: string; ok: boolean; checks: Check[] };
type Repair = { fixed: Record<string, number>; health: Health };
type Overview = Record<string, unknown>;

const pretty = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Where a listed record is fixed. Clicking it opens that exact record (or, for a missing policy, a new one with the VIN filled in).
type Target = { hash: string; resource?: string; field?: string; value?: string; newInsurance?: boolean };
function targetFor(key: string, sample: string): Target | null {
  const first = sample.split(' ')[0]; // 'VIN (BK-0001)' and 'PART (3 left)' start with the code
  const booking = (value: string): Target => ({ hash: 'industry:vehicle:booking', resource: '/vehicle/bookings', field: 'booking_number', value });
  const delivery = (field: string, value: string): Target => ({ hash: 'industry:vehicle:delivery-pdi', resource: '/vehicle/deliveries', field, value });
  const unit = (value: string): Target => ({ hash: 'industry:vehicle:catalog', resource: '/vehicle/units', field: 'vin', value });
  switch (key) {
    case 'models_without_product': return { hash: 'industry:vehicle:catalog' };
    case 'orders_without_booking': return { hash: 'orders' };
    case 'allocated_without_delivery':
    case 'waiting_with_stock': return booking(first);
    case 'orphan_holds':
    case 'booking_unit_mismatch':
    case 'delivered_unit_not_delivered': return unit(first);
    case 'delivered_no_registration':
    case 'delivered_no_warranty': return delivery('vin', first);
    case 'deliveries_no_order': return delivery('delivery_number', first);
    case 'delivered_no_insurance': return { hash: 'industry:vehicle:insurance', value: first, newInsurance: true };
    case 'parts_low_stock': return { hash: 'industry:vehicle:catalog', resource: '/vehicle/parts', field: 'part_code', value: first };
    case 'records_without_client': {
      const m = /^(Booking|Delivery|Test drive) (.+)$/.exec(sample);
      if (!m) return null;
      if (m[1] === 'Booking') return booking(m[2]);
      if (m[1] === 'Delivery') return delivery('delivery_number', m[2]);
      return { hash: 'industry:vehicle:test-drive', resource: '/vehicle/test-drives', field: 'test_drive_number', value: m[2] };
    }
    default: return null;
  }
}
// A delivered vehicle with no policy: open the Add insurance form with the VIN, client and booking already filled (from its delivery / booking).
async function openNewInsurance(vin: string): Promise<void> {
  const draft: Record<string, string> = { vin, policy_type: 'Comprehensive' };
  try {
    const [dl, bk] = await Promise.all([
      api<{ data: Record<string, unknown>[] }>('/vehicle/deliveries').catch(() => ({ data: [] as Record<string, unknown>[] })),
      api<{ data: Record<string, unknown>[] }>('/vehicle/bookings').catch(() => ({ data: [] as Record<string, unknown>[] })),
    ]);
    const newest = (rows: Record<string, unknown>[]) => rows.filter((x) => String(x.vin ?? '') === vin && x.status !== 'Cancelled').sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0];
    const d = newest(dl.data ?? []), b = newest(bk.data ?? []);
    const clientId = d?.client_id ?? b?.client_id, clientName = d?.client_name ?? b?.client_name, bookingNo = d?.booking_number ?? b?.booking_number;
    if (clientId) draft.client_id = String(clientId);
    if (clientName) draft.client_name = String(clientName);
    if (bookingNo) draft.booking_number = String(bookingNo);
    const source = String(b?.insurance_source ?? '');
    if (['Dealer arranged', "Customer's own"].includes(source)) draft.insurance_source = source;
  } catch { /* the form still opens with the VIN */ }
  queueVehicleDraft('insurance', draft);
}
function openTarget(t: Target): void {
  if (t.newInsurance && t.value) { void openNewInsurance(t.value); return; }
  if (t.resource && t.field && t.value) { openRecord(t.hash, { resource: t.resource, field: t.field, value: t.value }); return; }
  window.location.hash = t.hash;
}

function flatten(o: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flatten(v, prefix ? `${prefix} / ${pretty(k)}` : pretty(k), out);
  } else if (typeof o === 'number' || typeof o === 'string') out.push([prefix, String(o)]);
  return out;
}

export function VehicleInsightsPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
  const [health, setHealth] = useState<Health | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true); setError(null);
    try {
      const [h, o] = await Promise.all([
        api<{ data: Health }>(`/vehicle/insights/health${q}`),
        api<{ data: Overview }>(`/vehicle/insights/overview${q}`).catch(() => ({ data: null })),
      ]);
      setHealth(h.data); setOverview(o.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load insights'); }
    setBusy(false);
  }
  async function repair() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api<{ data: Repair }>(`/vehicle/insights/repair${q}`, { method: 'POST' });
      const n = Object.values(r.data.fixed).reduce((a, b) => a + b, 0);
      setMsg(n ? `Repaired ${n} item(s): ${Object.entries(r.data.fixed).map(([k, v]) => `${pretty(k)} ${v}`).join(', ')}` : 'Nothing needed repair.');
      setHealth(r.data.health);
    } catch (e) { setError(e instanceof Error ? e.message : 'Repair failed'); }
    setBusy(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeIndustryTypeId]);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Vehicle Insights &amp; Link Health</h2>
          <p style={{ margin: '4px 0 0', opacity: 0.7 }}>Checks the Lead → Test drive → Booking → Delivery → After-sales chain and repairs missed links.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={busy} onClick={() => void load()}>Re-check</button>
          <button type="button" disabled={busy || !health || health.ok} onClick={() => void repair()}>Repair broken links</button>
        </div>
      </div>
      {error && <div role="alert" style={{ color: '#b00020' }}>{error}</div>}
      {msg && <div role="status">{msg}</div>}
      {health && (
        <section>
          <h3>{health.ok ? 'All links healthy' : 'Issues found'} <small style={{ opacity: 0.6 }}>checked {new Date(health.checkedAt).toLocaleString()}</small></h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
            {health.checks.map((c) => (
              <li key={c.key} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10 }}>
                <strong>{c.count === 0 ? '✔' : '⚠'} {c.label}</strong>: {c.count}{!c.fixable && c.count > 0 ? ' (fix manually)' : ''}
                {c.count > 0 && (
                  <div style={{ fontSize: 12, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {c.samples.map((smp) => {
                      const t = targetFor(c.key, smp);
                      return t
                        ? <button key={smp} type="button" title="Open this record to fix it" onClick={() => openTarget(t)} style={{ background: 'none', border: '1px solid #bbb', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>{smp} →</button>
                        : <span key={smp} style={{ opacity: 0.7 }}>{smp}</span>;
                    })}
                    {c.count > c.samples.length && <span style={{ opacity: 0.7 }}>… +{c.count - c.samples.length}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {overview && (
        <section>
          <h3>Overview (last 90 days)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
            {flatten(overview).slice(0, 60).map(([k, v]) => (
              <div key={k} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 10 }}><div style={{ fontSize: 12, opacity: 0.7 }}>{k}</div><strong>{v}</strong></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}