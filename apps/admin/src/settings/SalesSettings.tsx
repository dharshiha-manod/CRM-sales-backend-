import type { CollectionConfig, FollowUpConfig, OrderConfig, SalesConfig, TargetConfig, VisitConfig } from './types';
import { Field, SubSection, Toggle } from './ui';

export function SalesConfigSection({ value, onChange }: { value: SalesConfig; onChange: (next: SalesConfig) => void }) {
  return (
    <SubSection title="Sales Configuration" description="Defaults applied across the sales pipeline.">
      <Field label="Sales stages" hint="Comma-separated, in pipeline order.">
        <input value={value.stages.join(', ')} onChange={(e) => onChange({ ...value, stages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </Field>
      <div className="settings-form-grid">
        <Field label="Order numbering prefix"><input value={value.orderNumberingPrefix} onChange={(e) => onChange({ ...value, orderNumberingPrefix: e.target.value })} /></Field>
        <Field label="Approval required above value (₹)">
          <input type="number" value={value.approvalRequiredAboveValue} onChange={(e) => onChange({ ...value, approvalRequiredAboveValue: Number(e.target.value) })} />
        </Field>
        <Field label="Default payment terms (days)">
          <input type="number" value={value.defaultPaymentTermsDays} onChange={(e) => onChange({ ...value, defaultPaymentTermsDays: Number(e.target.value) })} />
        </Field>
        <Field label="Auto-assign customers to reps" inline><Toggle checked={value.autoAssignCustomers} onChange={(next) => onChange({ ...value, autoAssignCustomers: next })} /></Field>
        <Field label="Auto-assign new sales reps to a manager" inline><Toggle checked={value.autoAssignReps} onChange={(next) => onChange({ ...value, autoAssignReps: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function VisitConfigSection({ value, onChange }: { value: VisitConfig; onChange: (next: VisitConfig) => void }) {
  return (
    <SubSection title="Visit Configuration" description="Rules applied to every field visit.">
      <div className="settings-form-grid">
        <Field label="Visit types" hint="Comma-separated."><input value={value.types.join(', ')} onChange={(e) => onChange({ ...value, types: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="Visit statuses" hint="Comma-separated."><input value={value.statuses.join(', ')} onChange={(e) => onChange({ ...value, statuses: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
        <Field label="Customer visit radius (meters)"><input type="number" value={value.radiusMeters} onChange={(e) => onChange({ ...value, radiusMeters: Number(e.target.value) })} /></Field>
        <Field label="Minimum visit duration (minutes)"><input type="number" value={value.minDurationMinutes} onChange={(e) => onChange({ ...value, minDurationMinutes: Number(e.target.value) })} /></Field>
        <Field label="Mandatory GPS verification" inline><Toggle checked={value.mandatoryGpsVerification} onChange={(next) => onChange({ ...value, mandatoryGpsVerification: next })} /></Field>
        <Field label="Mandatory check-in" inline><Toggle checked={value.mandatoryCheckin} onChange={(next) => onChange({ ...value, mandatoryCheckin: next })} /></Field>
        <Field label="Mandatory check-out" inline><Toggle checked={value.mandatoryCheckout} onChange={(next) => onChange({ ...value, mandatoryCheckout: next })} /></Field>
        <Field label="Require visit notes" inline><Toggle checked={value.requireNotes} onChange={(next) => onChange({ ...value, requireNotes: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function TargetConfigSection({ value, onChange }: { value: TargetConfig; onChange: (next: TargetConfig) => void }) {
  const toggleType = (label: string) => onChange({ ...value, types: value.types.map((t) => (t.label === label ? { ...t, enabled: !t.enabled } : t)) });
  return (
    <SubSection title="Target Configuration" description="Which target types are available, and how achievement is graded.">
      <Field label="Available target types">
        <div className="settings-chip-row">
          {value.types.map((t) => (
            <button key={t.label} type="button" className={t.enabled ? 'active' : ''} onClick={() => toggleType(t.label)}>{t.label}</button>
          ))}
        </div>
      </Field>
      <div className="settings-form-grid">
        <Field label="Default target period">
          <select value={value.defaultPeriod} onChange={(e) => onChange({ ...value, defaultPeriod: e.target.value as TargetConfig['defaultPeriod'] })}>
            <option>Weekly</option><option>Monthly</option><option>Quarterly</option>
          </select>
        </Field>
      </div>
      <table className="settings-mini-table">
        <thead><tr><th>Band</th><th>Range</th></tr></thead>
        <tbody>
          <tr><td>At Risk</td><td><input type="number" value={value.atRiskBelowPercent} onChange={(e) => onChange({ ...value, atRiskBelowPercent: Number(e.target.value) })} /> % and below</td></tr>
          <tr><td>On Track</td><td>{value.atRiskBelowPercent}% – {value.onTrackBelowPercent}%</td></tr>
          <tr><td>Achieved</td><td><input type="number" value={value.achievedAtPercent} onChange={(e) => onChange({ ...value, achievedAtPercent: Number(e.target.value) })} /> %</td></tr>
          <tr><td>Exceeded</td><td>Above {value.achievedAtPercent}%</td></tr>
        </tbody>
      </table>
    </SubSection>
  );
}

export function OrderConfigSection({ value, onChange }: { value: OrderConfig; onChange: (next: OrderConfig) => void }) {
  return (
    <SubSection title="Order Configuration" description="Order statuses, approvals and numbering.">
      <Field label="Order statuses" hint="Comma-separated, in workflow order."><input value={value.statuses.join(', ')} onChange={(e) => onChange({ ...value, statuses: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
      <div className="settings-form-grid">
        <Field label="Order numbering format"><input value={value.numberingFormat} onChange={(e) => onChange({ ...value, numberingFormat: e.target.value })} /></Field>
        <Field label="Minimum order value (₹)"><input type="number" value={value.minOrderValue} onChange={(e) => onChange({ ...value, minOrderValue: Number(e.target.value) })} /></Field>
        <Field label="Approval required" inline><Toggle checked={value.approvalRequired} onChange={(next) => onChange({ ...value, approvalRequired: next })} /></Field>
        <Field label="Allow order editing" inline><Toggle checked={value.allowEditing} onChange={(next) => onChange({ ...value, allowEditing: next })} /></Field>
        <Field label="Allow order cancellation" inline><Toggle checked={value.allowCancellation} onChange={(next) => onChange({ ...value, allowCancellation: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function CollectionConfigSection({ value, onChange }: { value: CollectionConfig; onChange: (next: CollectionConfig) => void }) {
  const toggleMethod = (method: string) => onChange({ ...value, paymentMethods: { ...value.paymentMethods, [method]: !value.paymentMethods[method] } });
  return (
    <SubSection title="Collection Configuration" description="Payment methods, statuses and overdue handling.">
      <Field label="Collection statuses" hint="Comma-separated."><input value={value.statuses.join(', ')} onChange={(e) => onChange({ ...value, statuses: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Field>
      <Field label="Payment methods">
        <div className="settings-chip-row">
          {Object.keys(value.paymentMethods).map((method) => (
            <button key={method} type="button" className={value.paymentMethods[method] ? 'active' : ''} onClick={() => toggleMethod(method)}>{method}</button>
          ))}
        </div>
      </Field>
      <div className="settings-form-grid">
        <Field label="Overdue threshold (days)"><input type="number" value={value.overdueThresholdDays} onChange={(e) => onChange({ ...value, overdueThresholdDays: Number(e.target.value) })} /></Field>
        <Field label="Approval required" inline><Toggle checked={value.approvalRequired} onChange={(next) => onChange({ ...value, approvalRequired: next })} /></Field>
        <Field label="Receipt required" inline><Toggle checked={value.receiptRequired} onChange={(next) => onChange({ ...value, receiptRequired: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function FollowUpConfigSection({ value, onChange }: { value: FollowUpConfig; onChange: (next: FollowUpConfig) => void }) {
  const toggleType = (type: string) => onChange({ ...value, types: { ...value.types, [type]: !value.types[type] } });
  return (
    <SubSection title="Follow-up Configuration" description="Follow-up types and reminder rules.">
      <Field label="Follow-up types">
        <div className="settings-chip-row">
          {Object.keys(value.types).map((type) => (
            <button key={type} type="button" className={value.types[type] ? 'active' : ''} onClick={() => toggleType(type)}>{type}</button>
          ))}
        </div>
      </Field>
      <div className="settings-form-grid">
        <Field label="Default follow-up duration (days)"><input type="number" value={value.defaultDurationDays} onChange={(e) => onChange({ ...value, defaultDurationDays: Number(e.target.value) })} /></Field>
        <Field label="Reminder before (hours)"><input type="number" value={value.reminderBeforeHours} onChange={(e) => onChange({ ...value, reminderBeforeHours: Number(e.target.value) })} /></Field>
        <Field label="Overdue follow-up alerts" inline><Toggle checked={value.overdueAlerts} onChange={(next) => onChange({ ...value, overdueAlerts: next })} /></Field>
      </div>
    </SubSection>
  );
}
