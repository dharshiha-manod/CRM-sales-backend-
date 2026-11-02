import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';
import { addDaysIso, daysLeft } from '../lib/batchExpiry';
import { repField } from './pharmaLookups';
import { api } from '../lib/api';

// Expiry = manufacture date + the product's shelf life (days).
function expiryPatch(form: Record<string, string>): Record<string, string> | undefined {
  const days = Number(form.shelf_life_days);
  return form.manufacture_date && days > 0 ? { expiry_date: addDaysIso(form.manufacture_date, days) } : undefined;
}

// Auto-expiry classification thresholds (days remaining):
// <0 Expired · 0-30 Critical Expiry · 31-90 Expiring Soon · >90 Valid
const STATUSES = ['Valid', 'Expiring Soon', 'Critical Expiry', 'Expired', 'Quarantined', 'Recalled'];

// Whole calendar days, exactly like the server (UTC dates), so a batch that expires today reads 0 days (Critical), never Expired.
function daysToExpiry(expiryDate: unknown): number | null {
  if (!expiryDate) return null;
  return daysLeft(String(expiryDate));
}
// Only stock still on hand is a risk: the same rule the dashboard (Pharma insights) and the alerts use.
const onHand = (x: Record<string, unknown>) => Number(x.quantity) > 0;

// Expired / quarantined stock that is still on hand can be written off as waste (server logs it in the stock audit).
let reloadBatches: (() => void) | null = null;
const writeOff = async (r: Record<string, unknown>) => {
  if (!window.confirm(`Write off ${String(r.quantity)} unit(s) of ${String(r.product_name)} (${String(r.batch_number)}) as waste? This cannot be undone.`)) return;
  try {
    await api(`/pharma/batches/${String(r.id)}/write-off`, { method: 'POST', body: JSON.stringify({ reason: String(r.status) }) });
    reloadBatches?.();
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Could not write off this batch.');
  }
};

const config: PharmaModuleConfig = {
  resource: '/pharma/batches',
  eyebrowModule: 'BATCH & EXPIRY MANAGEMENT',
  title: 'Batch & expiry management',
  description: 'Every medicine batch on hand, with manufacture and expiry dates — the reference every sample, promotion, return and recall ties back to. FEFO: always issue the earliest-expiry batch first.',
  icon: '⏱',
  emptyIcon: '⏱',
  codeField: 'batch_number',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['batch_number', 'product_name', 'product_code', 'supplier'],
  registerReload: (reload) => { reloadBatches = reload; },
  rowActions: (r) => (
    Number(r.quantity) > 0 && ((daysToExpiry(r.expiry_date) ?? 1) < 0 || r.status === 'Quarantined') ? (
      <button
        type="button"
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: 4, whiteSpace: 'nowrap' }}
        onClick={() => void writeOff(r)}
      >
        🗑 Write off as waste
      </button>
    ) : null
  ),
  fields: [
    { key: 'batch_number', label: 'Batch number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'BAT' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
    { key: 'product_code', label: 'Product code', type: 'lookup', lookupResource: '/products', industryScoped: true, lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'product_code', autoFillMap: { product_name: 'product_name', unit: 'unit', supplier_name: 'supplier', shelf_life_days: 'shelf_life_days' }, onLookupChange: (_m, setForm) => setForm((prev) => ({ ...prev, ...(expiryPatch(prev) ?? {}) })), listColumn: true },
    { key: 'shelf_life_days', label: 'Shelf life (days)', type: 'number', readOnly: true, group: 'Batch details', helpText: 'From the product. Expiry = manufacture date + this.' },
    { key: 'manufacture_date', label: 'Manufacture date', type: 'date', listColumn: true, group: 'Batch details', onValueChange: (_v, form) => expiryPatch(form) },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', required: true, listColumn: true, group: 'Batch details' },
    {
      key: 'expiry_status',
      label: 'Expiry status',
      type: 'text',
      readOnly: true,
      listColumn: true,
      format: (_v, record) => {
        const days = daysToExpiry(record.expiry_date);
        if (days === null) return '—';
        if (days < 0) return 'Expired';
        if (days <= 30) return 'Critical Expiry';
        if (days <= 90) return 'Expiring Soon';
        return 'Valid';
      },
      group: 'Batch details',
    },
    { key: 'quantity', label: 'Available quantity', type: 'number', listColumn: true, min: 0, group: 'Batch details' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Batch details', placeholder: 'e.g. strips, vials, boxes' },

    repField('sales_rep', 'Sales rep allocation', { group: 'Batch details' }),
    { key: 'warehouse_location', label: 'Warehouse / location', type: 'text', group: 'Batch details', placeholder: 'e.g. Cold storage A-3' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, group: 'Batch details' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Batch details' },
  ],
  kpis: [
    { icon: '⏱', iconClass: 'kpi-icon-ink', label: 'Batches on file', value: (r) => String(r.length) },
    {
      icon: '◷',
      iconClass: 'kpi-icon-amber',
      label: 'Expiring within 30 days',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return onHand(x) && d !== null && d >= 0 && d <= 30; }).length),
    },
    {
      icon: '◷',
      iconClass: 'kpi-icon-amber',
      label: 'Expiring within 60 days',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return onHand(x) && d !== null && d >= 0 && d <= 60; }).length),
    },
    {
      icon: '⊘',
      iconClass: 'kpi-icon-red',
      label: 'Expired',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return onHand(x) && d !== null && d < 0; }).length),
    },
    {
      icon: '⚠',
      iconClass: 'kpi-icon-red',
      label: 'Quantity at risk (<30 days)',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return d !== null && d >= 0 && d <= 30; }).reduce((sum, x) => sum + (Number(x.quantity) || 0), 0)),
    },
  ],
  sampleRecords: [
    {
      id: 'demo-batch-1', batch_number: 'BAT-2026-0177', product_name: 'Cardivas 6.25mg', product_code: 'CRD-625',
      manufacture_date: '2025-11-01', expiry_date: '2027-02-28', quantity: 4200, unit: 'strips', supplier: 'Sun Pharma',
      sales_rep: 'Vikram Nair', warehouse_location: 'Cold storage A-3', status: 'Valid', notes: '',
    },
    {
      id: 'demo-batch-2', batch_number: 'BAT-2026-0182', product_name: 'Pantocid DSR', product_code: 'PTC-DSR',
      manufacture_date: '2025-06-15', expiry_date: '2026-09-30', quantity: 900, unit: 'boxes', supplier: 'Sun Pharma',
      sales_rep: 'Divya Suresh', warehouse_location: 'Rack D-6', status: 'Critical Expiry', notes: 'Push to sale before expiry — FEFO priority.',
    },
  ],
};

export function PharmaBatchExpiryPage() {
  return <PharmaMasterPage config={config} />;
}