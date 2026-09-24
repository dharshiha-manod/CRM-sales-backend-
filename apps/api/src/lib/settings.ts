import { supabaseAdmin } from './supabase.js';

// This fetches the ENTIRE settings blob for one organization.
// Every "getXConfig" function below reuses this — don't call it directly elsewhere.
async function getSettingsBlob(organizationId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from('organization_settings')
    .select('settings')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data?.settings as Record<string, unknown>) ?? {};
}

export interface OrderConfig {
  statuses: string[];
  approvalRequired: boolean;
  minOrderValue: number;
  numberingFormat: string;
  allowEditing: boolean;
  allowCancellation: boolean;
}

// If the org never saved Settings yet, we fall back to these safe defaults
// (same defaults your frontend already shows in SettingsPage).
const DEFAULT_ORDER_CONFIG: OrderConfig = {
  statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Completed', 'Cancelled'],
  approvalRequired: true,
  minOrderValue: 500,
  numberingFormat: 'SO-{YYYY}-{0000}',
  allowEditing: true,
  allowCancellation: true,
};

export async function getOrderConfig(organizationId: string): Promise<OrderConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_ORDER_CONFIG, ...(blob.order as Partial<OrderConfig> | undefined) };
}
export interface SalesConfig {
  stages: string[];
  orderNumberingPrefix: string;
  autoAssignCustomers: boolean;
  autoAssignReps: boolean;
  approvalRequiredAboveValue: number;
  defaultPaymentTermsDays: number;
}

const DEFAULT_SALES_CONFIG: SalesConfig = {
  stages: ['Lead', 'Requirement', 'Quotation', 'Order', 'Won'],
  orderNumberingPrefix: 'SO-2026-',
  autoAssignCustomers: true,
  autoAssignReps: false,
  approvalRequiredAboveValue: 50000,
  defaultPaymentTermsDays: 15,
};

export async function getSalesConfig(organizationId: string): Promise<SalesConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_SALES_CONFIG, ...(blob.sales as Partial<SalesConfig> | undefined) };
}
export interface CollectionConfig {
  statuses: string[];
  paymentMethods: Record<string, boolean>;
  approvalRequired: boolean;
  overdueThresholdDays: number;
  receiptRequired: boolean;
}

const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  statuses: ['Pending', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
  paymentMethods: { Cash: true, UPI: true, 'Bank Transfer': true, Cheque: true, Other: false },
  approvalRequired: false,
  overdueThresholdDays: 7,
  receiptRequired: true,
};

export async function getCollectionConfig(organizationId: string): Promise<CollectionConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_COLLECTION_CONFIG, ...(blob.collection as Partial<CollectionConfig> | undefined) };
}
export interface FollowUpConfig {
  types: Record<string, boolean>;
  defaultDurationDays: number;
  overdueAlerts: boolean;
  reminderBeforeHours: number;
}

const DEFAULT_FOLLOW_UP_CONFIG: FollowUpConfig = {
  types: { Call: true, Visit: true, WhatsApp: true, Email: false, Meeting: true, Other: false },
  defaultDurationDays: 3,
  overdueAlerts: true,
  reminderBeforeHours: 24,
};

export async function getFollowUpConfig(organizationId: string): Promise<FollowUpConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_FOLLOW_UP_CONFIG, ...(blob.followUp as Partial<FollowUpConfig> | undefined) };
}

export interface VisitConfig {
  types: string[]; statuses: string[]; mandatoryCheckin: boolean; mandatoryCheckout: boolean;
  minDurationMinutes: number; requireNotes: boolean; radiusMeters: number; mandatoryGpsVerification: boolean;
}

const DEFAULT_VISIT_CONFIG: VisitConfig = {
  types: ['Sales Call', 'Collection', 'Delivery', 'Survey'], statuses: ['Pending', 'Checked-in', 'Completed', 'Skipped'],
  mandatoryCheckin: true, mandatoryCheckout: true, minDurationMinutes: 5, requireNotes: true,
  radiusMeters: 100, mandatoryGpsVerification: true,
};

export async function getVisitConfig(organizationId: string): Promise<VisitConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_VISIT_CONFIG, ...(blob.visit as Partial<VisitConfig> | undefined) };
}

export interface TrackingRulesConfig {
  pingIntervalMinutes: number; idleAlertAfterMinutes: number; geofenceAlerts: boolean; retainHistoryDays: number;
}

const DEFAULT_TRACKING_RULES_CONFIG: TrackingRulesConfig = {
  pingIntervalMinutes: 5, idleAlertAfterMinutes: 30, geofenceAlerts: true, retainHistoryDays: 90,
};

export async function getTrackingRulesConfig(organizationId: string): Promise<TrackingRulesConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_TRACKING_RULES_CONFIG, ...(blob.tracking as Partial<TrackingRulesConfig> | undefined) };
}

export interface GpsConfig {
  verificationEnabled: boolean; minAccuracyMeters: number;
  allowOfflineCapture: boolean; trackDuringActiveVisit: boolean;
}

const DEFAULT_GPS_CONFIG: GpsConfig = {
  verificationEnabled: true, minAccuracyMeters: 50,
  allowOfflineCapture: true, trackDuringActiveVisit: true,
};

export async function getGpsConfig(organizationId: string): Promise<GpsConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_GPS_CONFIG, ...(blob.gps as Partial<GpsConfig> | undefined) };
}

export interface CheckInOutConfig {
  requirePhotoAtCheckin: boolean; requireSignatureAtCheckout: boolean;
  allowManualOverride: boolean; autoCheckoutAfterMinutes: number;
}

const DEFAULT_CHECK_IN_OUT_CONFIG: CheckInOutConfig = {
  requirePhotoAtCheckin: false, requireSignatureAtCheckout: false,
  allowManualOverride: true, autoCheckoutAfterMinutes: 120,
};

export async function getCheckInOutConfig(organizationId: string): Promise<CheckInOutConfig> {
  const blob = await getSettingsBlob(organizationId);
  return { ...DEFAULT_CHECK_IN_OUT_CONFIG, ...(blob.checkInOut as Partial<CheckInOutConfig> | undefined) };
}