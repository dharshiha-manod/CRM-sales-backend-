import type { PermissionLevel, PermissionMatrixRow, UserPreferences } from './types';
import { Field, SubSection, Toggle } from './ui';

const LEVELS: PermissionLevel[] = ['full', 'team', 'own', 'assigned', 'view', 'none'];
const LEVEL_LABEL: Record<PermissionLevel, string> = { full: 'Full', team: 'Team', own: 'Own', assigned: 'Assigned', view: 'View', none: '—' };
const ROLE_COLUMNS: { key: keyof Omit<PermissionMatrixRow, 'module'>; label: string }[] = [
  { key: 'admin', label: 'Admin' }, { key: 'manager', label: 'Manager' }, { key: 'salesRep', label: 'Sales Rep' },
  { key: 'support', label: 'Support' }, { key: 'inventoryStaff', label: 'Inventory' },
];

export function RolesPermissionsSection({ isAdmin, value, onChange }: { isAdmin: boolean; value: PermissionMatrixRow[]; onChange: (next: PermissionMatrixRow[]) => void }) {
  const updateCell = (moduleName: string, roleKey: keyof Omit<PermissionMatrixRow, 'module'>, level: PermissionLevel) => {
    onChange(value.map((row) => (row.module === moduleName ? { ...row, [roleKey]: level } : row)));
  };
  return (
    <SubSection title="Roles & Permissions" description="Access level each role has per module. Admin-only controls are hidden from non-admin views.">
      <table className="settings-permission-table">
        <thead>
          <tr>
            <th>Module</th>
            {ROLE_COLUMNS.map((col) => <th key={col.key}>{col.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {value.map((row) => (
            <tr key={row.module}>
              <td>{row.module}</td>
              {ROLE_COLUMNS.map((col) => (
                <td key={col.key}>
                  {isAdmin ? (
                    <select value={row[col.key]} onChange={(e) => updateCell(row.module, col.key, e.target.value as PermissionLevel)}>
                      {LEVELS.map((lvl) => <option key={lvl} value={lvl}>{LEVEL_LABEL[lvl]}</option>)}
                    </select>
                  ) : (
                    <span className={`permission-pill level-${row[col.key]}`}>{LEVEL_LABEL[row[col.key]]}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!isAdmin && <p className="settings-note">Only Admin can edit permission levels. This view is read-only.</p>}
      <p className="settings-note">Available levels: View, Create, Edit, Delete, Export — collapsed here into Full / Team / Own / Assigned / View for clarity per module.</p>
    </SubSection>
  );
}

export function UserPreferencesSection({ value, onChange }: { value: UserPreferences; onChange: (next: UserPreferences) => void }) {
  return (
    <SubSection title="User Preferences" description="Personal preferences for your own account. These do not affect other users.">
      <div className="settings-form-grid">
        <Field label="Default landing page">
          <select value={value.defaultLandingPage} onChange={(e) => onChange({ ...value, defaultLandingPage: e.target.value })}>
            <option>Dashboard</option><option>Clients</option><option>Orders</option><option>Field Activity</option>
          </select>
        </Field>
        <Field label="Table density">
          <select value={value.density} onChange={(e) => onChange({ ...value, density: e.target.value as 'comfortable' | 'compact' })}>
            <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
          </select>
        </Field>
      
        <Field label="Weekly email digest" inline>
          <Toggle checked={value.emailDigest} onChange={(next) => onChange({ ...value, emailDigest: next })} />
        </Field>
      </div>
    </SubSection>
  );
}
