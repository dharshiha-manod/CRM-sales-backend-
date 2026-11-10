import { useEffect } from 'react';
import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useIndustryScope } from '../industry/useIndustryScope';
import { consumeVehicleDraft } from '../lib/vehicleDraftHandoff';
import './VehicleBookingStatus.css';

const STATUSES = ['Requested', 'Reserved', 'Confirmed', 'Allocation Pending', 'Vehicle Allocated', 'Converted to Order', 'Cancelled'];

// Signed-in user's sales-representative name, loaded once so the Add form can pre-fill it.
let currentRepName = '';
const pad = (n: number) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Open bookings that already hold a VIN (e.g. auto-allocated), so a client's OWN allocated vehicle stays selectable.
type HeldBooking = { vin: string; client_id?: string | null; lead_id?: string | null; client_name?: string | null; order_id?: string | null; model_id?: string | null; model_name?: string | null; dealer_id?: string | null; dealer_name?: string | null };
let heldBookings: HeldBooking[] = [];
// A vehicle already allocated to THIS client / lead / Core order stays selectable (other customers' vehicles stay hidden).
const isOwnHeldVin = (vin: unknown, f: Record<string, string>) =>
  heldBookings.some((b) => b.vin === vin && (
    (f.order_id && b.order_id === f.order_id) ||
    (f.client_id && b.client_id === f.client_id) || (f.lead_id && b.lead_id === f.lead_id) || (f.client_name && b.client_name === f.client_name)
  ));

const config: VehicleModuleConfig = {
  consumePendingDraft: () => consumeVehicleDraft('booking'),
  resource: '/vehicle/bookings',
  eyebrowModule: 'VEHICLE BOOKING',
  title: 'Vehicle booking / reservation',
  description: 'Reserve a vehicle or a specific VIN ahead of a sale. Confirming a booking reserves the VIN; cancelling releases it. Booking amounts post to the existing Core Collections module, and converting a booking creates/updates the existing Core Order — this module never keeps its own payment or order ledger.',
  icon: '▣',
  emptyIcon: '▣',
  codeField: 'booking_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  statusClassMap: {
    'requested': 'status-badge vb-requested',
    'reserved': 'status-badge vb-reserved',
    'confirmed': 'status-badge vb-confirmed',
    'allocation pending': 'status-badge vb-allocation-pending',
    'vehicle allocated': 'status-badge vb-vehicle-allocated',
    'converted to order': 'status-badge vb-converted',
    'cancelled': 'status-badge vb-cancelled',
  },
  searchableKeys: ['booking_number', 'client_name', 'model_name', 'vin', 'dealer_name', 'sales_rep'],
  fields: [
    { key: 'booking_number', label: 'Booking number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'BK' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true,
      // Typed only for a walk-in; once a lead/client is linked the picker fills it, so it's hidden (still saved).
      visibleIf: (f) => !f.lead_id && !f.client_id },
    { key: 'client_id', label: 'Client (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/clients', lookupLabelKey: 'client_name', autoFillMap: { client_name: 'client_name' },
      visibleIf: (f) => !f.lead_id }, // hidden when a lead is already chosen (the client link is still saved)
    { key: 'lead_id', label: 'Lead (pick to link)', type: 'lookup', group: 'Link', lookupResource: '/leads', industryScoped: true, lookupLabelKey: 'company_name', autoFillMap: { client_name: 'company_name' },
      // Picking a lead also brings in the sales representative assigned to that lead.
      onLookupChange: (lead, setForm) => {
        const rep = (lead as { sales_representatives?: { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null } | null }).sales_representatives;
        const name = rep?.user_profiles?.display_name ?? rep?.employee_code;
        if (name) setForm((prev) => ({ ...prev, sales_rep: name }));
      },
    },
    {
      key: 'order_id', label: 'Core order', type: 'lookup', group: 'Link', lookupResource: '/orders', listColumn: true,
      helpText: 'Linked automatically to the client\'s open order on save',
      format: (_value, row) => String(row.order_number ?? '') || '—',
      // "SO-2026-3336 — Dharshiha": the client name shows beside the number, and only this client's orders are offered.
      lookupLabelKey: 'order_number', lookupSecondaryLabelKey: 'clients.client_name',
      lookupFilter: (o, f) => !f.client_id || !o.client_id || String(o.client_id) === f.client_id,
      autoFillMap: { order_number: 'order_number' },
      // Picking the Core order brings in the VIN already allocated to it (with its model and dealer). Another VIN can still be chosen afterwards.
      onLookupChange: (order, setForm) => {
        const held = heldBookings.find((b) => b.order_id === String(order.id) && b.vin);
        if (!held) return;
        setForm((prev) => {
          if (prev.vin) return prev; // never overwrite a VIN the user already picked
                  const next: Record<string, string> = { ...prev, vin: held.vin };
          if (held.model_id) { next.model_id = held.model_id; next.model_name = held.model_name ?? ''; }
          if (held.dealer_id) { next.dealer_id = held.dealer_id; next.dealer_name = held.dealer_name ?? ''; }
          return next;
        });
      },
    },
    { key: 'order_number', label: 'Order number (auto-filled)', type: 'text', readOnly: true, group: 'Link', visibleIf: () => false }, // shown in the Core order picker
    {
      key: 'model_id', label: 'Model / variant', type: 'lookup', listColumn: true,
      lookupResource: '/vehicle/models', lookupLabelKey: 'model_name', autoFillMap: { model_name: 'model_name' },
      format: (_value, row) => String(row.model_name ?? '') || '—', // list shows the name, not the stored id
    },
    { key: 'model_name', label: 'Model (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle', visibleIf: () => false }, // shown once, in 'Model / variant'
    {
      key: 'vin', label: 'Specific VIN (if selected)', type: 'lookup', group: 'Vehicle',
      listColumn: true, helpText: 'Auto-allocated (oldest available unit of the model) when the booking is Confirmed',
      lookupResource: '/vehicle/units', lookupLabelKey: 'vin', lookupSecondaryLabelKey: 'model_name',
      // Vehicles still free to book, plus the vehicle already held for THIS client (e.g. auto-allocated to their booking),
      // limited to the chosen model. Vehicles held for other customers stay hidden.
      lookupFilter: (o, f) =>
        (String(o.status ?? '') === 'Available' || isOwnHeldVin(o.vin, f)) && (!f.model_id || !o.model_id || String(o.model_id) === f.model_id),
      autoFillMap: { model_id: 'model_id', model_name: 'model_name', dealer_id: 'dealer_id', dealer_name: 'dealer_name' },
    },
    {
           key: 'dealer_id', label: 'Dealer', type: 'lookup', listColumn: true, group: 'Vehicle',
      lookupResource: '/vehicle/dealers', lookupLabelKey: 'dealer_name', autoFillMap: { dealer_name: 'dealer_name' },
      lookupFilter: (option) => option.dealer_type === 'Branch', helpText: 'Your own branch / showroom only',
      visibleIf: (f) => !f.vin, // when a VIN is picked, its dealer fills in automatically
    },
    { key: 'dealer_name', label: 'Dealer (auto-filled)', type: 'text', readOnly: true, group: 'Vehicle' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', group: 'Schedule', defaultValue: () => currentRepName },
    { key: 'booking_date', label: 'Booking date', type: 'date', group: 'Schedule', defaultValue: todayISO },
    { key: 'expected_delivery_date', label: 'Expected delivery date', type: 'date', listColumn: true, group: 'Schedule' },
    { key: 'booking_amount', label: 'Booking amount', type: 'number', listColumn: true, group: 'Payment' },
    { key: 'payment_reference', label: 'Payment reference (Core Collections)', type: 'text', group: 'Payment' },
    {
      // Pick from the Active schemes that fit the chosen model and today's date (no typing, so no spelling mistakes).
      key: 'scheme_name', label: 'Scheme applied', type: 'lookup', group: 'Payment',
      lookupResource: '/vehicle/schemes', lookupLabelKey: 'scheme_name', lookupSecondaryLabelKey: 'discount_value',
      lookupFilter: (o, f) => {
        const today = todayISO();
        return String(o.status ?? '') === 'Active'
          && (!f.model_id || !o.model_id || String(o.model_id) === f.model_id)
          && (!o.start_date || String(o.start_date) <= today)
          && (!o.end_date || String(o.end_date) >= today);
      },
      helpText: 'Only Active schemes valid today for this model',
    },
    {
      // Pick this client's exchange request; the system then links the new VIN and order to it.
      key: 'exchange_reference', label: 'Exchange reference', type: 'lookup', group: 'Payment',
      lookupResource: '/vehicle/exchanges', lookupValueKey: 'exchange_id', lookupLabelKey: 'exchange_id', lookupSecondaryLabelKey: 'client_name',
      lookupFilter: (o, f) => String(o.status ?? '') !== 'Rejected'
        && ((!f.client_id && !f.client_name) || Boolean(f.client_id && o.client_id === f.client_id) || Boolean(f.client_name && o.client_name === f.client_name)),
      helpText: 'Only this client\'s exchange requests',
    },
    { key: 'finance_required', label: 'Finance required', type: 'select', options: ['Yes', 'No'], group: 'Payment', defaultValue: () => 'No' },
    { key: 'insurance_source', label: 'Insurance', type: 'select', options: ['Dealer arranged', "Customer's own", 'Not required'], group: 'Payment', defaultValue: () => 'Not required', helpText: 'Dealer arranged: an Insurance file opens by itself once the vehicle is allocated, ready for the quote. Customer\u2019s own: the policy copy is collected before handover.' },
    { key: 'cancellation_reason', label: 'Cancellation reason', type: 'textarea', group: 'Status' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Status' },
    // New bookings start Confirmed, which makes the system link the Core order, pick the VIN and open the delivery file by itself.
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Status', defaultValue: () => 'Confirmed' },
  ],
  kpis: [
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Total bookings', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Pending allocation', value: (r) => String(r.filter((x) => x.status === 'Allocation Pending' || x.status === 'Reserved').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Converted to order', value: (r) => String(r.filter((x) => x.status === 'Converted to Order').length) },
     { icon: '₹', iconClass: 'kpi-icon-school', label: 'Booking amount collected', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.booking_amount) || 0), 0).toLocaleString()}` },
  ],
  sampleRecords: [],
};

export function VehicleBookingPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  useEffect(() => {
    let cancelled = false;
    const q = activeIndustryTypeId ? `?industryTypeId=${encodeURIComponent(activeIndustryTypeId)}` : '';
    api<{ data: (HeldBooking & { status?: string | null })[] }>(`/vehicle/bookings${q}`)
      .then((res) => { if (!cancelled) heldBookings = (res.data ?? []).filter((b) => b.vin && b.status !== 'Cancelled'); })
      .catch(() => { /* the list then simply shows Available vehicles only */ });
    return () => { cancelled = true; };
  }, [activeIndustryTypeId]);
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