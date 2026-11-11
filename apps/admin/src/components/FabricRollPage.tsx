import { useState } from 'react';
import { TextileMasterPage, TextileModuleConfig, TextileRecord } from './TextileMasterPage';
import { RollLedgerDialog } from './RollLedgerDialog';
import './RollLedger.css';

// Refreshes the roll list after a ledger change (damage / stock correction).
let reloadRolls: () => void = () => {};

function RollLedgerButton({ roll }: { roll: TextileRecord }) {
  const [open, setOpen] = useState(false);
  if (roll.id.startsWith('demo-')) return null;
  return (
    <>
      <button type="button" className="rl-btn" onClick={() => setOpen(true)} title="Metres history, damaged length and stock correction">Ledger</button>
      {open && (
        <RollLedgerDialog
          roll={{ id: roll.id, roll_number: String(roll.roll_number ?? ''), status: roll.status, product_code: (roll.product_code as string | null) ?? null }}
          onClose={() => setOpen(false)}
          onChanged={() => reloadRolls()}
        />
      )}
    </>
  );
}

const FABRIC_TYPES = ['Cotton', 'Silk', 'Linen', 'Wool', 'Polyester', 'Viscose', 'Viscose / Rayon', 'Nylon', 'Denim', 'Georgette', 'Chiffon', 'Satin', 'Velvet', 'Blended', 'Other'];

type ProductColour = { name: string; code?: string | null };
type ProductTextile = { fabricType?: string | null; gsm?: number | null; width?: number | null; widthUnit?: 'in' | 'cm' | null; lengthPerRoll?: number | null; lengthUnit?: 'm' | 'yd' | null; colors?: ProductColour[] };
const GRADES = ['A', 'B', 'C', 'Reject'];

const config: TextileModuleConfig = {
  resource: '/textile/fabric-rolls',
  eyebrowModule: 'FABRIC ROLL MANAGEMENT',
  title: 'Fabric roll management',
  description: 'Warehouse-level inventory of physical fabric rolls — lot, length, grade and location. New rolls come from Goods Receipt (GRN); add one here by hand only for opening stock (admin). Every cut, damage and correction is recorded in each roll\'s ledger.',
  icon: '▤',
  emptyIcon: '▤',
  codeField: 'roll_number',
  nameField: 'roll_number',
  statusOptions: ['In stock', 'Quarantine', 'Issued', 'Damaged', 'Sold'],
  registerReload: (reload) => { reloadRolls = reload; },
  inlineActions: (r) => <RollLedgerButton roll={r} />,
  searchableKeys: ['roll_number', 'lot_number', 'fabric_type', 'supplier_name', 'warehouse_location'],
  fields: [
    { key: 'roll_number', label: 'Roll number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'FR' },
    {
      key: 'product_code', label: 'Product', type: 'lookup', required: true, listColumn: true,
      lookupResource: '/products', industryScoped: true, lookupValueKey: 'product_code', lookupLabelKey: 'product_name', lookupSecondaryLabelKey: 'product_code',
      helpText: 'Pick the product this roll belongs to. Fabric type, GSM, width, length and the colour list come from it, and the product stock follows this roll.',
      onLookupChange: (product, setForm, setDynamicOptions) => {
        const t = ((product as { textile_details?: ProductTextile | null }).textile_details ?? {}) as ProductTextile;
        setDynamicOptions('product_colours', (t.colors ?? []).map((c) => ({ value: c.name, label: c.code ? `${c.name} (${c.code})` : c.name })));
        const widthIn = t.width == null ? '' : String(t.widthUnit === 'cm' ? Math.round((t.width / 2.54) * 100) / 100 : t.width);
        const lengthM = t.lengthPerRoll == null ? '' : String(t.lengthUnit === 'yd' ? Math.round(t.lengthPerRoll * 0.9144 * 100) / 100 : t.lengthPerRoll);
        setForm((prev) => ({
          ...prev,
          fabric_type: t.fabricType || prev.fabric_type || '',
          gsm: t.gsm == null ? (prev.gsm ?? '') : String(t.gsm),
          width_inches: widthIn || prev.width_inches || '',
          length_meters: prev.length_meters || lengthM,
          // One colour on the product -> pick it for the user; several -> they choose from the list.
          colour: (t.colors ?? []).length === 1 ? t.colors![0].name : '',
          supplier_name: (product as { supplier_name?: string | null }).supplier_name || prev.supplier_name || '',
        }));
      },
    },
    { key: 'fabric_type', label: 'Fabric type', type: 'select', options: FABRIC_TYPES, required: true, listColumn: true },
    { key: 'colour', label: 'Colour', type: 'select', dynamicOptionsKey: 'product_colours', required: true, listColumn: true, helpText: 'Colours come from the selected product. Add a new colour in Products first.' },
    { key: 'length_meters', label: 'Available (m)', type: 'number', listColumn: true, helpText: 'New roll: enter the full length received. After that, every change is recorded as a stock correction in the roll\'s ledger (use Ledger for damage, cuts happen from the order).' },
    { key: 'opening_note', label: 'Reason for manual entry (required)', type: 'text', visibleIf: (f) => !f.original_length_meters, placeholder: 'e.g. Opening stock before GRN go-live', helpText: 'Supplier rolls must be received through Goods Receipt (GRN). Use this form only for opening stock. The reason is saved in the roll ledger.' },
    { key: 'original_length_meters', label: 'Original (m)', type: 'number', listColumn: true, readOnly: true, visibleIf: (f) => !!f.original_length_meters, helpText: 'Length when the roll was received.' },
    { key: 'gsm', label: 'GSM (weight)', type: 'number', group: 'Roll specification', placeholder: 'grams per sq. metre' },
    { key: 'width_inches', label: 'Width (inches)', type: 'number', group: 'Roll specification' },
    { key: 'lot_number', label: 'Lot number', type: 'text', group: 'Roll specification' },
    { key: 'quality_grade', label: 'Quality grade', type: 'select', options: GRADES, group: 'Roll specification' },
    { key: 'supplier_name', label: 'Supplier', type: 'text', group: 'Sourcing & storage' },
    { key: 'received_date', label: 'Received date', type: 'date', group: 'Sourcing & storage' },
    { key: 'warehouse_location', label: 'Warehouse location', type: 'text', group: 'Sourcing & storage', placeholder: 'e.g. Rack B-12' },
    { key: 'status', label: 'Status', type: 'select', options: ['In stock', 'Quarantine', 'Issued', 'Damaged', 'Sold'], group: 'Sourcing & storage' },
    { key: 'order_id', label: 'Allocated to order', type: 'lookup', lookupResource: '/orders', industryScoped: true, lookupLabelKey: 'order_number', group: 'Order allocation', helpText: 'Pick an order to issue this roll. It becomes Sold when the order is dispatched and is released if the order is cancelled.' },
    { key: 'order_number', label: 'Order no.', type: 'text', readOnly: true, listColumn: true, group: 'Order allocation' },
  ],
  kpis: [
    { icon: '▤', iconClass: 'kpi-icon-ink', label: 'Rolls in inventory', value: (r) => String(r.length) },
    { icon: '📏', iconClass: 'kpi-icon-school', label: 'Available length', value: (r) => `${Math.round(r.filter((x) => x.status === 'In stock').reduce((sum, x) => sum + (Number(x.length_meters) || 0), 0) * 100) / 100} m`, sub: () => 'metres on In stock rolls' },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'In stock', value: (r) => String(r.filter((x) => x.status === 'In stock').length) },
    { icon: '⚠', iconClass: 'kpi-icon-amber', label: 'Low length (<5m)', value: (r) => String(r.filter((x) => x.status === 'In stock' && Number(x.length_meters) > 0 && Number(x.length_meters) < 5).length), sub: () => 'consider reordering' },
    { icon: '▣', iconClass: 'kpi-icon-ink', label: 'Allocated to orders', value: (r) => String(r.filter((x) => x.order_id).length), sub: () => 'issued or sold' },
    { icon: '⏳', iconClass: 'kpi-icon-amber', label: 'Quarantine', value: (r) => String(r.filter((x) => x.status === 'Quarantine').length), sub: () => 'waiting for inspection' },
    { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Damaged', value: (r) => String(r.filter((x) => x.status === 'Damaged').length) },
  ],
};

export function FabricRollPage() {
  return <TextileMasterPage config={config} />;
}