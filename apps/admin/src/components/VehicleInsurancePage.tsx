import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { api } from '../lib/api';
import { consumeVehicleDraft } from '../lib/vehicleDraftHandoff';

const has = (v: unknown) => v !== null && v !== undefined && v !== '';
// Boxes that matter only once a cover note / policy exists (a blank status counts as a policy being entered directly).
const COVERED = ['Cover Note Issued', 'Active', 'Expiring Soon', 'Expired'];
const policyIssued = (form: Record<string, string>) => !form.status || COVERED.includes(form.status);

const STATUSES = ['Requested', 'Quoted', 'Customer Accepted', 'Cover Note Issued', 'Active', 'Expiring Soon', 'Expired', 'Cancelled'];
const IN_PROGRESS = ['Requested', 'Quoted', 'Customer Accepted', 'Cover Note Issued'];

// Common motor insurers. Provider is a pick-or-type box, so any other company can still be typed.
const PROVIDERS = [
  'ICICI Lombard', 'HDFC ERGO', 'Bajaj Allianz', 'TATA AIG', 'New India Assurance', 'United India Insurance',
  'National Insurance', 'Oriental Insurance', 'Reliance General', 'SBI General', 'Digit Insurance', 'Acko',
  'Royal Sundaram', 'Cholamandalam MS', 'Zuno (Edelweiss)', 'IFFCO Tokio', 'Liberty General', 'Future Generali',
];

// Picking the client narrows the VIN list to that client's vehicles (their live bookings / deliveries); a single vehicle fills itself.
let clientVehicles: { clientId: string; vins: string[]; done: boolean } = { clientId: '', vins: [], done: false };

const config: VehicleModuleConfig = {
  consumePendingDraft: () => consumeVehicleDraft('insurance'),
  resource: '/vehicle/insurance-policies',
  eyebrowModule: 'INSURANCE',
  title: 'Vehicle insurance',
  description: 'Insurance for each vehicle, arranged before delivery: request, quote, cover note, then the active policy.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'policy_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['policy_number', 'client_name', 'provider', 'vin'],
  fields: [
    { key: 'policy_number', label: 'Policy number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'INS' },
    { key: 'vin', label: 'VIN', type: 'lookup', listColumn: true, labelSuffix: (form) => (form.client_id && clientVehicles.done && clientVehicles.clientId === form.client_id ? (clientVehicles.vins.length === 0 ? ' - no vehicle found on this client\u2019s bookings / deliveries' : clientVehicles.vins.length > 1 ? ` - ${clientVehicles.vins.length} vehicles for this client, pick one` : '') : ''), group: 'Vehicle', lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupFilter: (unit, form) => !form.client_id || clientVehicles.clientId !== form.client_id || clientVehicles.vins.length === 0 || clientVehicles.vins.includes(String(unit.vin)), lookupSecondaryLabelKey: 'model_name', lookupValueKey: 'vin',
      onLookupChange: (unit, setForm) => {
        void api<{ data: Record<string, unknown>[] }>('/vehicle/deliveries').then((res) => {
          const d = (res.data ?? []).filter((x) => x.vin === unit.vin && x.status !== 'Cancelled').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          if (!d) return;
          setForm((prev) => ({ ...prev, ...(d.client_id && !prev.client_id ? { client_id: String(d.client_id) } : {}), ...(d.client_name && !prev.client_name ? { client_name: String(d.client_name) } : {}) }));
        }).catch(() => { /* the owner is still filled in when the policy is saved */ });
      } },
    { key: 'client_id', label: 'Client', type: 'lookup', group: 'Vehicle', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' },
      onLookupChange: (client, setForm) => {
        const clientId = String(client.id ?? ''), clientName = String(client.client_name ?? '');
        clientVehicles = { clientId, vins: [], done: false };
        const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
        const mine = (x: Record<string, unknown>) => x.status !== 'Cancelled' && has(x.vin) && ((has(x.client_id) && String(x.client_id) === clientId) || (clientName !== '' && norm(x.client_name) === norm(clientName)));
        void Promise.all([
          api<{ data: Record<string, unknown>[] }>('/vehicle/deliveries').catch(() => ({ data: [] as Record<string, unknown>[] })),
          api<{ data: Record<string, unknown>[] }>('/vehicle/bookings').catch(() => ({ data: [] as Record<string, unknown>[] })),
        ]).then(([dl, bk]) => {
          // a vehicle counts only through a live booking: a delivery that belongs to a cancelled booking is ignored
          const cancelled = new Set((bk.data ?? []).filter((b) => b.status === 'Cancelled').map((b) => String(b.booking_number)));
          const live = new Set((bk.data ?? []).filter((b) => b.status !== 'Cancelled').map((b) => String(b.booking_number)));
          const deliveries = (dl.data ?? []).filter((d) => !has(d.booking_number) || (!cancelled.has(String(d.booking_number)) && (live.size === 0 || live.has(String(d.booking_number)))));
          const rows = [...deliveries, ...(bk.data ?? [])].filter(mine).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
          const vins = [...new Set(rows.map((x) => String(x.vin)))];
          clientVehicles = { clientId, vins, done: true };
          const row = vins.length === 1 ? (rows.find((x) => has(x.booking_number)) ?? rows[0]) : null;
          // always update the form once, so the note beside the VIN label refreshes
          setForm((prev) => ({ ...prev, ...(row ? { vin: vins[0], ...(row.booking_number && !prev.booking_number ? { booking_number: String(row.booking_number) } : {}) } : {}) }));
        });
      } },
    { key: 'client_name', label: 'Client name', type: 'text', listColumn: true, group: 'Vehicle', visibleIf: (form) => !form.client_id && has(form.client_name) }, // filled by itself from the client / vehicle owner; shown only when it cannot be linked
    { key: 'booking_number', label: 'Booking', type: 'text', readOnly: true, listColumn: true, group: 'Vehicle', visibleIf: (form) => has(form.booking_number) },
    { key: 'insurance_source', label: 'Insurance source', type: 'select', options: ['Dealer arranged', "Customer's own"], group: 'Policy', required: true, defaultValue: () => 'Dealer arranged', helpText: "Dealer arranged: the showroom gets the quote and the insurer issues the cover note (Requested > Quoted > Customer Accepted > Cover Note Issued > Active). Customer's own: the customer already bought cover elsewhere; collect the policy copy and set Active." },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Policy', helpText: "Customer's own skips Quoted, Customer Accepted and Cover Note Issued: Requested (copy awaited) > Active." },
      { key: 'provider', label: 'Provider', type: 'combo', comboOptions: PROVIDERS, placeholder: 'Pick the insurer or type its name', listColumn: true, group: 'Policy' },
    { key: 'policy_type', label: 'Policy type', type: 'select', options: ['Comprehensive', 'Third Party', 'Zero Depreciation'], group: 'Policy', defaultValue: () => 'Comprehensive' },
    { key: 'premium', label: 'Premium', type: 'number', group: 'Policy', visibleIf: (form) => form.insurance_source !== "Customer's own", helpText: 'The amount in the insurer\u2019s quote, paid through the showroom.' }, // a customer's own policy is paid by the customer to their insurer
    { key: 'coverage', label: 'Coverage / scheme offer', type: 'textarea', listColumn: true, group: 'Policy', format: (v, row) => { const m = /^(.*?) \(scheme: (.*?)\)/.exec(String(v ?? '')); return m ? `${m[1]} \u00b7 ${m[2]}` : (String(row.policy_type ?? '') || '\u2014'); }, visibleIf: (form) => String(form.coverage ?? '').includes('(scheme:') }, // otherwise filled by itself from the policy type; shown only when a scheme's free insurance is on this policy
    { key: 'start_date', label: 'Start date', type: 'date', group: 'Validity', visibleIf: policyIssued },
    { key: 'expiry_date', label: 'Expiry date', type: 'date', listColumn: true, group: 'Validity', visibleIf: policyIssued },
    { key: 'policy_document_reference', label: 'Insurer policy / cover note no.', type: 'text', group: 'Validity', visibleIf: policyIssued, helpText: "Dealer arranged: the number on the insurer's cover note / policy. Customer's own: the policy number from the copy the customer gave." }, // the insurer's own number, once there is a cover note or policy
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total policies', value: (r) => String(r.length) },
    { icon: '◔', iconClass: 'kpi-icon-ink', label: 'In progress (quote / cover note)', value: (r) => String(r.filter((x) => IN_PROGRESS.includes(String(x.status))).length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
      { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Expiring / expired', value: (r) => String(r.filter((x) => x.status === 'Expiring Soon' || x.status === 'Expired').length) },
  ],
  sampleRecords: [],
};

export function VehicleInsurancePage() {
  return <VehicleMasterPage config={config} />;
}