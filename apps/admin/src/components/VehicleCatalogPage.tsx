import { useState } from 'react';
import { VehicleMasterPage, VehicleModuleConfig, VehicleRecord } from './VehicleMasterPage';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

/**
 * A vehicle model/variant is not the same record as an individual vehicle
 * unit (each has its own VIN and lifecycle) — so this extends the existing
 * Core Products module with two linked, config-driven views instead of a
 * second generic product master: "Model / variant" catalog entries, and
 * the "Individual units" that reference a model by VIN.
 */

const VEHICLE_TYPES = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Pickup', 'Commercial Vehicle', 'Two Wheeler', 'Electric Vehicle', 'Other'];
const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'];
const TRANSMISSIONS = ['Manual', 'Automatic', 'AMT', 'CVT'];
const CONDITION = ['New', 'Used'];
const MODEL_STATUSES = ['Active', 'Discontinued', 'Upcoming'];

const modelConfig: VehicleModuleConfig = {
  resource: '/vehicle/models',
  eyebrowModule: 'VEHICLE / PARTS CATALOG',
  title: 'Model / variant catalog',
  description: 'Vehicle make, model and variant master data — extends the existing Core Products module rather than duplicating it.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'model_code',
  nameField: 'model_name',
  statusOptions: MODEL_STATUSES,
  searchableKeys: ['model_code', 'model_name', 'make', 'brand', 'variant'],
  fields: [
    { key: 'model_code', label: 'Model code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'MDL' },
    { key: 'make', label: 'Make', type: 'text', required: true, listColumn: true },
    { key: 'brand', label: 'Brand', type: 'text' },
    { key: 'model_name', label: 'Model', type: 'text', required: true, listColumn: true },
    { key: 'variant', label: 'Variant', type: 'text', listColumn: true },
    { key: 'vehicle_type', label: 'Vehicle type', type: 'select', options: VEHICLE_TYPES, listColumn: true, group: 'Specification' },
    { key: 'model_year', label: 'Model year', type: 'number', group: 'Specification' },
    { key: 'fuel_type', label: 'Fuel type', type: 'select', options: FUEL_TYPES, group: 'Specification' },
    { key: 'transmission', label: 'Transmission', type: 'select', options: TRANSMISSIONS, group: 'Specification' },
    { key: 'engine_type', label: 'Engine type', type: 'text', group: 'Specification' },
    { key: 'engine_capacity', label: 'Engine capacity (cc)', type: 'number', group: 'Specification' },
    { key: 'seating_capacity', label: 'Seating capacity', type: 'number', group: 'Specification' },
    { key: 'body_type', label: 'Body type', type: 'text', group: 'Specification' },
    { key: 'vehicle_category', label: 'Vehicle category', type: 'text', group: 'Specification' },
    { key: 'condition', label: 'New / Used', type: 'select', options: CONDITION, group: 'Pricing' },
    { key: 'ex_showroom_price', label: 'Ex-showroom price', type: 'number', listColumn: true, group: 'Pricing' },
    { key: 'recommended_selling_price', label: 'Recommended selling price', type: 'number', group: 'Pricing' },
    { key: 'warranty', label: 'Standard warranty', type: 'text', group: 'Ownership' },
    { key: 'service_interval', label: 'Service interval', type: 'text', group: 'Ownership' },
    { key: 'status', label: 'Model status', type: 'select', options: MODEL_STATUSES, listColumn: true, group: 'Ownership' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Model / variants', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Upcoming', value: (r) => String(r.filter((x) => x.status === 'Upcoming').length) },
  ],
  sampleRecords: [],
};

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
  searchableKeys: ['vin', 'engine_number', 'registration_number', 'model_name', 'dealer_name'],
  fields: [
    { key: 'vin', label: 'VIN / Chassis number', type: 'text', required: true, listColumn: true },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name',
      autoFillMap: { model_name: 'model_name', variant: 'variant' },
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'variant', label: 'Variant (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'color', label: 'Colour', type: 'text', group: 'Vehicle' },
    { key: 'engine_number', label: 'Engine number', type: 'text', group: 'Vehicle' },
    { key: 'registration_number', label: 'Registration number', type: 'text', group: 'Vehicle' },
    { key: 'manufacturing_date', label: 'Manufacturing date', type: 'date', group: 'Vehicle' },
    { key: 'odometer', label: 'Odometer', type: 'number', group: 'Vehicle' },
    {
      key: 'dealer_id', label: 'Dealer', type: 'lookup', listColumn: true, group: 'Location',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name',
      autoFillMap: { dealer_name: 'dealer_name' },
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Location' },
    { key: 'current_location', label: 'Current location', type: 'text', group: 'Location' },
    { key: 'purchase_cost', label: 'Purchase cost', type: 'number', group: 'Pricing' },
    { key: 'selling_price', label: 'Selling price', type: 'number', group: 'Pricing' },
    { key: 'status', label: 'Vehicle status', type: 'select', options: UNIT_STATUSES, listColumn: true, group: 'Pricing' },
  ],
  kpis: [
    { icon: '▥', iconClass: 'kpi-icon-ink', label: 'Total units', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Available', value: (r) => String(r.filter((x) => x.status === 'Available').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Booked / reserved', value: (r) => String(r.filter((x) => x.status === 'Booked' || x.status === 'Reserved').length) },
    { icon: '↗', iconClass: 'kpi-icon-school', label: 'Sold / delivered', value: (r) => String(r.filter((x) => x.status === 'Sold' || x.status === 'Delivered').length) },
  ],
  sampleRecords: [],
};

// Stock intake: paste VINs to add many units at once, and mark a whole PDI batch as passed.
function UnitIntakePanel({ rows }: { rows: VehicleRecord[] }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const q = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
  const waiting = rows.filter((r) => (r.status === 'Received' || r.status === 'PDI Pending') && typeof r.vin === 'string' && !String(r.id).startsWith('demo-'));

  async function passPdi() {
    setBusy(true); setMsg('');
    try {
      const res = await api<{ data: { passed: number } }>(`/vehicle/units/pdi-pass${q}`, { method: 'POST', body: JSON.stringify({ vins: waiting.map((r) => r.vin) }) });
      setMsg(`${res.data.passed} unit(s) are now Available; waiting bookings were allocated.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not mark PDI passed'); } finally { setBusy(false); }
  }

  async function importUnits() {
    setBusy(true); setMsg('');
    try {
      const models = (await api<{ data: Record<string, unknown>[] }>(`/vehicle/models${q}`)).data;
      const byCode = new Map(models.map((m) => [String(m.model_code).toLowerCase(), m.id]));
      const units: Record<string, unknown>[] = [];
      const bad: string[] = [];
      text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
        const [vin, code, color, engine, cost, price] = line.split(/[,\t]/).map((x) => x.trim());
        const modelId = byCode.get((code ?? '').toLowerCase());
        if (!vin || !modelId) { bad.push(`Line ${i + 1}: ${!vin ? 'missing VIN' : `unknown model code "${code ?? ''}"`}`); return; }
        units.push({ vin, model_id: modelId, color, engine_number: engine, purchase_cost: cost, selling_price: price });
      });
      if (!units.length) { setMsg(bad.join(' | ') || 'Nothing to import.'); return; }
      const res = await api<{ data: { created: number; errors: { row: number; vin: string; error: string }[] } }>(`/vehicle/units/bulk${q}`, { method: 'POST', body: JSON.stringify({ units }) });
      const failed = [...bad, ...res.data.errors.map((e) => `${e.vin || `row ${e.row}`}: ${e.error}`)];
      setMsg(`${res.data.created} unit(s) added as PDI Pending.${failed.length ? ` Not added: ${failed.join(' | ')}` : ''}`);
      if (res.data.created) setTimeout(() => window.location.reload(), 2500);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Import failed'); } finally { setBusy(false); }
  }

  return (
    <div className="master-toolbar" style={{ display: 'block', marginBottom: '0.75rem' }}>
      <button type="button" className="quiet-button" onClick={() => setOpen(!open)}>{open ? 'Hide stock intake' : 'Stock intake (bulk add / PDI)'}</button>
      <button type="button" className="primary-action" style={{ marginLeft: '0.5rem' }} disabled={busy || !waiting.length} onClick={passPdi}>PDI passed for all waiting ({waiting.length})</button>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.4rem' }}>One unit per line: <code>VIN, model code, colour, engine number, purchase cost, selling price</code> (only VIN and model code are required).</p>
          <textarea rows={6} style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="primary-action" disabled={busy || !text.trim()} onClick={importUnits}>Add units</button>
        </div>
      )}
      {msg && <p style={{ margin: '0.5rem 0 0' }}>{msg}</p>}
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