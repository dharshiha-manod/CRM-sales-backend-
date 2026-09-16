import { TradingMasterPage, TradingModuleConfig } from './TradingMasterPage';

const STATUSES = ['Active', 'Inactive', 'Blocked', 'Pending Approval'];

const config: TradingModuleConfig = {
  resource: '/trading/suppliers',
  eyebrowModule: 'SUPPLIER / VENDOR MANAGEMENT',
  title: 'Supplier / vendor management',
  description: 'Supplier and vendor master data — contacts, products supplied, commercial terms and status.',
  icon: '◎',
  emptyIcon: '◎',
  codeField: 'supplier_id',
  nameField: 'supplier_name',
  statusOptions: STATUSES,
  searchableKeys: ['supplier_id', 'supplier_name', 'company_name', 'contact_person', 'city', 'country', 'supplier_category'],
  fields: [
    { key: 'supplier_id', label: 'Supplier ID', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'SUP' },
    { key: 'supplier_name', label: 'Supplier name', type: 'text', required: true, listColumn: true },
    { key: 'company_name', label: 'Company name', type: 'text', listColumn: true },
    { key: 'contact_person', label: 'Contact person', type: 'text', group: 'Contact' },
    { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
    { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
    { key: 'address', label: 'Address', type: 'textarea', group: 'Contact' },
    { key: 'city', label: 'City', type: 'text', listColumn: true, group: 'Contact' },
    { key: 'country', label: 'Country', type: 'text', group: 'Contact' },
    { key: 'tax_number', label: 'Tax / GST / VAT number', type: 'text', group: 'Commercial' },
    { key: 'supplier_category', label: 'Supplier category', type: 'text', listColumn: true, group: 'Commercial' },
    { key: 'products_supplied', label: 'Products supplied', type: 'multi-lookup', lookupResource: '/products?status=active', lookupValueKey: 'product_name', lookupLabelKey: 'product_code', group: 'Commercial' },
    { key: 'payment_terms', label: 'Payment terms', type: 'text', group: 'Commercial' },
    { key: 'credit_limit', label: 'Credit limit', type: 'number', group: 'Commercial' },
    { key: 'bank_details', label: 'Bank details', type: 'textarea', group: 'Commercial' },
    { key: 'status', label: 'Supplier status', type: 'select', options: STATUSES, listColumn: true, group: 'Commercial' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Commercial' },
  ],
  kpis: [
    { icon: '◎', iconClass: 'kpi-icon-ink', label: 'Total suppliers', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
    { icon: '⊘', iconClass: 'kpi-icon-red', label: 'Inactive / blocked', value: (r) => String(r.filter((x) => x.status === 'Inactive' || x.status === 'Blocked').length) },
    {
      icon: '✦',
      iconClass: 'kpi-icon-amber',
      label: 'New this month',
      value: (r) => String(r.filter((x) => x.created_at && new Date(x.created_at as string).getMonth() === new Date().getMonth() && new Date(x.created_at as string).getFullYear() === new Date().getFullYear()).length),
    },
  ],
  
};

export function TradingSupplierVendorPage() {
  return <TradingMasterPage config={config} />;
}