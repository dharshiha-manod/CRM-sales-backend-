import { useMemo, useState } from 'react';
import type { AuditLogEntry, DataDisplaySettings } from './types';
import { Field, SubSection, Toggle } from './ui';

export function DataDisplaySection({ value, onChange }: { value: DataDisplaySettings; onChange: (next: DataDisplaySettings) => void }) {
  return (
    <SubSection title="Data & Display" description="Table and dashboard defaults applied across the CRM.">
      <div className="settings-form-grid">
        <Field label="Default page size">
          <select value={value.pageSize} onChange={(e) => onChange({ ...value, pageSize: Number(e.target.value) })}>
            <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
          </select>
        </Field>
        <Field label="Table density">
          <select value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as 'compact' | 'comfortable' })}>
            <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
          </select>
        </Field>
        <Field label="Default dashboard"><input value={value.defaultDashboard} onChange={(e) => onChange({ ...value, defaultDashboard: e.target.value })} /></Field>
        <Field label="Default landing page"><input value={value.defaultLandingPage} onChange={(e) => onChange({ ...value, defaultLandingPage: e.target.value })} /></Field>
        <Field label="Show inactive records" inline><Toggle checked={value.showInactiveRecords} onChange={(next) => onChange({ ...value, showInactiveRecords: next })} /></Field>
        <Field label="Confirmation before delete" inline><Toggle checked={value.confirmBeforeDelete} onChange={(next) => onChange({ ...value, confirmBeforeDelete: next })} /></Field>
        <Field label="Auto refresh" inline><Toggle checked={value.autoRefresh} onChange={(next) => onChange({ ...value, autoRefresh: next })} /></Field>
      </div>
    </SubSection>
  );
}

export function AuditLogSection({ entries }: { entries: AuditLogEntry[] }) {
  const [user, setUser] = useState('');
  const [module, setModule] = useState('');
  const [date, setDate] = useState('');
  const filtered = useMemo(() => entries.filter((e) =>
    (!user || e.user.toLowerCase().includes(user.toLowerCase())) &&
    (!module || e.module.toLowerCase().includes(module.toLowerCase())) &&
    (!date || e.date.toLowerCase().includes(date.toLowerCase()))
  ), [entries, user, module, date]);
  return (
    <SubSection title="Audit Log" description="Recent configuration changes across Settings.">
      <div className="settings-audit-filters">
        <input placeholder="Filter by user" value={user} onChange={(e) => setUser(e.target.value)} />
        <input placeholder="Filter by module" value={module} onChange={(e) => setModule(e.target.value)} />
        <input placeholder="Filter by date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <table className="settings-mini-table">
        <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Status</th></tr></thead>
        <tbody>
          {filtered.map((e, i) => (
            <tr key={i}>
              <td>{e.date}</td><td>{e.user}</td><td>{e.action}</td><td>{e.module}</td><td>{e.record}</td>
              <td><span className={`audit-status ${e.status === 'Successful' ? 'ok' : 'fail'}`}>{e.status}</span></td>
            </tr>
          ))}
          {filtered.length === 0 && <tr><td colSpan={6} className="empty-row">No matching audit entries.</td></tr>}
        </tbody>
      </table>
    </SubSection>
  );
}
