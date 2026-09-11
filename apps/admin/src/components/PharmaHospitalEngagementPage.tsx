import { PharmaMasterPage, PharmaModuleConfig } from './PharmaMasterPage';

const ENGAGEMENT_TYPES = ['Hospital visit', 'Doctor meeting', 'Product presentation', 'Sample distribution', 'CME', 'Tender', 'Formulary listing', 'Conference', 'Follow-up'];
const STATUSES = ['Visit scheduled', 'Visit completed', 'Interaction recorded', 'Follow-up created', 'Follow-up completed'];

const config: PharmaModuleConfig = {
  resource: '/pharma/hospital-engagements',
  eyebrowModule: 'HOSPITAL ENGAGEMENT MANAGEMENT',
  title: 'Hospital engagement management',
  description: 'Log visits, doctor meetings, CME sessions, tenders and formulary listings with hospitals, doctors and key institutional accounts.',
  icon: '⚕',
  emptyIcon: '⚕',
  codeField: 'engagement_code',
  nameField: 'hospital_name',
  statusOptions: STATUSES,
  searchableKeys: ['engagement_code', 'hospital_name', 'doctor_name', 'contact_person', 'department', 'sales_rep'],
  fields: [
    { key: 'engagement_code', label: 'Engagement code', type: 'text', required: true, listColumn: true, readOnly: true, autoGenerate: 'HE' },
    { key: 'hospital_name', label: 'Hospital', type: 'text', required: true, listColumn: true },
    { key: 'contact_person', label: 'Contact person', type: 'text', listColumn: true },
    { key: 'doctor_name', label: 'Doctor / HCP', type: 'text', listColumn: true, group: 'Contacts' },
    { key: 'specialty', label: 'Specialty', type: 'text', group: 'Contacts' },
    { key: 'department', label: 'Department', type: 'text', group: 'Contacts', placeholder: 'e.g. Cardiology' },
    { key: 'sales_rep', label: 'Assigned sales rep', type: 'text', listColumn: true, group: 'Contacts' },
    { key: 'engagement_type', label: 'Activity type', type: 'select', options: ENGAGEMENT_TYPES, listColumn: true, group: 'Engagement details' },
    { key: 'purpose', label: 'Purpose', type: 'text', group: 'Engagement details' },
    { key: 'visit_date', label: 'Visit / event date', type: 'date', group: 'Engagement details' },
    { key: 'location', label: 'Location (GPS / address)', type: 'text', group: 'Engagement details' },
    { key: 'discussion_notes', label: 'Discussion notes', type: 'textarea', group: 'Engagement details' },
    { key: 'outcome', label: 'Outcome', type: 'text', group: 'Engagement details' },
    { key: 'next_follow_up_date', label: 'Next follow-up date', type: 'date', group: 'Engagement details' },
    { key: 'status', label: 'Status', type: 'select', options: STATUSES, group: 'Engagement details' },
    { key: 'notes', label: 'Notes', type: 'textarea', group: 'Engagement details' },
  ],
  kpis: [
    { icon: '⚕', iconClass: 'kpi-icon-ink', label: 'Engagements logged', value: (r) => String(r.length) },
    { icon: '✔', iconClass: 'kpi-icon-green', label: 'Visits completed', value: (r) => String(r.filter((x) => x.status === 'Visit completed' || x.status === 'Interaction recorded').length) },
    {
      icon: '📅',
      iconClass: 'kpi-icon-school',
      label: 'Upcoming visits',
      value: (r) => String(r.filter((x) => x.visit_date && new Date(x.visit_date as string) >= new Date()).length),
    },
    { icon: '◷', iconClass: 'kpi-icon-amber', label: 'Follow-ups pending', value: (r) => String(r.filter((x) => x.status === 'Follow-up created').length) },
  ],
  sampleRecords: [
    {
      id: 'demo-engage-1', engagement_code: 'HE-2026-214', hospital_name: 'Apollo Hospitals', contact_person: 'Mr. Ganesh (Purchase)',
      doctor_name: 'Dr. S. Krishnan', specialty: 'Cardiology', department: 'Cardiology', sales_rep: 'Vikram Nair',
      engagement_type: 'Doctor meeting', purpose: 'Discuss Cardivas launch', visit_date: '2026-08-20', location: 'Chennai',
      discussion_notes: 'Positive reception, requested clinical data.', outcome: 'Follow-up scheduled', next_follow_up_date: '2026-09-15',
      status: 'Follow-up created', notes: '',
    },
    {
      id: 'demo-engage-2', engagement_code: 'HE-2026-207', hospital_name: 'Kauvery Hospital', contact_person: 'Ms. Priya (Admin)',
      doctor_name: 'Dr. R. Iyer', specialty: 'Gastroenterology', department: 'Gastroenterology', sales_rep: 'Divya Suresh',
      engagement_type: 'CME', purpose: 'Sponsor CME session on GI disorders', visit_date: '2026-05-10', location: 'Coimbatore',
      discussion_notes: 'Session well attended, 40+ doctors.', outcome: 'Strong engagement', next_follow_up_date: '',
      status: 'Visit completed', notes: '',
    },
  ],
};

export function PharmaHospitalEngagementPage() {
  return <PharmaMasterPage config={config} />;
}