import { useEffect } from 'react';
import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { consumeVehicleDraft } from '../lib/vehicleDraftHandoff';

const FUEL_LEVELS = ['Full', '3/4', '1/2', '1/4', 'Reserve', 'Empty'];
const OUTCOMES = [
  'Interested, wants a quotation',
  'Interested, will book next week',
  'Needs a second drive with family',
  'Comparing with another brand',
  'Not interested (price too high)',
  'Other',
];
const STATUSES = ['Requested', 'Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'No Show'];

// Signed-in user's sales-representative name, loaded once so the Add form can pre-fill it.
let currentRepName = '';

const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowHHMM = (offsetMin = 0) => { const d = new Date(Date.now() + offsetMin * 60000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plusHour = (t: string) => { const [h, m] = t.split(':').map(Number); return `${pad((h + 1) % 24)}:${pad(m)}`; };

const config: VehicleModuleConfig = {
  consumePendingDraft: () => consumeVehicleDraft('test-drive'),
  resource: '/vehicle/test-drives',
  eyebrowModule: 'TEST DRIVE MANAGEMENT',
  title: 'Test drive management',
  description: 'Schedule and track test drives against a demo VIN. Completing a drive updates the linked Client/Lead and creates a Core follow-up automatically.',
  icon: '○',
  emptyIcon: '○',
  codeField: 'test_drive_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['test_drive_number', 'client_name', 'model_name', 'vin', 'sales_rep'],
  fields: [
    { key: 'test_drive_number', label: 'Test drive number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'TD' },
    { key: 'client_name', label: 'Lead / client', type: 'text', required: true, listColumn: true,
      // Name is typed only for a walk-in; once a lead/client is linked it is filled by the picker, so it's hidden (still saved).
      visibleIf: (f) => !f.lead_id && !f.client_id },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' },
      visibleIf: (f) => !f.lead_id }, // hidden when a lead is already chosen (the lead's client link is still saved)
    { key: 'lead_id', label: 'Lead (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/leads', industryScoped: true, lookupLabelKey: 'company_name', autoFillMap: { client_name: 'company_name' },
      // Picking a lead also brings in the sales representative assigned to that lead.
      onLookupChange: (lead, setForm) => {
        const rep = (lead as { sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null }).sales_representatives;
        const name = rep?.user_profiles?.display_name ?? rep?.employee_code;
        if (name) setForm((prev) => ({ ...prev, sales_rep: name }));
      },
    },
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
      // The list must show the model name, not the id the lookup stores.
      format: (_value, row) => String(row.model_name ?? '') || '—',
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle', visibleIf: () => false }, // shown once, in 'Model / variant' above
    {
      key: 'vin', label: 'VIN', type: 'lookup', group: 'Vehicle',
      lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupSecondaryLabelKey: 'model_name',
      // Offers vehicles that can actually be driven (not sold/delivered/damaged/in service), limited to the chosen
      // model when one is set. A dealer is NOT required (individual buyers drive showroom vehicles); when the
      // vehicle has a dealer it is filled in automatically, and the vehicle's last odometer becomes the start reading.
      lookupFilter: (option, f) =>
        !['Sold', 'Delivered', 'Damaged', 'Under Service'].includes(String(option.status ?? '')) &&
        (!f.model_id || !option.model_id || String(option.model_id) === f.model_id),
      autoFillMap: { model_id: 'model_id', model_name: 'model_name', dealer_id: 'dealer_id', dealer_name: 'dealer_name', odometer: 'odometer_start' },
    },
    {
         key: 'dealer_id', label: 'Dealer', type: 'lookup', group: 'Vehicle',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
      visibleIf: () => false, // dealer now comes from the selected VIN
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule', defaultValue: () => currentRepName },
    { key: 'drive_date', label: 'Date', type: 'date', listColumn: true, group: 'Schedule', defaultValue: todayISO },
    {
      key: 'start_time', label: 'Start time', type: 'time', group: 'Schedule', defaultValue: () => nowHHMM(),
      onValueChange: (value) => (/^\d{2}:\d{2}$/.test(value) ? { end_time: plusHour(value) } : undefined),
    },
    { key: 'end_time', label: 'End time', type: 'time', group: 'Schedule', defaultValue: () => nowHHMM(60) },
    { key: 'pickup_location', label: 'Pickup location', type: 'text', group: 'Schedule' },
    { key: 'return_location', label: 'Return location', type: 'text', group: 'Schedule' },
    { key: 'license_verified', label: 'Driving licence verified', type: 'select', options: ['Yes', 'No'], group: 'Vehicle condition' },
    { key: 'odometer_start', label: 'Odometer (start)', type: 'number', group: 'Vehicle condition' },
    { key: 'odometer_end', label: 'Odometer (end)', type: 'number', group: 'Vehicle condition' },
    { key: 'fuel_start', label: 'Fuel / battery (start)', type: 'combo', comboOptions: FUEL_LEVELS, placeholder: 'Pick or type, e.g. 80%', group: 'Vehicle condition' },
    { key: 'fuel_end', label: 'Fuel / battery (end)', type: 'combo', comboOptions: FUEL_LEVELS, placeholder: 'Pick or type, e.g. 72%', group: 'Vehicle condition' },
    { key: 'customer_feedback', label: 'Customer feedback', type: 'textarea', placeholder: 'What the customer said about the drive…', group: 'Outcome' },
    { key: 'outcome', label: 'Outcome', type: 'select', options: OUTCOMES, group: 'Outcome' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Outcome' },
  ],
  kpis: [
    { icon: '○', iconClass: 'kpi-icon-ink', label: 'Total test drives', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Scheduled / confirmed', value: (r) => String(r.filter((x) => x.status === 'Scheduled' || x.status === 'Confirmed').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Completed', value: (r) => String(r.filter((x) => x.status === 'Completed').length) },
        { icon: '⚠', iconClass: 'kpi-icon-red', label: 'No show / cancelled', value: (r) => String(r.filter((x) => x.status === 'No Show' || x.status === 'Cancelled').length) },
  ],
  sampleRecords: [],
};

export function VehicleTestDrivePage() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase!.auth.getSession();
        const uid = sessionData.session?.user.id;
        if (!uid) return;
        const res = await api<{ data: { user_id?: string | null; user_profiles?: { display_name?: string | null } | null }[] }>('/sales-representatives');
        const own = (res.data ?? []).find((r) => r.user_id === uid);
        if (!cancelled) currentRepName = own?.user_profiles?.display_name ?? '';
      } catch { /* leave blank — the field stays editable */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return <VehicleMasterPage config={config} />;
}