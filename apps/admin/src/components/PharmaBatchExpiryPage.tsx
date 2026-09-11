import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

// Auto-expiry classification thresholds (days remaining):
// <0 Expired · 0-30 Critical Expiry · 31-90 Expiring Soon · >90 Valid
const STATUSES = ['Valid', 'Expiring Soon', 'Critical Expiry', 'Expired'];

function daysToExpiry(expiryDate: unknown): number | null {
  if (!expiryDate) return null;
  return Math.floor((new Date(expiryDate as string).getTime() - Date.now()) / 86400000);
}

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
  fields: [
    { key: 'batch_number', label: 'Batch number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'BAT' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
    { key: 'product_code', label: 'Product code', type: 'text', listColumn: true },
    { key: 'manufacture_date', label: 'Manufacture date', type: 'date', listColumn: true, group: 'Batch details' },
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
    { key: 'quantity', label: 'Available quantity', type: 'number', group: 'Batch details' },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Batch details', placeholder: 'e.g. strips, vials, boxes' },
    { key: 'supplier', label: 'Supplier', type: 'text', group: 'Batch details' },
    { key: 'sales_rep', label: 'Sales rep allocation', type: 'text', group: 'Batch details' },
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
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return d !== null && d >= 0 && d <= 30; }).length),
    },
    {
      icon: '◷',
      iconClass: 'kpi-icon-amber',
      label: 'Expiring within 60 days',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return d !== null && d >= 0 && d <= 60; }).length),
    },
    {
      icon: '⊘',
      iconClass: 'kpi-icon-red',
      label: 'Expired',
      value: (r) => String(r.filter((x) => { const d = daysToExpiry(x.expiry_date); return d !== null && d < 0; }).length),
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