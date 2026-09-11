import type { CallsIvrSettings, NotificationRow } from './types';
import { SubSection, Toggle } from './ui';

export function NotificationsSection({ value, onChange }: { value: NotificationRow[]; onChange: (next: NotificationRow[]) => void }) {
  const flip = (category: string, channel: 'inApp' | 'email' | 'sms') =>
    onChange(value.map((row) => (row.category === category ? { ...row, [channel]: !row[channel] } : row)));
  return (
    <SubSection title="Notifications" description="Choose which channels each event notifies on.">
      <table className="settings-mini-table settings-notifications-table">
        <thead><tr><th>Event</th><th>In-app</th><th>Email</th><th>SMS</th></tr></thead>
        <tbody>
          {value.map((row) => (
            <tr key={row.category}>
              <td>{row.category}</td>
              <td><Toggle checked={row.inApp} onChange={() => flip(row.category, 'inApp')} /></td>
              <td><Toggle checked={row.email} onChange={() => flip(row.category, 'email')} /></td>
              <td><Toggle checked={row.sms} onChange={() => flip(row.category, 'sms')} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </SubSection>
  );
}

export function CallsIvrSection({ value }: { value: CallsIvrSettings }) {
  return (
    <SubSection title="Calls & IVR" description="Frontend configuration for call and IVR provider settings. No live telephony is connected in this workspace.">
      <div className="settings-ivr-card">
        <div>
          <p className="settings-field-label">IVR Provider</p>
          <p className="settings-ivr-status">{value.providerName}</p>
          <small className="settings-field-hint">IVR provider connection required</small>
        </div>
        <div className="settings-ivr-actions">
          <button type="button">Configure Provider</button>
          <button type="button">View Call Settings</button>
        </div>
      </div>
    </SubSection>
  );
}
