import type { IndustryKey } from './types';

export interface ModuleDef {
  id: string;
  label: string;
  icon: string;
  description?: string;
}

export const INDUSTRY_MODULES: Record<IndustryKey, ModuleDef[]> = {
  fmcg: [
    { id: 'route-beat', label: 'Route / Beat Management', icon: '⌖' },
    { id: 'scheme-discount', label: 'Scheme / Discount Management', icon: '％' },
    { id: 'shipment', label: 'Shipments', icon: '🚚' },
    { id: 'distributor', label: 'Distributor Management', icon: '▤' },
    { id: 'sales-return-damage', label: 'Sales Return & Damage Management', icon: '↩' },
     { id: 'batch-expiry', label: 'Batch & Expiry Management', icon: '⏱' },
      { id: 'currency-rates', label: 'Currency Rates', icon: '¤' },
    { id: 'trade-documents', label: 'Trade Documents', icon: '📄' },
    { id: 'import-export', label: 'Import / Export Management', icon: '⇄' },
       { id: 'customs-clearance', label: 'Customs & Clearance', icon: '🛃' },
    { id: 'shipment-charges', label: 'Shipment Charges', icon: '₹' },
    { id: 'customer-invoices', label: 'Customer Invoices', icon: '🧾' },
  ],
  trading: [
    { id: 'deal', label: 'Deal Management', icon: '◆' },
    { id: 'supplier-vendor', label: 'Supplier / Vendor Management', icon: '◎' },
    { id: 'purchase-enquiry', label: 'Purchase Enquiry', icon: '✉' },
    { id: 'price-rate-list', label: 'Price List / Rate Management', icon: '₹' },
   { id: 'shipment', label: 'Shipment Management', icon: '🚚' },
    { id: 'sales-order', label: 'Sales Order Management', icon: '🧾' },
    { id: 'trade-documents', label: 'Trade Documents', icon: '📄' },
    { id: 'currency', label: 'Currency Management', icon: '＄' },
    { id: 'logistics', label: 'Logistics', icon: '▥' },
    { id: 'import-export', label: 'Import / Export Management', icon: '⇄' },
    { id: 'customs-clearance', label: 'Customs & Clearance', icon: '🛃' },
    { id: 'claims-disputes', label: 'Claims & Disputes', icon: '⚖' },
      { id: 'commission', label: 'Commission Management', icon: '％' },
    { id: 'commission-rules', label: 'Commission Rules', icon: '⚙' },
    { id: 'trade-profitability', label: 'Trade Profitability', icon: '↗' },
    { id: 'trade-compliance', label: 'Trade Compliance Management', icon: '✔' },
    { id: 'trade-finance-lc', label: 'Trade Finance / LC Management', icon: '₹' },
    { id: 'shipment-charges', label: 'Shipment Charges', icon: '₹' },
    { id: 'customer-invoices', label: 'Customer Invoices', icon: '🧾' },
  ],
  textile: [
    { id: 'fabric-roll', label: 'Fabric Roll Management', icon: '▤' },
    { id: 'textile-sample', label: 'Textile Sample Management', icon: '▣' },
    { id: 'quality-inspection', label: 'Quality & Inspection Management', icon: '✔' },
  ],
  school: [
    { id: 'school-management', label: 'School Management', icon: '◎' },
    { id: 'school-sales-collection', label: 'School-wise Sales & Collection', icon: '₹' },
    { id: 'academic-year-term', label: 'Academic Year & Term Management', icon: '📅' },
    { id: 'specific-pricing-discount', label: 'Specific Pricing & Discount Management', icon: '％' },
  ],
  pharma: [
    { id: 'company', label: 'Company & GST', icon: '🏢' },
    { id: 'supplier', label: 'Supplier Management', icon: '🏭' },
    { id: 'purchase-order', label: 'Purchase Orders', icon: '🧾' },
    { id: 'grn', label: 'Goods Receipt (GRN)', icon: '📥' },
    { id: 'batch-expiry', label: 'Batch & Expiry Management', icon: '⏱' },
    { id: 'stock-ledger', label: 'Stock Ledger', icon: '⇄' },
    { id: 'scan', label: 'Scan & Barcodes', icon: '📷' },
    { id: 'gst-invoice', label: 'GST Sales Invoices', icon: '🧮' },
    { id: 'medicine-return', label: 'Sales Returns', icon: '↩' },
    { id: 'refunds', label: 'Customer Refunds', icon: '₹' },
    { id: 'customer-outstanding', label: 'Customer Outstanding', icon: '⏰' },
    { id: 'purchase-return', label: 'Purchase Returns', icon: '📤' },
    { id: 'supplier-payment', label: 'Supplier Payments', icon: '💳' },
    { id: 'recall', label: 'Recall Management', icon: '⚠' },
    { id: 'pharma-reports', label: 'Pharma Reports', icon: '📊' },
  ],
 // Sales Orders, Stock/Inventory, Collections and Reports are intentionally
  // NOT listed here — they are covered by the existing Core Orders,
  // Products/Inventory, Collections and Reports modules (see main sidebar),
  // extended for Vehicle rather than duplicated. Only genuinely
  // Vehicle-specific modules belong in this array.
  vehicle: [
    { id: 'dealers', label: 'Dealer Management', icon: '◎' },
    { id: 'catalog', label: 'Vehicle / Parts Catalog', icon: '▣' },
    { id: 'test-drive', label: 'Test Drive Management', icon: '○' },
    { id: 'booking', label: 'Vehicle Booking', icon: '▣' },
    { id: 'schemes', label: 'Schemes & Discounts', icon: '％' },
    { id: 'delivery-pdi', label: 'Vehicle Delivery / PDI', icon: '▣' },
    { id: 'registration', label: 'Registration & Documents', icon: '📄' },
    { id: 'finance', label: 'Finance / Loan', icon: '₹' },
    { id: 'insurance', label: 'Insurance', icon: '▣' },
    { id: 'exchange', label: 'Vehicle Exchange', icon: '↔' },
    { id: 'warranty', label: 'Warranty', icon: '✔' },
    { id: 'service', label: 'Service / After-Sales', icon: '🔧' },
    { id: 'returns', label: 'Returns / Cancellation', icon: '↩' },
  ],
};