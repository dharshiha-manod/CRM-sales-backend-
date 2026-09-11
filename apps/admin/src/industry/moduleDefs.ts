import type { IndustryKey } from './types';

export interface ModuleDef {
  id: string;
  label: string;
  icon: string;
}

export const INDUSTRY_MODULES: Record<IndustryKey, ModuleDef[]> = {
  fmcg: [
    { id: 'route-beat', label: 'Route / Beat Management', icon: '⌖' },
    { id: 'scheme-discount', label: 'Scheme / Discount Management', icon: '％' },
    { id: 'distributor', label: 'Distributor Management', icon: '▤' },
    { id: 'sales-return-damage', label: 'Sales Return & Damage Management', icon: '↩' },
    { id: 'batch-expiry', label: 'Batch & Expiry Management', icon: '⏱' },
  ],
  trading: [
    { id: 'deal', label: 'Deal Management', icon: '◆' },
    { id: 'supplier-vendor', label: 'Supplier / Vendor Management', icon: '◎' },
    { id: 'purchase-enquiry', label: 'Purchase Enquiry', icon: '❓' },
    { id: 'price-rate-list', label: 'Price List / Rate Management', icon: '₹' },
    { id: 'shipment', label: 'Shipment Management', icon: '🚚' },
    { id: 'trade-documents', label: 'Trade Documents', icon: '📄' },
    { id: 'currency', label: 'Currency Management', icon: '＄' },
    { id: 'logistics', label: 'Logistics', icon: '▥' },
    { id: 'import-export', label: 'Import / Export Management', icon: '⇄' },
    { id: 'customs-clearance', label: 'Customs & Clearance', icon: '🛃' },
    { id: 'claims-disputes', label: 'Claims & Disputes', icon: '⚖' },
    { id: 'commission', label: 'Commission Management', icon: '％' },
    { id: 'trade-profitability', label: 'Trade Profitability', icon: '↗' },
    { id: 'trade-compliance', label: 'Trade Compliance Management', icon: '✔' },
    { id: 'trade-finance-lc', label: 'Trade Finance / LC Management', icon: '₹' },
  ],
  textile: [
    { id: 'design-pattern', label: 'Design / Pattern Management', icon: '✎' },
  { id: 'colour-size', label: 'Colour & Size Management', icon: '◧' },
    { id: 'fabric-roll', label: 'Fabric Roll Management', icon: '▤' },
    { id: 'textile-sample', label: 'Textile Sample Management', icon: '▣' },
    { id: 'quality-inspection', label: 'Quality & Inspection Management', icon: '✔' },
    { id: 'distributor', label: 'Distributor Management', icon: '▤' },
  ],
  school: [
    { id: 'school-management', label: 'School Management', icon: '◎' },
    { id: 'school-sales-collection', label: 'School-wise Sales & Collection', icon: '₹' },
    { id: 'academic-year-term', label: 'Academic Year & Term Management', icon: '📅' },
    { id: 'specific-pricing-discount', label: 'Specific Pricing & Discount Management', icon: '％' },
  ],
  pharma: [
    { id: 'sample', label: 'Sample Management', icon: '💊' },
    { id: 'batch-expiry', label: 'Batch & Expiry Management', icon: '⏱' },
    { id: 'product-promotion', label: 'Product Promotion Management', icon: '📣' },
    { id: 'hospital-engagement', label: 'Hospital Engagement Management', icon: '⚕' },
    { id: 'medicine-return', label: 'Medicine Return Management', icon: '↩' },
    { id: 'recall', label: 'Recall Management', icon: '⚠' },
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