import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';
import { api } from '../lib/api';
import { fillRepFromClient, hospitalField, repField } from './pharmaLookups';

// Picking a return reason suggests the only safe disposition (never overwrites one already chosen).
const REASON_TO_DISPOSITION: Record<string, string> = { Expired: 'Expired', 'Near expiry': 'Quarantine', Damaged: 'Damaged', 'Quality issue': 'Quarantine', Recall: 'Quarantine' };
// Suggested "whose mistake" for clear-cut reasons only (the user can always change it). "Our side" = customer gets credit when approved.
const REASON_TO_FAULT: Record<string, string> = { 'Wrong product': 'Our side', 'Wrong quantity': 'Our side', 'Quality issue': 'Our side', Recall: 'Our side', 'Excess stock': 'Customer side', 'Customer return': 'Customer side' };

const REASONS = ['Expired', 'Near expiry', 'Damaged', 'Wrong product', 'Wrong quantity', 'Quality issue', 'Recall', 'Excess stock', 'Customer return', 'Other'];
const FAULT_SIDES = ['Our side', 'Customer side'];
const INSPECTION_STATUSES = ['Pending', 'Passed', 'Failed'];
const DISPOSITIONS = ['Saleable', 'Quarantine', 'Damaged', 'Expired', 'Disposal'];
// Note: returned quantity does NOT automatically become saleable stock —
// disposition below drives what happens to it (see backend rule when wired up).
const STATUSES = ['Requested', 'Received', 'Verified', 'Under inspection', 'Approved', 'Rejected', 'Closed'];

type OrderLineInfo = { product_name: string; sold: number; returned: number; can_return: number; batches?: string[] };
type OrderInfo = { order_number: string; client_name: string; rep_code?: string | null; lines: OrderLineInfo[] };
type SetForm = (updater: (prev: Record<string, string>) => Record<string, string>) => void;
type SetDyn = (key: string, options: { value: string; label: string }[]) => void;

// What the picked order sold, so choosing a product (or the client / order) can fill batch, unit, warehouse and quantity.
let orderLines: Record<string, OrderLineInfo> = {};
let batchInfo: Record<string, { unit?: string; warehouse?: string }> | null = null;
let pickToken = 0; // a newer pick cancels the answer of an older one

async function ensureBatchInfo() {
  if (batchInfo) return batchInfo;
  try {
    const res = await api<{ data: Array<{ batch_number?: string; unit?: string; warehouse?: string }> }>('/pharma/batches');
    batchInfo = {};
    (res.data ?? []).forEach((b) => { if (b.batch_number) batchInfo![b.batch_number] = { unit: b.unit, warehouse: b.warehouse }; });
  } catch { batchInfo = {}; }
  return batchInfo;
}
/** Fields that follow from one chosen product line: its single batch (+ unit / warehouse) and the full returnable quantity. */
function lineFill(line: OrderLineInfo | undefined, info: Record<string, { unit?: string; warehouse?: string }>): Record<string, string> {
  if (!line) return { batch_number: '', quantity: '' };
  const batch = line.batches?.length === 1 ? line.batches[0] : '';
  const extra = batch ? info[batch] : undefined;
  const out: Record<string, string> = { batch_number: batch, quantity: String(line.can_return) };
  if (extra?.unit) out.unit = extra.unit;
  if (extra?.warehouse) out.warehouse = extra.warehouse;
  return out;
}
/** Applies one order: product choices, and — when there is only one returnable product — product, batch, unit, warehouse and quantity too. */
async function applyOrder(order: OrderInfo, setForm: SetForm, setDyn: SetDyn, token: number) {
  const lines = (order.lines ?? []).filter((l) => l.can_return > 0);
  orderLines = Object.fromEntries(lines.map((l) => [l.product_name, l]));
  setDyn('order_products', lines.map((l) => ({ value: l.product_name, label: `${l.product_name} — can return ${l.can_return} of ${l.sold}` })));
  const info = await ensureBatchInfo();
  if (token !== pickToken) return;
  setForm((prev) => ({
    ...prev,
    invoice_reference: order.order_number,
    customer_hospital: order.client_name,
    ...(order.rep_code ? { sales_rep: order.rep_code } : {}),
    ...(lines.length === 1 ? { product_name: lines[0].product_name, ...lineFill(lines[0], info) } : { product_name: '', batch_number: '', quantity: '' }),
  }));
}

const config: PharmaModuleConfig = {
  resource: '/pharma/medicine-returns',
  eyebrowModule: 'MEDICINE RETURN MANAGEMENT',
  title: 'Medicine return management',
  description: 'Pick the customer, their order and the product — then track the return through inspection to a final disposition. Our-side mistakes give the customer credit on the Sales Order. Returned stock is never automatically saleable.',
  icon: '↩',
  emptyIcon: '↩',
  codeField: 'return_code',
  nameField: 'product_name',
  statusOptions: STATUSES,
  searchableKeys: ['return_code', 'product_name', 'customer_hospital', 'invoice_reference', 'sales_rep'],
  fields: [
    { key: 'return_code', label: 'Return number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'RET' },
    // 1. Customer first — changing it clears everything that depends on it.
    hospitalField('customer_hospital', 'Customer / hospital / distributor', {
      required: true,
      listColumn: true,
      // Picking the customer fills everything that belongs to that customer when there is only one choice.
      onLookupChange: (matched, setForm, setDynamicOptions) => {
        const token = ++pickToken;
        orderLines = {};
        setForm((prev) => ({ ...prev, invoice_reference: '', product_name: '', batch_number: '', quantity: '', unit: '', warehouse: '', sales_rep: '' }));
        setDynamicOptions('order_products', []);
        fillRepFromClient('sales_rep')(matched, setForm);
        api<{ data: OrderInfo[] }>('/pharma/order-lookup')
          .then((res) => {
            if (token !== pickToken) return;
            const mine = (res.data ?? []).filter((o) => o.client_name === matched.client_name && (o.lines ?? []).some((l) => l.can_return > 0));
            if (mine.length === 1) void applyOrder(mine[0], setForm, setDynamicOptions, token); // one order: take it; several: the user picks below
          })
          .catch(() => { /* the user can still pick the order by hand */ });
      },
    }),
    // 2. Only that customer's Sales Orders.
    {
      key: 'invoice_reference', label: 'Sales order', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/pharma/order-lookup', industryScoped: true,
      lookupValueKey: 'order_number', lookupLabelKey: 'order_number', lookupSecondaryLabelKey: 'client_name',
      lookupFilter: (o, form) => !form.customer_hospital || o.client_name === form.customer_hospital,
      autoFillMap: { client_name: 'customer_hospital', rep_code: 'sales_rep' },
      // Picking an order fills its product, batch, unit, warehouse, quantity and rep (product only when the order has several).
      onLookupChange: (matched, setForm, setDynamicOptions) => {
        const token = ++pickToken;
        setForm((prev) => ({ ...prev, product_name: '', batch_number: '', quantity: '' }));
        void applyOrder(matched as unknown as OrderInfo, setForm, setDynamicOptions, token);
      },
    },
    // 3. Only products that are on that order and still returnable.
    { key: 'product_name', label: 'Product', type: 'select', required: true, listColumn: true, dynamicOptionsKey: 'order_products', onValueChange: (value) => ({ ...lineFill(orderLines[value], batchInfo ?? {}) }) },
    { key: 'batch_number', label: 'Batch number', type: 'lookup', lookupResource: '/pharma/batches', lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'batch_number', lookupFilter: (o, form) => !form.product_name || o.product_name === form.product_name, autoFillMap: { product_name: 'product_name', unit: 'unit', warehouse_location: 'warehouse' }, listColumn: true },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 1, listColumn: true },
    { key: 'unit', label: 'Unit', type: 'text', group: 'Return details' },
    repField('sales_rep', 'Sales rep', { group: 'Return details' }),
    { key: 'warehouse', label: 'Warehouse', type: 'text', group: 'Return details' },
    { key: 'reason', label: 'Return reason', type: 'select', options: REASONS, group: 'Return details', onValueChange: (value, form) => {
      const patch: Record<string, string> = {};
      if (!form.disposition && REASON_TO_DISPOSITION[value]) patch.disposition = REASON_TO_DISPOSITION[value];
      if (!form.fault_side && REASON_TO_FAULT[value]) patch.fault_side = REASON_TO_FAULT[value];
      return Object.keys(patch).length ? patch : undefined;
    } },
    { key: 'fault_side', label: 'Whose mistake?', type: 'select', options: FAULT_SIDES, listColumn: true, group: 'Return details' },
    { key: 'return_date', label: 'Return date', type: 'date', group: 'Return details' },
    { key: 'inspection_status', label: 'Inspection status', type: 'select', options: INSPECTION_STATUSES, listColumn: true, group: 'Inspection & disposition', onValueChange: (value, form) => {
      if (form.disposition) return undefined;
      if (value === 'Failed') return { disposition: 'Quarantine' };
      if (value === 'Passed' && form.reason && !REASON_TO_DISPOSITION[form.reason]) return { disposition: 'Saleable' };
      return undefined;
    } },
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
  sampleRecords: [],
};

export function PharmaMedicineReturnPage() {
  return <PharmaMasterPage config={config} />;
}