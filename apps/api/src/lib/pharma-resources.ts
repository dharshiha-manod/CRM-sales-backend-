// Pharma resource definitions. Own tables / own routes: nothing here touches any other industry.
export interface PharmaResource {
  path: string; table: string; codeField: string; requiredFields: string[]; columns: string[];
  statuses: string[]; nonNegative: string[];
  /** 'rep' = sales reps may also create/edit (field work); 'manager' = managers/admins only */
  write: 'rep' | 'manager';
}
export { BATCH_BLOCKED } from './pharma-rules.js';
export const PHARMA_RESOURCES: PharmaResource[] = [
  { path: 'batches', table: 'pharma_batches', codeField: 'batch_number', write: 'manager',
    statuses: ['Valid', 'Expiring Soon', 'Critical Expiry', 'Expired', 'Quarantined', 'Recalled'], nonNegative: ['quantity'],
    requiredFields: ['batch_number', 'product_name', 'expiry_date'],
    columns: ['batch_number', 'product_code', 'product_name', 'manufacture_date', 'expiry_date', 'quantity', 'unit', 'supplier', 'sales_rep', 'warehouse_location', 'notes', 'industry_type_id'] },
  { path: 'samples', table: 'pharma_samples', codeField: 'sample_code', write: 'rep',
    statuses: ['Available', 'Assigned', 'Taken for visit', 'Distributed', 'Acknowledged', 'Returned'], nonNegative: ['quantity_issued', 'quantity_remaining'],
    requiredFields: ['sample_code', 'product_name', 'batch_number', 'quantity_issued'],
    columns: ['sample_code', 'product_name', 'product_code', 'sample_type', 'batch_number', 'expiry_date', 'quantity_issued', 'quantity_remaining', 'sales_rep', 'doctor_name', 'hospital_name', 'location', 'visit_reference', 'purpose', 'issue_date', 'notes', 'industry_type_id'] },
  { path: 'promotions', table: 'pharma_promotions', codeField: 'promotion_code', write: 'manager',
    statuses: ['Planned', 'Products selected', 'HCPs assigned', 'Active', 'Feedback captured', 'Completed', 'Cancelled'], nonNegative: ['samples_provided', 'budget'],
    requiredFields: ['promotion_code', 'campaign_name', 'product_name'],
    columns: ['promotion_code', 'campaign_name', 'product_code', 'product_name', 'product_category', 'promotion_type', 'target_segment', 'sales_rep', 'doctor_name', 'hospital_name', 'promotional_material', 'samples_provided', 'start_date', 'end_date', 'budget', 'doctor_response', 'follow_up_date', 'feedback', 'notes', 'industry_type_id'] },
  { path: 'hospital-engagements', table: 'pharma_hospital_engagements', codeField: 'engagement_code', write: 'rep',
    statuses: ['Visit scheduled', 'Visit completed', 'Interaction recorded', 'Follow-up created', 'Follow-up completed'], nonNegative: [],
    requiredFields: ['engagement_code', 'hospital_name'],
    columns: ['engagement_code', 'hospital_name', 'contact_person', 'doctor_name', 'specialty', 'department', 'sales_rep', 'engagement_type', 'purpose', 'visit_date', 'location', 'discussion_notes', 'outcome', 'next_follow_up_date', 'notes', 'industry_type_id'] },
  { path: 'medicine-returns', table: 'pharma_medicine_returns', codeField: 'return_code', write: 'rep',
    statuses: ['Requested', 'Received', 'Verified', 'Under inspection', 'Approved', 'Rejected', 'Closed'], nonNegative: ['quantity'],
    requiredFields: ['return_code', 'product_name'],
    columns: ['return_code', 'product_name', 'batch_number', 'quantity', 'unit', 'customer_hospital', 'invoice_reference', 'sales_rep', 'warehouse', 'reason', 'return_date', 'inspection_status', 'disposition', 'fault_side', 'notes', 'industry_type_id'] },
  { path: 'recalls', table: 'pharma_recalls', codeField: 'recall_code', write: 'manager',
    statuses: ['Created', 'Batch identified', 'Stock identified', 'Notification sent', 'Collection in progress', 'Stock quarantined', 'Closed'], nonNegative: ['affected_quantity', 'stock_quantity', 'supplied_quantity', 'collected_quantity'],
    requiredFields: ['recall_code', 'product_name', 'batch_number'],
    columns: ['recall_code', 'product_name', 'batch_number', 'severity', 'reason', 'recall_date', 'affected_quantity', 'stock_quantity', 'supplied_quantity', 'collected_quantity', 'affected_customers', 'assigned_team', 'action_required', 'completion_date', 'notes', 'industry_type_id'] },
];