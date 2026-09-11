import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

const PROMO_TYPES = ['Sample drive', 'Gift', 'Literature / detailing', 'Product demo', 'New product introduction', 'CME sponsorship', 'Conference'];
const RESPONSES = ['Positive', 'Neutral', 'Negative', 'No response yet'];
const STATUSES = ['Planned', 'Products selected', 'HCPs assigned', 'Active', 'Feedback captured', 'Completed', 'Cancelled'];

const config: PharmaModuleConfig = {
  resource: '/pharma/promotions',
  eyebrowModule: 'PRODUCT PROMOTION MANAGEMENT',
  title: 'Product promotion management',
  description: 'Plan and track promotional campaigns — samples, literature, CME sponsorships — against doctors, budget and a window of time, through to feedback and follow-up.',
  icon: '📣',
  emptyIcon: '📣',
  codeField: 'promotion_code',
  nameField: 'campaign_name',
  statusOptions: STATUSES,
  searchableKeys: ['promotion_code', 'campaign_name', 'product_name', 'target_segment', 'doctor_name', 'hospital_name', 'sales_rep'],
  fields: [
    { key: 'promotion_code', label: 'Promotion code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'PRM' },
    { key: 'campaign_name', label: 'Campaign name', type: 'text', required: true, listColumn: true },
    { key: 'product_name', label: 'Product', type: 'text', required: true, listColumn: true },
    { key: 'product_category', label: 'Product category', type: 'text', group: 'Campaign' },
    { key: 'promotion_type', label: 'Promotion type', type: 'select', options: PROMO_TYPES, listColumn: true, group: 'Campaign' },
    { key: 'target_segment', label: 'Target segment', type: 'text', group: 'Campaign', placeholder: 'e.g. Cardiologists, Chennai' },
    { key: 'sales_rep', label: 'Sales representative', type: 'text', listColumn: true, group: 'Campaign' },
    { key: 'doctor_name', label: 'Doctor / HCP', type: 'text', group: 'Campaign' },
    { key: 'hospital_name', label: 'Hospital / clinic', type: 'text', group: 'Campaign' },
    { key: 'promotional_material', label: 'Promotional material', type: 'text', group: 'Campaign', placeholder: 'e.g. brochure, visual aid' },
    { key: 'samples_provided', label: 'Samples provided', type: 'number', group: 'Campaign' },
    { key: 'start_date', label: 'Campaign start date', type: 'date', group: 'Schedule & budget' },
    { key: 'end_date', label: 'Campaign end date', type: 'date', group: 'Schedule & budget' },
    { key: 'budget', label: 'Budget', type: 'number', group: 'Schedule & budget' },
    { key: 'doctor_response', label: 'Doctor response', type: 'select', options: RESPONSES, group: 'Schedule & budget' },
    { key: 'follow_up_date', label: 'Follow-up date', type: 'date', group: 'Schedule & budget' },
    { key: 'feedback', label: 'Feedback', type: 'textarea', group: 'Schedule & budget' },
    { key: 'status', label: 'Campaign status', type: 'select', options: STATUSES, listColumn: true, group: 'Schedule & budget' },
    { key: 'notes', label: 'Remarks', type: 'textarea', group: 'Schedule & budget' },
  ],
  kpis: [
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Active campaigns', value: (r) => String(r.filter((x) => x.status === 'Active').length) },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Follow-ups pending', value: (r) => String(r.filter((x) => x.follow_up_date && new Date(x.follow_up_date as string) >= new Date()).length) },
    { icon: '📣', iconClass: 'kpi-icon-ink', label: 'Samples distributed', value: (r) => String(r.reduce((sum, x) => sum + (Number(x.samples_provided) || 0), 0)) },
    { icon: '₹', iconClass: 'kpi-icon-school', label: 'Total budget', value: (r) => `₹${r.reduce((sum, x) => sum + (Number(x.budget) || 0), 0)}` },
  ],
  sampleRecords: [
    {
      id: 'demo-promo-1', promotion_code: 'PRM-2026-063', campaign_name: 'Cardivas Launch Drive', product_name: 'Cardivas 6.25mg',
      product_category: 'Cardiology', promotion_type: 'New product introduction', target_segment: 'Cardiologists, Chennai',
      sales_rep: 'Vikram Nair', doctor_name: 'Dr. S. Krishnan', hospital_name: 'Apollo Hospitals',
      promotional_material: 'Visual aid + brochure', samples_provided: 50, start_date: '2026-06-01', end_date: '2026-07-15',
      budget: 45000, doctor_response: 'Positive', follow_up_date: '2026-09-10', feedback: 'Interested in switching 3 patients.',
      status: 'Active', notes: '',
    },
    {
      id: 'demo-promo-2', promotion_code: 'PRM-2026-058', campaign_name: 'Pantocid CME Sponsorship', product_name: 'Pantocid DSR',
      product_category: 'Gastroenterology', promotion_type: 'CME sponsorship', target_segment: 'Gastroenterologists, Coimbatore',
      sales_rep: 'Divya Suresh', doctor_name: 'Dr. R. Iyer', hospital_name: 'Kauvery Hospital',
      promotional_material: 'Case study deck', samples_provided: 20, start_date: '2026-05-10', end_date: '2026-05-10',
      budget: 60000, doctor_response: 'Neutral', follow_up_date: '2026-06-01', feedback: 'Attended, requested more literature.',
      status: 'Completed', notes: '',
    },
  ],
};

export function PharmaProductPromotionPage() {
  return <PharmaMasterPage config={config} />;
}