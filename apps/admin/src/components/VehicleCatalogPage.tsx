import { useState } from 'react';
import { VehicleMasterPage, VehicleModuleConfig, VehicleRecord } from './VehicleMasterPage';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import './VehicleUnitIntake.css';

/**
 * A vehicle model/variant is not the same record as an individual vehicle
 * unit (each has its own VIN and lifecycle) — so this extends the existing
 * Core Products module with two linked, config-driven views instead of a
 * second generic product master: "Model / variant" catalog entries, and
 * the "Individual units" that reference a model by VIN.
 */

const partsConfig: VehicleModuleConfig = {
  resource: '/vehicle/parts',
  eyebrowModule: 'VEHICLE / PARTS CATALOG',
  title: 'Spare parts',
  description: 'Parts master and stock. In a service record write the parts as "PART-CODE x qty" (one per line): when the service is Completed the stock is reduced once and the service cost is filled in (parts + labour).',
  icon: '⚙',
  emptyIcon: '⚙',
  codeField: 'part_code',
  nameField: 'part_name',
  statusOptions: ['Active', 'Inactive', 'Discontinued'],
  searchableKeys: ['part_code', 'part_name', 'category', 'supplier'],
  fields: [
    { key: 'part_code', label: 'Part code', type: 'text', required: true, listColumn: true },
    { key: 'part_name', label: 'Part name', type: 'text', required: true, listColumn: true },
    { key: 'category', label: 'Category', type: 'text', group: 'Part' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Part' },
    { key: 'compatible_models', label: 'Compatible models', type: 'text', group: 'Part' },
    { key: 'stock_quantity', label: 'Stock', type: 'number', listColumn: true, group: 'Stock' },
    { key: 'reorder_level', label: 'Reorder level', type: 'number', group: 'Stock' },
    { key: 'cost_price', label: 'Cost price', type: 'number', group: 'Pricing' },
    { key: 'selling_price', label: 'Selling price', type: 'number', listColumn: true, group: 'Pricing' },
    { key: 'supplier', label: 'Supplier', type: 'text', group: 'Pricing' },
    { key: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Discontinued'], listColumn: true, group: 'Pricing' },
  ],
  kpis: [
    { icon: '⚙', iconClass: 'kpi-icon-ink', label: 'Parts', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Low stock', value: (r) => String(r.filter((x) => x.reorder_level !== null && x.reorder_level !== undefined && Number(x.stock_quantity) <= Number(x.reorder_level)).length) },
    { icon: '₹', iconClass: 'kpi-icon-green', label: 'Stock value (cost)', value: (r) => `₹${r.reduce((s, x) => s + (Number(x.stock_quantity) || 0) * (Number(x.cost_price) || 0), 0).toLocaleString('en-IN')}` },
  ],
  sampleRecords: [],
};

const UNIT_STATUSES = ['In Transit', 'Received', 'PDI Pending', 'Available', 'Reserved', 'Booked', 'Allocated', 'Demo', 'Under Service', 'Damaged', 'Sold', 'Delivered', 'Returned'];

const unitConfig: VehicleModuleConfig = {
  resource: '/vehicle/units',
  eyebrowModule: 'VEHICLE / PARTS CATALOG',
  title: 'Individual vehicle units',
  description: 'Every physical vehicle, traced by VIN against its model/variant and dealer. Extends the existing Core Inventory module for unit-level, not model-level, stock — booking VIN002 never touches the availability of VIN001 or VIN003.',
  icon: '▥',
  emptyIcon: '▥',
  codeField: 'vin',
  nameField: 'vin',
  statusOptions: UNIT_STATUSES,
   statusClassMap: {
    'in transit': 'status-badge vs-in-transit',        // blue
    'received': 'status-badge vs-received',            // cyan
    'pdi pending': 'status-badge vs-pdi-pending',      // amber
    'available': 'status-badge vs-available',          // green
    'reserved': 'status-badge vs-reserved',            // purple
    'booked': 'status-badge vs-booked',                // pink
    'allocated': 'status-badge vs-allocated',          // indigo
    'demo': 'status-badge vs-demo',                    // lime
    'under service': 'status-badge vs-under-service',  // orange
    'damaged': 'status-badge vs-damaged',              // red
    'sold': 'status-badge vs-sold',                    // slate
    'delivered': 'status-badge vs-delivered',          // brown
    'returned': 'status-badge vs-returned',            // teal
  },
  searchableKeys: ['vin', 'engine_number', 'registration_number', 'model_name', 'dealer_name'],
  fields: [
    { key: 'vin', label: 'VIN / Chassis number', type: 'text', listColumn: true, helpText: 'Leave blank to create a temporary VIN automatically. Replace it with the real VIN later.' },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name',
      autoFillMap: { model_name: 'model_name', variant: 'variant' },
      format: (_value, row) => [row.model_name, row.variant].filter(Boolean).join(' ') || '—',
    },
    // Lean add form: only what a person really knows when a vehicle arrives.
    // Model name, variant and dealer name are filled by the API from the linked records,
    // so these fields stay in the config (saved/used by the system) but are hidden from the form.
    { key: 'model_name', label: 'Model', type: 'text', readOnly: true, visibleIf: () => false },
    { key: 'variant', label: 'Variant', type: 'text', readOnly: true, visibleIf: () => false },
    { key: 'color', label: 'Colour', type: 'text' },
    { key: 'engine_number', label: 'Engine number', type: 'text' },
    { key: 'registration_number', label: 'Registration number', type: 'text', visibleIf: () => false },
    { key: 'manufacturing_date', label: 'Manufacturing date', type: 'date', visibleIf: () => false },
    { key: 'odometer', label: 'Odometer', type: 'number', visibleIf: () => false },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', listColumn: true,
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name',
      autoFillMap: { dealer_name: 'dealer_name' },
      helpText: 'Assign the dealer this vehicle belongs to (optional).',
    },
    { key: 'dealer_name', label: 'Dealer', type: 'text', readOnly: true, visibleIf: () => false },
    { key: 'current_location', label: 'Current location', type: 'text', visibleIf: () => false },
    { key: 'purchase_cost', label: 'Purchase cost', type: 'number', visibleIf: () => false },
    { key: 'selling_price', label: 'Selling price', type: 'number', visibleIf: () => false },
    {
      key: 'status', label: 'Vehicle status', type: 'select', options: UNIT_STATUSES, listColumn: true,
      visibleIf: (form) => form.status !== '', // Edit only: a new unit has no status yet, so the field stays hidden on Add
      helpText: 'Booked, Allocated, Sold and Delivered change automatically from bookings and delivery. Edit by hand only to fix a unit, e.g. Damaged back to Received for re-inspection.',
    },  ],
  kpis: [
    { icon: '▥', iconClass: 'kpi-icon-ink', label: 'Total units', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Available', value: (r) => String(r.filter((x) => x.status === 'Available').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Booked / allocated', value: (r) => String(r.filter((x) => x.status === 'Booked' || x.status === 'Reserved' || x.status === 'Allocated').length) },
    { icon: '↗', iconClass: 'kpi-icon-school', label: 'Sold / delivered', value: (r) => String(r.filter((x) => x.status === 'Sold' || x.status === 'Delivered').length) },
  ],
  sampleRecords: [],
};

// Stock intake: pick a model + quantity (or paste the real VINs) to add many units at once,
// and mark a whole PDI batch as passed.
function UnitIntakePanel({ rows }: { rows: VehicleRecord[] }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<Record<string, unknown>[]>([]);
  const [modelId, setModelId] = useState('');
  const [qty, setQty] = useState('1');
  const [colour, setColour] = useState('');
  const [vinsText, setVinsText] = useState('');
  const [pdiDone, setPdiDone] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdiOpen, setPdiOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
  const waiting = rows.filter((r) => (r.status === 'Received' || r.status === 'PDI Pending') && typeof r.vin === 'string' && !String(r.id).startsWith('demo-'));
  const vins = vinsText.split('\n').map((l) => l.trim()).filter(Boolean);
  const count = vins.length > 0 ? vins.length : Math.floor(Number(qty)) || 0;

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next && models.length === 0) {
      try {
        setModels((await api<{ data: Record<string, unknown>[] }>(`/vehicle/models${q}`)).data ?? []);
      } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not load models'); }
    }
  }

   const allPicked = waiting.length > 0 && picked.length === waiting.length;
  const chosen = waiting.filter((r) => picked.includes(String(r.id)));

  function togglePicked(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function passSelected() {
    if (!chosen.length) return;
    setBusy(true); setMsg('');
    try {
      const res = await api<{ data: { passed: number } }>(`/vehicle/units/pdi-pass${q}`, { method: 'POST', body: JSON.stringify({ vins: chosen.map((r) => r.vin) }) });
      setMsg(`${res.data.passed} unit(s) passed PDI and are now Available; waiting bookings were allocated.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not mark PDI passed'); } finally { setBusy(false); }
  }

  async function failSelected() {
    if (!chosen.length) return;
    if (!window.confirm(`Mark ${chosen.length} unit(s) as failed PDI (Damaged)? They will not count as available stock.`)) return;
    setBusy(true); setMsg('');
    try {
      for (const r of chosen) {
        await api(`/vehicle/units/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Damaged' }) });
      }
      setMsg(`${chosen.length} unit(s) marked as Damaged (failed PDI).`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not mark the units as failed'); } finally { setBusy(false); }
  }

  async function importUnits() {
    setMsg('');
    if (!modelId) { setMsg('Select a model first.'); return; }
    if (count < 1) { setMsg('Enter a quantity of at least 1.'); return; }
    if (count > 500) { setMsg('Add at most 500 units at a time.'); return; }
    setBusy(true);
    try {
      const units: Record<string, unknown>[] = Array.from({ length: count }, (_, i) => ({
        model_id: modelId,
        color: colour.trim() || undefined,
        ...(vins[i] ? { vin: vins[i] } : {}),
        ...(pdiDone ? { status: 'Available' } : {}),
      }));
      const res = await api<{ data: { created: number; errors: { row: number; vin: string; error: string }[] } }>(`/vehicle/units/bulk${q}`, { method: 'POST', body: JSON.stringify({ units }) });
      const failed = res.data.errors.map((e) => `${e.vin || `row ${e.row}`}: ${e.error}`);
      setMsg(`${res.data.created} unit(s) added as ${pdiDone ? 'Available' : 'Received (waiting for PDI)'}.${failed.length ? ` Not added: ${failed.join(' | ')}` : ''}`);
      if (res.data.created) setTimeout(() => window.location.reload(), 2500);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Import failed'); } finally { setBusy(false); }
  }

  return (
    <div className="unit-intake">
            <div className="unit-intake__bar">
        <button type="button" className="unit-intake__pdi-btn" disabled={busy || !waiting.length} onClick={() => setPdiOpen(!pdiOpen)}>
          {pdiOpen ? 'Close PDI check' : 'PDI check'}
          <span className="unit-intake__count">{waiting.length}</span>
        </button>
        <button type="button" className="unit-intake__stock-btn" onClick={() => void openPanel()}>
          <span className="unit-intake__stock-icon" aria-hidden="true">{open ? '−' : '+'}</span>
          {open ? 'Close stock intake' : 'Add stock (bulk intake)'}
        </button>
      </div>
      {pdiOpen && waiting.length > 0 && (
        <div className="unit-intake__card unit-intake__pdi-card">
          <h4 className="unit-intake__title">PDI check</h4>
          <p className="unit-intake__sub">Tick the vehicles that passed inspection. Mark problem vehicles as failed. To fix a wrong VIN, use ⋮ → Edit on the row first.</p>
          <label className="unit-intake__check" style={{ marginTop: '0.9rem' }}>
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : waiting.map((r) => String(r.id)))} />
            Select all ({waiting.length})
          </label>
          <div className="unit-intake__pdi-list">
            {waiting.map((r) => (
              <label key={String(r.id)} className="unit-intake__pdi-row">
                <input type="checkbox" checked={picked.includes(String(r.id))} onChange={() => togglePicked(String(r.id))} />
                <span className="unit-intake__pdi-vin">{String(r.vin)}</span>
                <span>{[r.model_name, r.variant].filter(Boolean).join(' ')}</span>
              </label>
            ))}
          </div>
          <div className="unit-intake__footer">
            <span className="unit-intake__summary">{picked.length} selected</span>
            <div className="unit-intake__actions">
              <button type="button" className="quiet-button" disabled={busy || !picked.length} onClick={() => void failSelected()}>Mark as failed</button>
              <button type="button" className="primary-action" disabled={busy || !picked.length} onClick={() => void passSelected()}>Pass selected ({picked.length})</button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="unit-intake__card">
          <h4 className="unit-intake__title">Stock intake</h4>
          <p className="unit-intake__sub">Choose a model and quantity. Temporary VINs are created automatically, or paste the real VINs from the delivery list.</p>
          <div className="unit-intake__grid">
            <label className="unit-intake__field">
              Model / variant *
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Select a model</option>
                {models.map((m) => (
                  <option key={String(m.id)} value={String(m.id)}>
                    {[m.model_name, m.variant].filter(Boolean).join(' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="unit-intake__field">
              Quantity
              <input type="number" min="1" max="500" step="1" value={vins.length > 0 ? String(vins.length) : qty} disabled={vins.length > 0} onChange={(e) => setQty(e.target.value)} />
              {vins.length > 0 && <span className="unit-intake__hint">Taken from the VIN list</span>}
            </label>
            <label className="unit-intake__field">
              Colour (optional)
              <input type="text" placeholder="e.g. Pearl White" value={colour} onChange={(e) => setColour(e.target.value)} />
            </label>
            <label className="unit-intake__field unit-intake__field--wide">
              Real VINs (optional)
              <textarea rows={4} placeholder={'One VIN per line. Leave empty to create temporary VINs.'} value={vinsText} onChange={(e) => setVinsText(e.target.value)} />
              <span className="unit-intake__hint">Paste the VIN column from the manufacturer's delivery list.</span>
            </label>
          </div>
          <div className="unit-intake__footer">
            <label className="unit-intake__check">
              <input type="checkbox" checked={pdiDone} onChange={(e) => setPdiDone(e.target.checked)} />
              PDI already done (add as Available)
            </label>
            <div className="unit-intake__actions">
              <span className="unit-intake__summary">
                {count > 0 ? `${count} unit${count === 1 ? '' : 's'} will be added as ${pdiDone ? 'Available' : 'Received'}` : 'Enter a quantity'}
              </span>
              <button type="button" className="quiet-button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="primary-action" disabled={busy || !modelId || count < 1} onClick={importUnits}>
                {busy ? 'Adding…' : `Add ${count > 0 ? count : ''} unit${count === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && <p className="unit-intake__msg">{msg}</p>}
    </div>
  );
}
export function VehicleCatalogPage() {
  // Vehicle models are now added in Products (the API keeps the linked model record in step),
  // so this page only keeps the physical units (VIN) and the spare parts.
  const [tab, setTab] = useState<'units' | 'parts'>('units');
  return (
    <div>
      <div className="master-toolbar" style={{ marginBottom: '0.75rem' }}>
        <div className="master-search">
          <button type="button" className={tab === 'units' ? 'primary-action' : 'quiet-button'} onClick={() => setTab('units')}>Individual units (VIN)</button>
          <button type="button" className={tab === 'parts' ? 'primary-action' : 'quiet-button'} onClick={() => setTab('parts')} style={{ marginLeft: '0.5rem' }}>Spare parts</button>
        </div>
      </div>
      {tab === 'parts' ? <VehicleMasterPage config={partsConfig} /> : <VehicleMasterPage config={{ ...unitConfig, renderInsights: (rows) => <UnitIntakePanel rows={rows} /> }} />}
    </div>
  );
} 