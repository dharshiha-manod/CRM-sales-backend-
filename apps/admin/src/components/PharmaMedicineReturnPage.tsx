import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

const REASONS = ['Expired', 'Near expiry', 'Damaged', 'Wrong product', 'Wrong quantity', 'Quality issue', 'Recall', 'Excess stock', 'Customer return', 'Other'];
const INSPECTION_STATUSES = ['Pending', 'Passed', 'Failed'];
const DISPOSITIONS = ['Saleable', 'Quarantine', 'Damaged', 'Expired', 'Disposal'];
// Note: returned quantity does NOT automatically become saleable stock —
// disposition below drives what happens to it (see backend rule when wired up).
const STATUSES = ['Requested', 'Received', 'Verified', 'Under inspection', 'Approved', 'Rejected', 'Closed'];

const config: PharmaModuleConfig = {
  resource: '/pharma/medicine-returns',
  eyebrowModule: 'MEDICINE RETURN MANAGEMENT',
  title: 'Medicine return management',
  description: 'Track medicines returned from hospitals, pharmacies, distributors or the field — through inspection to a final disposition. Returned stock is never automatically saleable.',
  icon: '↩',
  emptyIcon: '↩',
  codeField: 'return_code',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['return_code', 'product_name', 'customer_hospital', 'invoice_reference', 'sales_rep'],
  fields: [
    { key: 'return_code', label: 'Return number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'RET' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
{ key: 'batch_number', label: 'Batch number', type: 'lookup', lookupResource: '/pharma/batches', lookupLabelKey: 'product_name', autoFillMap: { product_name: 'product_name' }, listColumn: true },
    { key: 'quantity', label: 'Quantity', type: 'number', listColumn: true },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Return details' },
    { key: 'customer_hospital', label: 'Customer / hospital / distributor', type: 'text', listColumn: true, group: 'Return details' },
    { key: 'invoice_reference', label: 'Invoice / order reference', type: 'text', group: 'Return details' },
    { key: 'sales_rep', label: 'Sales rep', type: 'text', group: 'Return details' },
    { key: 'warehouse', label: 'Warehouse', type: 'text', group: 'Return details' },
    { key: 'reason', label: 'Return reason', type: 'select', options: REASONS, group: 'Return details' },
    { key: 'return_date', label: 'Return date', type: 'date', group: 'Return details' },
    { key: 'inspection_status', label: 'Inspection status', type: 'select', options: INSPECTION_STATUSES, listColumn: true, group: 'Inspection & disposition' },
    { key: 'disposition', label: 'Disposition', type: 'select', options: DISPOSITIONS, listColumn: true, group: 'Inspection & disposition' },
    { key: 'status', label: 'Return status', type: 'select', options: STATUSES, group: 'Inspection & disposition' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Inspection & disposition' },
  ],
  kpis: [
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending returns', value: (r) => String(r.filter((x) => x.status === 'Requested' || x.status === 'Received' || x.status === 'Under inspection').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Approved', value: (r) => String(r.filter((x) => x.status === 'Approved').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Rejected', value: (r) => String(r.filter((x) => x.status === 'Rejected').length) },
    { icon: '↩', iconClass: 'kpi-icon-ink', label: 'Return quantity', value: (r) => String(r.reduce((sum, x) => sum + (Number(x.quantity) || 0), 0)) },
  ],
  sampleRecords: [
    {
      id: 'demo-return-1', return_code: 'RET-2026-089', product_name: 'Pantocid DSR', batch_number: 'BAT-2026-0182', quantity: 60,
      unit: 'boxes', customer_hospital: 'Kauvery Hospital', invoice_reference: 'INV-2026-3341', sales_rep: 'Divya Suresh',
      warehouse: 'Rack D-6', reason: 'Near expiry', return_date: '2026-08-28', inspection_status: 'Passed', disposition: 'Quarantine',
      status: 'Under inspection', notes: '',
    },
    {
      id: 'demo-return-2', return_code: 'RET-2026-081', product_name: 'Cardivas 6.25mg', batch_number: 'BAT-2026-0177', quantity: 15,
      unit: 'strips', customer_hospital: 'Apollo Hospitals', invoice_reference: 'INV-2026-3298', sales_rep: 'Vikram Nair',
      warehouse: 'Cold storage A-3', reason: 'Wrong quantity', return_date: '2026-07-14', inspection_status: 'Passed', disposition: 'Saleable',
      status: 'Approved', notes: 'Restocked to main inventory.',
    },
  ],
};

export function PharmaMedicineReturnPage() {
  return <PharmaMasterPage config={config} />;
}