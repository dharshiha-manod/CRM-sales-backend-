import type { CheckInOutConfig, GpsConfig, TrackingRulesConfig } from './types';
import { Field, SubSection, Toggle } from './ui';
export function GpsLocationSection({ value, onChange }: { value: GpsConfig; onChange: (next: GpsConfig) => void }) {
  return (
    <SubSection title="Field Visit Verification & Operations Tracking" description="Keeps location data accurate during active visits. Visit radius and required-GPS toggles now live under Field Ops → Visit Configuration.">
      <div className="settings-form-grid">
        <Field label="GPS verification" inline><Toggle checked={value.verificationEnabled} onChange={(next) => onChange({ ...value, verificationEnabled: next })} /></Field>
        <Field label="Minimum GPS accuracy (meters)"><input type="number" value={value.minAccuracyMeters} onChange={(e) => onChange({ ...value, minAccuracyMeters: Number(e.target.value) })} /></Field>
        <Field label="Allow offline capture" inline><Toggle checked={value.allowOfflineCapture} onChange={(next) => onChange({ ...value, allowOfflineCapture: next })} /></Field>
        <Field label="Track location during active visit" inline><Toggle checked={value.trackDuringActiveVisit} onChange={(next) => onChange({ ...value, trackDuringActiveVisit: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function CheckInOutSection({ value, onChange }: { value: CheckInOutConfig; onChange: (next: CheckInOutConfig) => void }) {
  return (
    <SubSection title="Check-in / Check-out" description="Additional evidence and overrides for visit check-in and check-out.">
      <div className="settings-form-grid">
        <Field label="Require photo at check-in" inline><Toggle checked={value.requirePhotoAtCheckin} onChange={(next) => onChange({ ...value, requirePhotoAtCheckin: next })} /></Field>
        <Field label="Require signature at check-out" inline><Toggle checked={value.requireSignatureAtCheckout} onChange={(next) => onChange({ ...value, requireSignatureAtCheckout: next })} /></Field>
        <Field label="Allow manual override by manager" inline><Toggle checked={value.allowManualOverride} onChange={(next) => onChange({ ...value, allowManualOverride: next })} /></Field>
        <Field label="Auto check-out after (minutes)"><input type="number" value={value.autoCheckoutAfterMinutes} onChange={(e) => onChange({ ...value, autoCheckoutAfterMinutes: Number(e.target.value) })} /></Field>
      </div>
    </SubSection>
  );
}

export function TrackingRulesSection({ value, onChange }: { value: TrackingRulesConfig; onChange: (next: TrackingRulesConfig) => void }) {
  return (
    <SubSection title="Tracking Rules" description="How often location is captured and how long history is retained.">
      <div className="settings-form-grid">
        <Field label="Location ping interval (minutes)"><input type="number" value={value.pingIntervalMinutes} onChange={(e) => onChange({ ...value, pingIntervalMinutes: Number(e.target.value) })} /></Field>
        <Field label="Idle alert after (minutes)"><input type="number" value={value.idleAlertAfterMinutes} onChange={(e) => onChange({ ...value, idleAlertAfterMinutes: Number(e.target.value) })} /></Field>
        <Field label="Retain location history (days)"><input type="number" value={value.retainHistoryDays} onChange={(e) => onChange({ ...value, retainHistoryDays: Number(e.target.value) })} /></Field>
        <Field label="Geofence exit/entry alerts" inline><Toggle checked={value.geofenceAlerts} onChange={(next) => onChange({ ...value, geofenceAlerts: next })} /></Field>
      </div>
    </SubSection>
  );
}
