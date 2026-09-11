import type { IndustryKey } from '../industry/types';

export type SectionId =
  | 'organization' | 'industry' | 'localization' | 'workingHours'
  | 'roles' | 'userPreferences'
  | 'salesConfig' | 'visitConfig' | 'targetConfig' | 'orderConfig' | 'collectionConfig' | 'followUpConfig'
  | 'gps' | 'checkInOut' | 'trackingRules'
  | 'inventoryConfig' | 'stockRules' | 'expiryBatch'
  | 'notifications' | 'callsIvr'
  | 'dataDisplay' | 'auditLog';

export type RoleView = 'admin' | 'manager' | 'salesRep';
export type PermissionLevel = 'full' | 'team' | 'own' | 'view' | 'assigned' | 'none';

export interface OrganizationSettings {
  name: string; code: string; logoInitials: string; email: string; phone: string;
  address: string; country: string; timeZone: string; currency: string; dateFormat: string;
  lastUpdated: string;
}

export interface LocalizationSettings {
  currency: string; timeZone: string; dateFormat: string; timeFormat: '12-hour' | '24-hour';
  numberFormat: string; language: string;
}

export interface WorkingHoursSettings {
  workingDays: string[]; startTime: string; endTime: string;
  breakStart: string; breakEnd: string; weekends: string[]; holidays: { date: string; label: string }[];
}

export interface PermissionMatrixRow {
  module: string;
  admin: PermissionLevel; manager: PermissionLevel; salesRep: PermissionLevel;
  support: PermissionLevel; inventoryStaff: PermissionLevel;
}

export interface UserPreferences {
  density: 'comfortable' | 'compact'; defaultLandingPage: string; language: string; emailDigest: boolean;
}

export interface SalesConfig {
  stages: string[]; orderNumberingPrefix: string; autoAssignCustomers: boolean;
  autoAssignReps: boolean; approvalRequiredAboveValue: number; defaultPaymentTermsDays: number;
}

export interface VisitConfig {
  types: string[]; statuses: string[]; mandatoryCheckin: boolean; mandatoryCheckout: boolean;
  minDurationMinutes: number; requireNotes: boolean; radiusMeters: number; mandatoryGpsVerification: boolean;
}

export interface TargetConfig {
  types: { label: string; enabled: boolean }[]; defaultPeriod: 'Weekly' | 'Monthly' | 'Quarterly';
  atRiskBelowPercent: number; onTrackBelowPercent: number; achievedAtPercent: number;
}

export interface OrderConfig {
  statuses: string[]; approvalRequired: boolean; minOrderValue: number;
  numberingFormat: string; allowEditing: boolean; allowCancellation: boolean;
}

export interface CollectionConfig {
  statuses: string[]; paymentMethods: Record<string, boolean>; approvalRequired: boolean;
  overdueThresholdDays: number; receiptRequired: boolean;
}

export interface FollowUpConfig {
  types: Record<string, boolean>; defaultDurationDays: number; overdueAlerts: boolean; reminderBeforeHours: number;
}

export interface GpsConfig {
  verificationEnabled: boolean; radiusMeters: number; minAccuracyMeters: number;
  requireCheckinGps: boolean; requireCheckoutGps: boolean; allowOfflineCapture: boolean; trackDuringActiveVisit: boolean;
}

export interface CheckInOutConfig {
  requirePhotoAtCheckin: boolean; requireSignatureAtCheckout: boolean;
  allowManualOverride: boolean; autoCheckoutAfterMinutes: number;
}

export interface TrackingRulesConfig {
  pingIntervalMinutes: number; idleAlertAfterMinutes: number; geofenceAlerts: boolean; retainHistoryDays: number;
}

export interface InventoryConfigSettings {
  minStockThreshold: number; lowStockAlert: boolean; expiryAlert: boolean; expiryWarningDays: number;
  batchTracking: boolean; allowStockAdjustment: boolean; allowStockTransfer: boolean; repStockAssignment: boolean;
}

export interface StockRulesConfig {
  valuationMethod: 'FIFO' | 'LIFO' | 'Weighted Average'; negativeStockAllowed: boolean; reorderAutoSuggest: boolean;
}

export interface ExpiryBatchConfig {
  batchMandatory: boolean; expiryMandatory: boolean; blockSaleWithinDaysOfExpiry: number;
}

export interface NotificationRow {
  category: string; inApp: boolean; email: boolean; sms: boolean;
}

export interface CallsIvrSettings {
  providerConnected: boolean; providerName: string;
}

export interface DataDisplaySettings {
  pageSize: number; density: 'compact' | 'comfortable'; defaultDashboard: string;
  defaultLandingPage: string; showInactiveRecords: boolean; confirmBeforeDelete: boolean; autoRefresh: boolean;
}

export interface AuditLogEntry {
  date: string; user: string; action: string; module: string; record: string; status: 'Successful' | 'Failed';
}

export interface IndustryFieldRow { label: string; value: string }

export interface SettingsState {
  organization: OrganizationSettings;
  localization: LocalizationSettings;
  workingHours: WorkingHoursSettings;
  permissionMatrix: PermissionMatrixRow[];
  userPreferences: UserPreferences;
  sales: SalesConfig;
  visit: VisitConfig;
  target: TargetConfig;
  order: OrderConfig;
  collection: CollectionConfig;
  followUp: FollowUpConfig;
  gps: GpsConfig;
  checkInOut: CheckInOutConfig;
  tracking: TrackingRulesConfig;
  inventory: InventoryConfigSettings;
  stockRules: StockRulesConfig;
  expiryBatch: ExpiryBatchConfig;
  notifications: NotificationRow[];
  callsIvr: CallsIvrSettings;
  dataDisplay: DataDisplaySettings;
  industrySpecific: Record<IndustryKey, IndustryFieldRow[]>;
}

export const AUDIT_LOG: AuditLogEntry[] = [
  { date: '03 Sep 2026', user: 'Admin', action: 'Updated GPS Radius', module: 'GPS Settings', record: 'Visit Configuration', status: 'Successful' },
  { date: '02 Sep 2026', user: 'Admin', action: 'Changed Industry to FMCG', module: 'Industry Configuration', record: 'Global Settings', status: 'Successful' },
  { date: '01 Sep 2026', user: 'Priya M.', action: 'Updated Collection Overdue Threshold', module: 'Collection Configuration', record: 'Sales CRM', status: 'Successful' },
  { date: '30 Aug 2026', user: 'Admin', action: 'Added Manager role permission', module: 'Roles & Permissions', record: 'Users & Access', status: 'Successful' },
  { date: '29 Aug 2026', user: 'Karthik R.', action: 'Attempted to edit Organization Settings', module: 'Organization', record: 'General', status: 'Failed' },
];

function defaultIndustryRows(): Record<IndustryKey, IndustryFieldRow[]> {
  return {
    school: [
      { label: 'Academic Year', value: '2026 - 2027' },
      { label: 'Department', value: 'K-12 Sales' },
      { label: 'School Type', value: 'Private, Government, Matriculation' },
      { label: 'Student / Institution Fields', value: 'Strength, Board, Contact Person' },
    ],
    pharma: [
      { label: 'Medicine Fields', value: 'Composition, Schedule, Manufacturer' },
      { label: 'Batch Requirements', value: 'Mandatory on every SKU' },
      { label: 'Expiry Requirements', value: 'Mandatory, 90-day alert window' },
      { label: 'Drug Category', value: 'OTC, Prescription, Narcotic' },
    ],
    fmcg: [
      { label: 'Brand', value: 'Enabled as a filter field' },
      { label: 'SKU', value: 'Auto-generated, editable' },
      { label: 'Pack Size', value: 'Case, Carton, Piece' },
      { label: 'Batch', value: 'Optional' },
      { label: 'Expiry', value: 'Optional, 30-day alert window' },
    ],
    trading: [
      { label: 'Item Category', value: 'Commodity, Manufactured, Service' },
      { label: 'Trading Type', value: 'Import, Export, Domestic' },
      { label: 'Purchase / Sales Fields', value: 'Incoterm, LC Reference, Vendor' },
    ],
    textile: [
      { label: 'Fabric Type', value: 'Cotton, Silk, Blended, Synthetic' },
      { label: 'Color', value: 'Enabled as a variant field' },
      { label: 'Size', value: 'Enabled as a variant field' },
      { label: 'Roll / Bundle', value: 'Tracked by roll number' },
      { label: 'Unit', value: 'Meters, Yards, Pieces' },
    ],
    vehicle: [
      { label: 'Vehicle Category', value: 'Two-wheeler, Car, Commercial' },
      { label: 'VIN / Chassis Tracking', value: 'Mandatory' },
      { label: 'Warranty Fields', value: 'Duration, Coverage Type' },
    ],
  };
}

export function createInitialSettingsState(): SettingsState {
  return {
    organization: {
      name: 'Manod Field Sales Pvt. Ltd.', code: 'MFS-001', logoInitials: 'MF',
      email: 'admin@manodfieldsales.com', phone: '+91 98400 11234',
      address: 'No. 14, Anna Nagar 2nd Avenue, Chennai, Tamil Nadu 600040',
      country: 'India', timeZone: 'Asia/Kolkata', currency: 'INR (₹)', dateFormat: 'DD/MM/YYYY',
      lastUpdated: '02 Sep 2026, 6:40 PM',
    },
    localization: {
      currency: 'INR (₹)', timeZone: 'Asia/Kolkata', dateFormat: 'DD/MM/YYYY',
      timeFormat: '12-hour', numberFormat: '1,23,456.78 (Indian)', language: 'English',
    },
    workingHours: {
      workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      startTime: '09:00 AM', endTime: '06:00 PM', breakStart: '01:00 PM', breakEnd: '02:00 PM',
      weekends: ['Sun'], holidays: [{ date: '02 Oct 2026', label: 'Gandhi Jayanti' }, { date: '25 Dec 2026', label: 'Christmas' }],
    },
    permissionMatrix: [
      { module: 'Dashboard', admin: 'full', manager: 'full', salesRep: 'full', support: 'view', inventoryStaff: 'view' },
      { module: 'Customers', admin: 'full', manager: 'team', salesRep: 'own', support: 'view', inventoryStaff: 'view' },
      { module: 'Orders', admin: 'full', manager: 'team', salesRep: 'own', support: 'view', inventoryStaff: 'view' },
      { module: 'Collections', admin: 'full', manager: 'team', salesRep: 'own', support: 'view', inventoryStaff: 'view' },
      { module: 'Inventory', admin: 'full', manager: 'team', salesRep: 'assigned', support: 'view', inventoryStaff: 'full' },
      { module: 'Target', admin: 'full', manager: 'team', salesRep: 'own', support: 'none', inventoryStaff: 'none' },
      { module: 'GPS Tracking', admin: 'full', manager: 'team', salesRep: 'own', support: 'none', inventoryStaff: 'none' },
      { module: 'Reports', admin: 'full', manager: 'team', salesRep: 'own', support: 'none', inventoryStaff: 'team' },
    ],
    userPreferences: { density: 'comfortable', defaultLandingPage: 'Dashboard', language: 'English', emailDigest: true },
    sales: {
      stages: ['Lead', 'Requirement', 'Quotation', 'Order', 'Won'], orderNumberingPrefix: 'SO-2026-',
      autoAssignCustomers: true, autoAssignReps: false, approvalRequiredAboveValue: 50000, defaultPaymentTermsDays: 15,
    },
    visit: {
      types: ['Sales Call', 'Collection', 'Delivery', 'Survey'], statuses: ['Pending', 'Checked-in', 'Completed', 'Skipped'],
      mandatoryCheckin: true, mandatoryCheckout: true, minDurationMinutes: 5, requireNotes: true,
      radiusMeters: 100, mandatoryGpsVerification: true,
    },
    target: {
      types: [
        { label: 'Sales Amount', enabled: true }, { label: 'Order Value', enabled: true }, { label: 'Order Count', enabled: false },
        { label: 'Collection Amount', enabled: true }, { label: 'Visit Count', enabled: true }, { label: 'New Customers', enabled: false },
      ],
      defaultPeriod: 'Monthly', atRiskBelowPercent: 60, onTrackBelowPercent: 99, achievedAtPercent: 100,
    },
    order: {
      statuses: ['Draft', 'Submitted', 'Approved', 'Rejected', 'Completed', 'Cancelled'],
      approvalRequired: true, minOrderValue: 500, numberingFormat: 'SO-{YYYY}-{0000}', allowEditing: true, allowCancellation: true,
    },
    collection: {
      statuses: ['Pending', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
      paymentMethods: { Cash: true, UPI: true, 'Bank Transfer': true, Cheque: true, Other: false },
      approvalRequired: false, overdueThresholdDays: 7, receiptRequired: true,
    },
    followUp: {
      types: { Call: true, Visit: true, WhatsApp: true, Email: false, Meeting: true, Other: false },
      defaultDurationDays: 3, overdueAlerts: true, reminderBeforeHours: 24,
    },
    gps: {
      verificationEnabled: true, radiusMeters: 100, minAccuracyMeters: 50,
      requireCheckinGps: true, requireCheckoutGps: true, allowOfflineCapture: true, trackDuringActiveVisit: true,
    },
    checkInOut: { requirePhotoAtCheckin: false, requireSignatureAtCheckout: false, allowManualOverride: true, autoCheckoutAfterMinutes: 120 },
    tracking: { pingIntervalMinutes: 5, idleAlertAfterMinutes: 30, geofenceAlerts: true, retainHistoryDays: 90 },
    inventory: {
      minStockThreshold: 20, lowStockAlert: true, expiryAlert: true, expiryWarningDays: 30,
      batchTracking: true, allowStockAdjustment: true, allowStockTransfer: true, repStockAssignment: true,
    },
    stockRules: { valuationMethod: 'FIFO', negativeStockAllowed: false, reorderAutoSuggest: true },
    expiryBatch: { batchMandatory: true, expiryMandatory: true, blockSaleWithinDaysOfExpiry: 7 },
    notifications: [
      { category: 'New Order', inApp: true, email: true, sms: false },
      { category: 'Collection Received', inApp: true, email: true, sms: false },
      { category: 'Collection Overdue', inApp: true, email: true, sms: true },
      { category: 'Follow-up Reminder', inApp: true, email: false, sms: false },
      { category: 'Low Stock', inApp: true, email: true, sms: false },
      { category: 'Expiry Alert', inApp: true, email: true, sms: false },
      { category: 'GPS Exception', inApp: true, email: false, sms: false },
      { category: 'Target Alert', inApp: true, email: true, sms: false },
      { category: 'Stock Request', inApp: true, email: false, sms: false },
      { category: 'User Activity', inApp: false, email: false, sms: false },
    ],
    callsIvr: { providerConnected: false, providerName: 'Not Connected' },
    dataDisplay: {
      pageSize: 25, density: 'comfortable', defaultDashboard: 'Sales Overview', defaultLandingPage: 'Dashboard',
      showInactiveRecords: false, confirmBeforeDelete: true, autoRefresh: false,
    },
    industrySpecific: defaultIndustryRows(),
  };
}
