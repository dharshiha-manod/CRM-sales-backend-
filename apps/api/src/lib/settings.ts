import { supabaseAdmin } from './supabase.js';

type Blob = Record<string, unknown>;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// This fetches the ENTIRE settings blob for one organization.
// Every "getXConfig" function below reuses this — don't call it directly elsewhere.
async function getSettingsBlob(organizationId: string): Promise<Blob> {
  const { data, error } = await supabaseAdmin
    .from('organization_settings')
    .select('settings')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data?.settings as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Per-industry settings
//
// The blob keeps its original top-level sections (sales, order, visit, ...).
// Those are the ORG-WIDE BASE every industry starts from. An industry that has
// been given its own values stores them under blob.byIndustry[<industry code>]
// [<section>], and those win over the base for that industry only. So:
//   - an industry nobody has customised behaves exactly as before, and
//   - changing Trading's Order settings can never reach FMCG, Pharma, etc.
// Pass the `industry_type_id` of the record being processed (a client's, a
// lead's, ...). Omit it and you get the org-wide base, i.e. the old behaviour.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 60_000;
const codeCache = new Map<string, { code: string | null; at: number }>();

/** industry_types.code (lower-cased, e.g. 'trading') for an industry_type_id, or null when unknown. */
async function industryKeyOf(organizationId: string, industryTypeId?: string | null): Promise<string | null> {
  if (!industryTypeId) return null;
  const cacheKey = `${organizationId}:${industryTypeId}`;
  const hit = codeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CODE_TTL_MS) return hit.code;
  const { data, error } = await supabaseAdmin
    .from('industry_types')
    .select('code')
    .eq('organization_id', organizationId)
    .eq('id', industryTypeId)
    .maybeSingle();
  if (error) throw error;
  const code = data?.code ? String(data.code).toLowerCase() : null;
  codeCache.set(cacheKey, { code, at: Date.now() });
  return code;
}

/** defaults < org-wide base < this industry's own override. */
function resolveSection<T extends object>(blob: Blob, section: string, defaults: T, industryKey: string | null): T {
  const base = isRecord(blob[section]) ? (blob[section] as Blob) : {};
  const byIndustry = isRecord(blob.byIndustry) ? (blob.byIndustry as Blob) : {};
  const industryBlock = industryKey && isRecord(byIndustry[industryKey]) ? (byIndustry[industryKey] as Blob) : {};
  const override = isRecord(industryBlock[section]) ? (industryBlock[section] as Blob) : {};
  return { ...defaults, ...base, ...override } as T;
}

/** Client's industry_type_id — for choosing which industry's settings apply to work done on that client. */
export async function industryTypeIdOfClient(organizationId: string, clientId?: string | null): Promise<string | null> {
  if (!clientId) return null;
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('industry_type_id')
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return (data?.industry_type_id as string | null | undefined) ?? null;
}

/** Industry of the client a field visit belongs to (null for a visit to an unlisted client). */
export async function industryTypeIdOfVisit(organizationId: string, visitId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('field_visits')
    .select('clients(industry_type_id)')
    .eq('id', visitId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  const related = (data as { clients?: unknown } | null)?.clients;
  const client = (Array.isArray(related) ? related[0] : related) as { industry_type_id?: string | null } | null | undefined;
  return client?.industry_type_id ?? null;
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

export async function getOrderConfig(organizationId: string, industryTypeId?: string | null): Promise<OrderConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'order', DEFAULT_ORDER_CONFIG, await industryKeyOf(organizationId, industryTypeId));
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

export async function getSalesConfig(organizationId: string, industryTypeId?: string | null): Promise<SalesConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'sales', DEFAULT_SALES_CONFIG, await industryKeyOf(organizationId, industryTypeId));
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

export async function getCollectionConfig(organizationId: string, industryTypeId?: string | null): Promise<CollectionConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'collection', DEFAULT_COLLECTION_CONFIG, await industryKeyOf(organizationId, industryTypeId));
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

export async function getFollowUpConfig(organizationId: string, industryTypeId?: string | null): Promise<FollowUpConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'followUp', DEFAULT_FOLLOW_UP_CONFIG, await industryKeyOf(organizationId, industryTypeId));
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

export async function getVisitConfig(organizationId: string, industryTypeId?: string | null): Promise<VisitConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'visit', DEFAULT_VISIT_CONFIG, await industryKeyOf(organizationId, industryTypeId));
}

export interface TrackingRulesConfig {
  pingIntervalMinutes: number; idleAlertAfterMinutes: number; geofenceAlerts: boolean; retainHistoryDays: number;
}

const DEFAULT_TRACKING_RULES_CONFIG: TrackingRulesConfig = {
  pingIntervalMinutes: 5, idleAlertAfterMinutes: 30, geofenceAlerts: true, retainHistoryDays: 90,
};

export async function getTrackingRulesConfig(organizationId: string, industryTypeId?: string | null): Promise<TrackingRulesConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'tracking', DEFAULT_TRACKING_RULES_CONFIG, await industryKeyOf(organizationId, industryTypeId));
}

export interface GpsConfig {
  verificationEnabled: boolean; minAccuracyMeters: number;
  allowOfflineCapture: boolean; trackDuringActiveVisit: boolean;
}

const DEFAULT_GPS_CONFIG: GpsConfig = {
  verificationEnabled: true, minAccuracyMeters: 50,
  allowOfflineCapture: true, trackDuringActiveVisit: true,
};

export async function getGpsConfig(organizationId: string, industryTypeId?: string | null): Promise<GpsConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'gps', DEFAULT_GPS_CONFIG, await industryKeyOf(organizationId, industryTypeId));
}

export interface CheckInOutConfig {
  requirePhotoAtCheckin: boolean; requireSignatureAtCheckout: boolean;
  allowManualOverride: boolean; autoCheckoutAfterMinutes: number;
}

const DEFAULT_CHECK_IN_OUT_CONFIG: CheckInOutConfig = {
  requirePhotoAtCheckin: false, requireSignatureAtCheckout: false,
  allowManualOverride: true, autoCheckoutAfterMinutes: 120,
};

export async function getCheckInOutConfig(organizationId: string, industryTypeId?: string | null): Promise<CheckInOutConfig> {
  const blob = await getSettingsBlob(organizationId);
  return resolveSection(blob, 'checkInOut', DEFAULT_CHECK_IN_OUT_CONFIG, await industryKeyOf(organizationId, industryTypeId));
}

// ---------------------------------------------------------------------------
// Snapshot: one read of the blob + industry list, for the few jobs that sweep
// records from EVERY industry in one pass (overdue follow-ups, auto check-out,
// live idle alerts) and so need each industry's own values without issuing a
// database round-trip per record.
// ---------------------------------------------------------------------------
export interface SettingsSnapshot {
  industryTypeIds: string[];
  followUp(industryTypeId?: string | null): FollowUpConfig;
  collection(industryTypeId?: string | null): CollectionConfig;
  checkInOut(industryTypeId?: string | null): CheckInOutConfig;
  tracking(industryTypeId?: string | null): TrackingRulesConfig;
}

export async function loadSettingsSnapshot(organizationId: string): Promise<SettingsSnapshot> {
  const blob = await getSettingsBlob(organizationId);
  const { data, error } = await supabaseAdmin.from('industry_types').select('id, code').eq('organization_id', organizationId);
  if (error) throw error;
  const keyById = new Map<string, string>((data ?? []).map((row) => [String(row.id), String(row.code).toLowerCase()]));
  const keyOf = (id?: string | null) => (id ? keyById.get(id) ?? null : null);
  return {
    industryTypeIds: [...keyById.keys()],
    followUp: (id) => resolveSection(blob, 'followUp', DEFAULT_FOLLOW_UP_CONFIG, keyOf(id)),
    collection: (id) => resolveSection(blob, 'collection', DEFAULT_COLLECTION_CONFIG, keyOf(id)),
    checkInOut: (id) => resolveSection(blob, 'checkInOut', DEFAULT_CHECK_IN_OUT_CONFIG, keyOf(id)),
    tracking: (id) => resolveSection(blob, 'tracking', DEFAULT_TRACKING_RULES_CONFIG, keyOf(id)),
  };
}
