import { useState } from 'react';
import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

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
  sampleRecords: [
    { id: 'demo-model-1', model_code: 'MDL-0001', make: 'Tata', brand: 'Tata Motors', model_name: 'Nexon', variant: 'XZ+ Petrol', vehicle_type: 'SUV', fuel_type: 'Petrol', ex_showroom_price: 950000, status: 'Active' },
    { id: 'demo-model-2', model_code: 'MDL-0002', make: 'Hyundai', brand: 'Hyundai', model_name: 'Creta', variant: 'SX(O) Diesel', vehicle_type: 'SUV', fuel_type: 'Diesel', ex_showroom_price: 1850000, status: 'Upcoming' },
  ],
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
  sampleRecords: [
    { id: 'demo-unit-1', vin: 'MA3ERLF1S00123456', model_name: 'Nexon', variant: 'XZ+ Petrol', dealer_name: 'City Motors', status: 'Available' },
    { id: 'demo-unit-2', vin: 'MA3FYEB1S00654321', model_name: 'Creta', variant: 'SX(O) Diesel', dealer_name: 'Highway Auto', status: 'Booked' },
  ],
};
export function VehicleCatalogPage() {
  const [tab, setTab] = useState<'models' | 'units'>('models');
  return (
    <div>
      <div className="master-toolbar" style={{ marginBottom: '0.75rem' }}>
        <div className="master-search">
          <button type="button" className={tab === 'models' ? 'primary-action' : 'quiet-button'} onClick={() => setTab('models')}>Model / variant</button>
          <button type="button" className={tab === 'units' ? 'primary-action' : 'quiet-button'} onClick={() => setTab('units')} style={{ marginLeft: '0.5rem' }}>Individual units (VIN)</button>
        </div>
      </div>
      {tab === 'models' ? <VehicleMasterPage config={modelConfig} /> : <VehicleMasterPage config={unitConfig} />}
    </div>
  );
}