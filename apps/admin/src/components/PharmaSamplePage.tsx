import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';
import { daysLeft } from '../lib/batchExpiry';
import { fillRepFromClient, hospitalField, repField } from './pharmaLookups';
const STATUSES = ['Available', 'Assigned', 'Taken for visit', 'Distributed', 'Acknowledged', 'Returned'];
const SAMPLE_TYPES = ['Physician sample', 'Trial pack', 'Promotional sample'];
const PURPOSES = ['New product introduction', 'Product detailing', 'Doctor request', 'Trial for patients', 'Prescription switch follow-up', 'Clinical evaluation', 'CME / conference', 'Hospital formulary / tender', 'Other'];

const config: PharmaModuleConfig = {
  resource: '/pharma/samples',
  eyebrowModule: 'SAMPLE MANAGEMENT',
  title: 'Sample management',
  description: 'Track medical samples handed to doctors and hospitals — what went out, to whom, and when, with remaining quantity as it\u2019s distributed.',
  icon: '💊',
  emptyIcon: '💊',
  codeField: 'sample_code',
  nameField: 'product_name',
   statusOptions: STATUSES,
  inlineStatus: true,
  searchableKeys: ['sample_code', 'product_name', 'product_code', 'doctor_name', 'hospital_name', 'sales_rep'],
  fields: [
    { key: 'sample_code', label: 'Sample code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SMP' },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true, readOnly: true, placeholder: 'Fills in when you pick the batch' },
    { key: 'product_code', label: 'Product code', type: 'text', listColumn: true, readOnly: true },
    { key: 'sample_type', label: 'Sample type', type: 'select', options: SAMPLE_TYPES, group: 'Distribution details' },
    { key: 'batch_number', label: 'Batch number', type: 'lookup', required: true, lookupResource: '/pharma/batches', lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'batch_number', autoFillMap: { product_name: 'product_name', product_code: 'product_code', expiry_date: 'expiry_date' }, lookupFilter: (b, form) => (!['Expired', 'Recalled', 'Quarantined'].includes(String(b.status)) && Number(b.quantity) > 0) || String(b.batch_number) === form.batch_number, helpText: 'Only batches that can be issued are listed, earliest expiry first.', group: 'Distribution details' },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', readOnly: true, group: 'Distribution details' },
    { key: 'quantity_issued', label: 'Quantity issued', type: 'number', min: 1, listColumn: true, group: 'Distribution details' },
    { key: 'quantity_remaining', label: 'Quantity remaining', type: 'number', min: 0, helpText: 'Leave blank to start equal to quantity issued.', listColumn: true, group: 'Distribution details' },
    repField('sales_rep', 'Sales representative', { listColumn: true, group: 'Distribution details' }),
    { key: 'doctor_name', label: 'Doctor / HCP', type: 'text', listColumn: true, group: 'Distribution details' },    hospitalField('hospital_name', 'Hospital / clinic', { listColumn: true, group: 'Distribution details', autoFillMap: { city: 'location' }, onLookupChange: fillRepFromClient('sales_rep', 'doctor_name') }),
    { key: 'location', label: 'Location', type: 'text', group: 'Distribution details' },
    { key: 'visit_reference', label: 'Visit reference', type: 'text', group: 'Distribution details' },
    { key: 'purpose', label: 'Purpose of sample', type: 'combo', comboOptions: PURPOSES, placeholder: 'Pick from the list or type your own', group: 'Distribution details' },
    { key: 'issue_date', label: 'Issue date', type: 'date', group: 'Distribution details' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, group: 'Distribution details' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Distribution details' },
  ],
  kpis: [
    { icon: '💊', iconClass: 'kpi-icon-ink', label: 'Samples logged', value: (r) => String(r.length) },
    { icon: '↗', iconClass: 'kpi-icon-green', label: 'Distributed', value: (r) => String(r.filter((x) => x.status === 'Distributed' || x.status === 'Acknowledged').length) },
    {
      icon: '⚠',
      iconClass: 'kpi-icon-amber',
      label: 'Expiring samples',
      value: (r) => String(r.filter((x) => {
        if (!x.expiry_date) return false;
        const days = daysLeft(String(x.expiry_date));
        return days >= 0 && days <= 30;
      }).length),
    },
    { icon: '↩', iconClass: 'kpi-icon-red', label: 'Returned', value: (r) => String(r.filter((x) => x.status === 'Returned').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-sample-1', sample_code: 'SMP-2026-441', product_name: 'Cardivas 6.25mg', product_code: 'CRD-625', sample_type: 'Physician sample',
      batch_number: 'BAT-2026-0177', expiry_date: '2027-02-28', quantity_issued: 50, quantity_remaining: 12, sales_rep: 'Vikram Nair',
      doctor_name: 'Dr. S. Krishnan', hospital_name: 'Apollo Hospitals', location: 'Chennai', visit_reference: 'VIS-2026-889',
      purpose: 'New launch introduction', issue_date: '2026-06-10', status: 'Distributed', notes: '',
    },
    {
      id: 'demo-sample-2', sample_code: 'SMP-2026-455', product_name: 'Pantocid DSR', product_code: 'PTC-DSR', sample_type: 'Trial pack',
      batch_number: 'BAT-2026-0182', expiry_date: '2026-09-30', quantity_issued: 20, quantity_remaining: 20, sales_rep: 'Divya Suresh',
      doctor_name: 'Dr. R. Iyer', hospital_name: 'Kauvery Hospital', location: 'Coimbatore', visit_reference: 'VIS-2026-901',
      purpose: 'Follow-up on prescription switch', issue_date: '2026-08-25', status: 'Assigned', notes: 'Expiring soon — prioritise for next visit.',
    },
  ],
};

export function PharmaSamplePage() {
  return <PharmaMasterPage config={config} />;
}