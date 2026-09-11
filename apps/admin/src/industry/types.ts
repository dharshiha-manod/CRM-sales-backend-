export type IndustryKey = 'fmcg' | 'school' | 'textile' | 'pharma' | 'trading' | 'vehicle';

export interface Kpi {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

export interface Beat {
  id: string;
  name: string;
  repName: string;
  area: string;
  stopsPlanned: number;
  stopsDone: number;
}

export interface PartyField {
  label: string;
  value: string;
}

export interface Party {
  id: string;
  code: string;
  name: string;
  type: string;
  location: string;
  contactPerson: string;
  phone: string;
  email?: string;
  whatsappNumber?: string;
  outstanding: number;
  creditLimit: number;
  paymentTermsDays?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  lastOrderDate: string;
  lastOrderValue: number;
  nextFollowUpDate?: string;
  lcExpiryDate?: string;
  termEndDate?: string;
  tags: string[];
  fields: PartyField[];
  history: { date: string; text: string; value?: string }[];
}
export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  stock: number;
  reorderLevel?: number;
  expiryDate?: string;
  expiryAlertDays?: number;
  isRecalled?: boolean;
  recallReason?: string;
  qcStatus?: 'pending' | 'passed' | 'failed';
  attributes: PartyField[];
  barcode: string;
}
export interface AutomationRule {
  id: string;
  label: string;
  trigger: 'low_stock' | 'expiry_window' | 'overdue_payment' | 'no_visit_days' | 'recall' | 'lc_expiry' | 'quality_hold' | 'term_rollover';
  thresholdValue: number;
  action: string;
}

export interface AutomationAlert {
  id: string;
  ruleId: string;
  severity: 'info' | 'warn' | 'critical';
  message: string;
  relatedPartyId?: string;
  relatedItemId?: string;
}

export interface SchemeRule {
  id: string;
  label: string;
  minQty: number;
  discountPercent: number;
  note: string;
}

export type VisitStatus = 'pending' | 'checked_in' | 'completed' | 'skipped';

export interface VisitStop {
  id: string;
  partyId: string;
  beatId: string;
  scheduledTime: string;
  status: VisitStatus;
  purpose: string;
  checkinTime?: string;
  checkinLocation?: string;
}

export interface OrderLineRecord {
  itemName: string;
  qty: number;
  rate: number;
  discountPercent: number;
  schemeLabel?: string;
  total: number;
}

export interface OrderRecord {
  id: string;
  orderNo: string;
  partyId: string;
  lines: OrderLineRecord[];
  total: number;
  createdAt: string;
}

export interface CollectionRecord {
  id: string;
  partyId: string;
  amount: number;
  mode: string;
  reference: string;
  createdAt: string;
}

export interface ReturnRecord {
  id: string;
  partyId: string;
  itemName: string;
  qty: number;
  reason: string;
  kind: 'return' | 'damage';
  createdAt: string;
}

export interface FollowUpRecord {
  id: string;
  partyId: string;
  title: string;
  dueDate: string;
  status: 'pending' | 'done';
}

export interface ActivityEvent {
  id: string;
  time: string;
  text: string;
  kind: 'checkin' | 'order' | 'collection' | 'return' | 'followup' | 'checkout' | 'target';
}

export interface TargetRecord {
  label: string;
  achieved: number;
  target: number;
  unit: string;
}

export interface IndustryTerms {
  repLabel: string;
  beatLabel: string;
  beatLabelPlural: string;
  partyLabel: string;
  partyLabelPlural: string;
  visitLabel: string;
  itemLabel: string;
  itemLabelPlural: string;
  orderLabel: string;
  scanLabel: string;
  schemeLabel: string;
  stockLabel: string;
}

export interface IndustryConfig {
  key: IndustryKey;
  label: string;
  tagline: string;
  colorVar: string;
  terms: IndustryTerms;
  workflow: string[];
  kpis: Kpi[];
  beats: Beat[];
  parties: Party[];
  catalog: CatalogItem[];
  catalogColumns: { key: string; label: string }[];
  schemes: SchemeRule[];
  visitsToday: VisitStop[];
  targets: TargetRecord[];
  activity: ActivityEvent[];
  followUps: FollowUpRecord[];
  automationRules: AutomationRule[];
}