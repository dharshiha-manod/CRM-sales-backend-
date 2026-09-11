import { VehicleMasterPage, VehicleModuleConfig } from './VehicleMasterPage';

const STATUSES = ['Not Required', 'Started', 'Documents Pending', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Disbursed'];

const config: VehicleModuleConfig = {
  resource: '/vehicle/finance-applications',
  eyebrowModule: 'FINANCE / LOAN',
  title: 'Vehicle finance / loan',
  description: 'Finance applications linked to a client and sales order. Approval updates the linked Core Order and its payment requirement; rejection creates a Core follow-up automatically.',
  icon: '₹',
  emptyIcon: '₹',
  codeField: 'application_number',
  nameField: 'client_name',
  statusOptions: STATUSES,
  searchableKeys: ['application_number', 'client_name', 'finance_provider', 'sales_order_reference'],
  fields: [
    { key: 'application_number', label: 'Finance application number', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'FIN' },
    { key: 'client_name', label: 'Client', type: 'text', required: true, listColumn: true },
    { key: 'vin', label: 'Vehicle (VIN)', type: 'lookup', group: 'Vehicle & order', lookupResource: '/vehicle/units', lookupLabelKey: 'model_name' },
    { key: 'sales_order_reference', label: 'Sales order reference (Core Orders)', type: 'text', group: 'Vehicle & order' },
    { key: 'finance_provider', label: 'Finance provider', type: 'text', listColumn: true, group: 'Loan details' },
    { key: 'loan_amount', label: 'Loan amount', type: 'number', group: 'Loan details' },
    { key: 'down_payment', label: 'Down payment', type: 'number', group: 'Loan details' },
    { key: 'interest_rate', label: 'Interest rate (%)', type: 'number', group: 'Loan details' },
    { key: 'tenure_months', label: 'Tenure (months)', type: 'number', group: 'Loan details' },
    { key: 'emi', label: 'EMI', type: 'number', group: 'Loan details' },
    { key: 'processing_fee', label: 'Processing fee', type: 'number', group: 'Loan details' },
    { key: 'approved_amount', label: 'Approved amount', type: 'number', group: 'Progress' },
    { key: 'disbursed_amount', label: 'Disbursed amount', type: 'number', listColumn: true, group: 'Progress' },
    { key: 'pending_amount', label: 'Pending amount', type: 'number', group: 'Progress' },
    { key: 'application_date', label: 'Application date', type: 'date', group: 'Progress' },
    { key: 'approval_date', label: 'Approval date', type: 'date', group: 'Progress' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', group: 'Progress' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, listColumn: true, group: 'Progress' },
  ],
  kpis: [
    { icon: '₹', iconClass: 'kpi-icon-ink', label: 'Total applications', value: (r) => String(r.length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Under review', value: (r) => String(r.filter((x) => x.status === 'Under Review' || x.status === 'Submitted').length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Approved / disbursed', value: (r) => String(r.filter((x) => x.status === 'Approved' || x.status === 'Disbursed').length) },
     { icon: '⚠', iconClass: 'kpi-icon-red', label: 'Rejected', value: (r) => String(r.filter((x) => x.status === 'Rejected').length) },
  ],
  sampleRecords: [
    { id: 'demo-fin-1', application_number: 'FIN-0001', client_name: 'Ramesh Iyer', finance_provider: 'HDFC Bank', loan_amount: 700000, disbursed_amount: 700000, status: 'Disbursed' },
    { id: 'demo-fin-2', application_number: 'FIN-0002', client_name: 'Priya Menon', finance_provider: 'ICICI Bank', loan_amount: 1500000, disbursed_amount: 0, status: 'Under Review' },
  ],
};

export function VehicleFinanceLoanPage() {
  return <VehicleMasterPage config={config} />;
}