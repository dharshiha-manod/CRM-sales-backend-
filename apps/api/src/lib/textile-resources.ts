export interface TextileResource {
  path: string; table: string; codeField: string; requiredFields: string[]; columns: string[];
  /** allowed values for the `status` column */
  statuses: string[];
  /** numeric columns that may never be negative */
  nonNegative: string[];
}
export const TEXTILE_RESOURCES: TextileResource[] = [
  { path: 'designs', table: 'textile_designs', codeField: 'design_code',
    statuses: ['Active', 'Draft', 'Discontinued'], nonNegative: [],
    requiredFields: ['design_code', 'design_name'],
    columns: ['design_code', 'design_name', 'category', 'fabric_type', 'season', 'designer_name', 'reference_image_url', 'notes', 'industry_type_id'] },
  { path: 'variants', table: 'textile_variants', codeField: 'sku',
    statuses: ['Active', 'Inactive'], nonNegative: ['stock_quantity'],
    requiredFields: ['sku', 'design_code', 'colour_name'],
    columns: ['sku', 'design_code', 'colour_name', 'size', 'colour_hex', 'stock_quantity', 'industry_type_id'] },
  { path: 'fabric-rolls', table: 'textile_fabric_rolls', codeField: 'roll_number',
    statuses: ['In stock', 'Issued', 'Damaged', 'Sold'], nonNegative: ['length_meters', 'gsm', 'width_inches'],
    requiredFields: ['roll_number', 'fabric_type'],
    columns: ['roll_number', 'product_code', 'fabric_type', 'colour', 'length_meters', 'gsm', 'width_inches', 'lot_number', 'quality_grade', 'supplier_name', 'received_date', 'warehouse_location', 'order_id', 'industry_type_id'] },
  { path: 'samples', table: 'textile_samples', codeField: 'sample_code',
    statuses: ['Pending', 'Approved', 'Rejected', 'Revision requested'], nonNegative: [],
    requiredFields: ['sample_code', 'client_name'],
    columns: ['sample_code', 'design_code', 'client_name', 'sent_date', 'expected_response_date', 'feedback', 'industry_type_id'] },
  { path: 'quality-inspections', table: 'textile_quality_inspections', codeField: 'inspection_code',
    statuses: ['Pass', 'Fail'], nonNegative: [],
    requiredFields: ['inspection_code', 'roll_number', 'inspection_date', 'status'],
    columns: ['inspection_code', 'roll_number', 'inspection_date', 'inspector_name', 'grade', 'defects_found', 'remarks', 'industry_type_id'] },
  // Distributors: our delivery partners (NOT CRM clients / leads). An order can be assigned to one; they deliver the fabric to the client.
  { path: 'distributors', table: 'textile_distributors', codeField: 'distributor_code',
    statuses: ['Active', 'Inactive'], nonNegative: ['commission_percent'],
    requiredFields: ['distributor_code', 'distributor_name'],
    columns: ['distributor_code', 'distributor_name', 'contact_person', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'territory', 'commission_percent', 'notes', 'industry_type_id'] },
];