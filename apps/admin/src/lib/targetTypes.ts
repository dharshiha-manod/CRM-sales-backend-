// Shared target-type definitions used by the Targets page and the
// Sales Representatives profile drawer, so both always agree.

export const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'sales_amount', label: 'Sales Amount' },
  { value: 'order_value', label: 'Order Value' },
  { value: 'order_count', label: 'Order Count' },
  { value: 'collection_amount', label: 'Collection Amount' },
  { value: 'visit_count', label: 'Visit Count' },
  { value: 'new_customers', label: 'New Customers' },
  { value: 'product_quantity', label: 'Product Quantity' },
  { value: 'doctor_visits', label: 'Doctor Visits' },
  { value: 'pharmacy_visits', label: 'Pharmacy Visits' },
  { value: 'order_quantity', label: 'Order Quantity' },
  { value: 'meter_quantity', label: 'Meter Quantity' },
  { value: 'client_visits', label: 'Client Visits' },
  { value: 'quantity_sold', label: 'Quantity Sold' },
  { value: 'admission_target', label: 'Admission Target' },
  { value: 'fee_collection', label: 'Fee Collection' },
  { value: 'institution_visits', label: 'Institution Visits' },
  { value: 'student_enrollment', label: 'Student Enrollment' },
  { value: 'followups', label: 'Follow-ups' },
];

export const CURRENCY_TYPES = new Set(['sales_amount', 'order_value', 'collection_amount', 'fee_collection']);
export const TARGET_TYPE_LABELS: Record<string, string> = Object.fromEntries(TARGET_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Which target types are valid for each industry (keys match IndustryKey).
export const COMMON_TARGET_TYPES = ['sales_amount', 'order_value', 'order_count', 'collection_amount', 'visit_count', 'new_customers', 'followups'];
export const INDUSTRY_TARGET_TYPES: Record<string, string[]> = {
  fmcg: [...COMMON_TARGET_TYPES, 'product_quantity', 'order_quantity'],
  pharma: [...COMMON_TARGET_TYPES, 'product_quantity', 'doctor_visits', 'pharmacy_visits'],
  school: [...COMMON_TARGET_TYPES, 'admission_target', 'fee_collection', 'institution_visits', 'student_enrollment'],
  textile: [...COMMON_TARGET_TYPES, 'order_quantity', 'meter_quantity', 'quantity_sold'],
  trading: [...COMMON_TARGET_TYPES, 'order_quantity', 'quantity_sold', 'client_visits'],
  vehicle: [...COMMON_TARGET_TYPES, 'quantity_sold', 'client_visits'],
};

export function targetTypesForIndustry(industryKey: string) {
  const allowed = new Set(INDUSTRY_TARGET_TYPES[industryKey] ?? COMMON_TARGET_TYPES);
  return TARGET_TYPE_OPTIONS.filter((o) => allowed.has(o.value));
}

export function formatTargetValue(value: number, type: string) {
  return CURRENCY_TYPES.has(type)
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(value || 0))
    : new Intl.NumberFormat('en-IN').format(Math.round(value || 0));
}

const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: isoLocal(start), end: isoLocal(end), label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

export function customPeriodLabel(start: string, end: string) {
  const fmt = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}