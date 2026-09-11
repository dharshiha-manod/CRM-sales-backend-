import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import './SettingsPage.css';
import { useIndustry } from '../industry/IndustryContext';
import type { RoleView, SectionId, SettingsState } from '../settings/types';
import { AUDIT_LOG, createInitialSettingsState } from '../settings/types';
import { EmptyGate } from '../settings/ui';
import { OrganizationSection, IndustryConfigurationSection, LocalizationSection, WorkingHoursSection } from '../settings/GeneralSettings';
import { RolesPermissionsSection, UserPreferencesSection } from '../settings/AccessSettings';
import { SalesConfigSection, VisitConfigSection, TargetConfigSection, OrderConfigSection, CollectionConfigSection, FollowUpConfigSection } from '../settings/SalesSettings';
import { GpsLocationSection, CheckInOutSection, TrackingRulesSection } from '../settings/FieldOpsSettings';
import { InventoryConfigurationSection, StockRulesSection, ExpiryBatchSection } from '../settings/InventorySettings';
import { NotificationsSection, CallsIvrSection } from '../settings/CommunicationSettings';
import { DataDisplaySection, AuditLogSection } from '../settings/SystemSettings';
import { IndustrySpecificSection } from '../settings/IndustrySettings';

interface NavItem { id: SectionId; label: string; roles: RoleView[] }
interface NavGroup { id: string; label: string; items: NavItem[] }

const ADMIN_MANAGER: RoleView[] = ['admin', 'manager'];
const ADMIN_ONLY: RoleView[] = ['admin'];
const ALL_ROLES: RoleView[] = ['admin', 'manager', 'salesRep'];

const NAV_GROUPS: NavGroup[] = [
  { id: 'general', label: 'General', items: [
    { id: 'organization', label: 'Organization', roles: ADMIN_ONLY },
    { id: 'industry', label: 'Industry Configuration', roles: ADMIN_ONLY },
    { id: 'localization', label: 'Localization', roles: ADMIN_MANAGER },
    { id: 'workingHours', label: 'Working Hours', roles: ADMIN_MANAGER },
  ]},
  { id: 'access', label: 'Users & Access', items: [
    { id: 'roles', label: 'Roles & Permissions', roles: ADMIN_ONLY },
    { id: 'userPreferences', label: 'User Preferences', roles: ALL_ROLES },
  ]},
  { id: 'sales', label: 'Sales CRM', items: [
    { id: 'salesConfig', label: 'Sales Configuration', roles: ADMIN_MANAGER },
    { id: 'visitConfig', label: 'Visit Configuration', roles: ADMIN_MANAGER },
    { id: 'targetConfig', label: 'Target Configuration', roles: ADMIN_MANAGER },
    { id: 'orderConfig', label: 'Order Configuration', roles: ADMIN_MANAGER },
    { id: 'collectionConfig', label: 'Collection Configuration', roles: ADMIN_MANAGER },
    { id: 'followUpConfig', label: 'Follow-up Configuration', roles: ADMIN_MANAGER },
  ]},
  { id: 'fieldOps', label: 'Field Operations', items: [
    { id: 'gps', label: 'GPS & Location', roles: ADMIN_MANAGER },
    { id: 'checkInOut', label: 'Check-in / Check-out', roles: ADMIN_MANAGER },
    { id: 'trackingRules', label: 'Tracking Rules', roles: ADMIN_MANAGER },
  ]},
  { id: 'inventory', label: 'Inventory', items: [
    { id: 'inventoryConfig', label: 'Inventory Configuration', roles: ADMIN_MANAGER },
    { id: 'stockRules', label: 'Stock Rules', roles: ADMIN_MANAGER },
    { id: 'expiryBatch', label: 'Expiry & Batch Rules', roles: ADMIN_MANAGER },
  ]},
  { id: 'communication', label: 'Communication', items: [
    { id: 'notifications', label: 'Notifications', roles: ADMIN_MANAGER },
    { id: 'callsIvr', label: 'Calls & IVR', roles: ADMIN_MANAGER },
  ]},
  { id: 'system', label: 'System', items: [
    { id: 'dataDisplay', label: 'Data & Display', roles: ADMIN_ONLY },
    { id: 'auditLog', label: 'Audit Log', roles: ADMIN_ONLY },
  ]},
];

export function SettingsPage() {
  const { activeIndustry, setActiveIndustry, config } = useIndustry();
  const [roleView, setRoleView] = useState<RoleView>('admin');
  const [settings, setSettings] = useState<SettingsState>(createInitialSettingsState);
  const [saved, setSaved] = useState<SettingsState>(settings);
  const [activeSection, setActiveSection] = useState<SectionId>('organization');
  const [toast, setToast] = useState('');

  const visibleGroups = useMemo(
    () => NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(roleView)) })).filter((group) => group.items.length > 0),
    [roleView]
  );

  const dirty = settings !== saved;

  function update<K extends keyof SettingsState>(key: K, updater: (prev: SettingsState[K]) => SettingsState[K]) {
    setSettings((prev) => ({ ...prev, [key]: updater(prev[key]) }));
  }

  function selectSection(id: SectionId) {
    setActiveSection(id);
    setToast('');
  }

  function handleRoleChange(next: RoleView) {
    setRoleView(next);
    const firstVisible = NAV_GROUPS.flatMap((g) => g.items).find((item) => item.roles.includes(next));
    if (firstVisible) selectSection(firstVisible.id);
  }

  function saveChanges() {
    setSaved(settings);
    setToast('✓ Settings saved successfully.');
    window.setTimeout(() => setToast(''), 3000);
  }

  function discardChanges() {
    setSettings(saved);
    setToast('');
  }

  const currentItem = NAV_GROUPS.flatMap((g) => g.items).find((item) => item.id === activeSection);
  const canSeeCurrent = currentItem ? currentItem.roles.includes(roleView) : false;

  const industryFor = (industry: typeof activeIndustry) => settings.industrySpecific[industry];

  function renderSection(): ReactNode {
    if (!canSeeCurrent) return <EmptyGate text="You don't have access to this setting. Contact an Admin if you need this changed." />;
    switch (activeSection) {
      case 'organization':
        return <OrganizationSection value={settings.organization} onChange={(next) => update('organization', () => next)} />;
      case 'industry':
        return <IndustryConfigurationSection activeIndustry={activeIndustry} onChangeIndustry={setActiveIndustry} />;
      case 'localization':
        return <LocalizationSection value={settings.localization} onChange={(next) => update('localization', () => next)} />;
      case 'workingHours':
        return <WorkingHoursSection value={settings.workingHours} onChange={(next) => update('workingHours', () => next)} />;
      case 'roles':
        return <RolesPermissionsSection isAdmin={roleView === 'admin'} value={settings.permissionMatrix} onChange={(next) => update('permissionMatrix', () => next)} />;
      case 'userPreferences':
        return <UserPreferencesSection value={settings.userPreferences} onChange={(next) => update('userPreferences', () => next)} />;
      case 'salesConfig':
        return <SalesConfigSection value={settings.sales} onChange={(next) => update('sales', () => next)} />;
      case 'visitConfig':
        return <VisitConfigSection value={settings.visit} onChange={(next) => update('visit', () => next)} />;
      case 'targetConfig':
        return <TargetConfigSection value={settings.target} onChange={(next) => update('target', () => next)} />;
      case 'orderConfig':
        return <OrderConfigSection value={settings.order} onChange={(next) => update('order', () => next)} />;
      case 'collectionConfig':
        return <CollectionConfigSection value={settings.collection} onChange={(next) => update('collection', () => next)} />;
      case 'followUpConfig':
        return <FollowUpConfigSection value={settings.followUp} onChange={(next) => update('followUp', () => next)} />;
      case 'gps':
        return <GpsLocationSection value={settings.gps} onChange={(next) => update('gps', () => next)} />;
      case 'checkInOut':
        return <CheckInOutSection value={settings.checkInOut} onChange={(next) => update('checkInOut', () => next)} />;
      case 'trackingRules':
        return <TrackingRulesSection value={settings.tracking} onChange={(next) => update('tracking', () => next)} />;
      case 'inventoryConfig':
        return <InventoryConfigurationSection value={settings.inventory} onChange={(next) => update('inventory', () => next)} />;
      case 'stockRules':
        return <StockRulesSection value={settings.stockRules} onChange={(next) => update('stockRules', () => next)} />;
      case 'expiryBatch':
        return <ExpiryBatchSection value={settings.expiryBatch} onChange={(next) => update('expiryBatch', () => next)} />;
      case 'notifications':
        return <NotificationsSection value={settings.notifications} onChange={(next) => update('notifications', () => next)} />;
      case 'callsIvr':
        return <CallsIvrSection value={settings.callsIvr} />;
      case 'dataDisplay':
        return <DataDisplaySection value={settings.dataDisplay} onChange={(next) => update('dataDisplay', () => next)} />;
      case 'auditLog':
        return <AuditLogSection entries={AUDIT_LOG} />;
      default:
        return null;
    }
  }

  return (
    <div className="settings-shell">
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <p className="eyebrow">ADMINISTRATION</p>
          <h2>Settings</h2>
          <label className="settings-role-switch">
            <span>Viewing as</span>
            <select value={roleView} onChange={(e) => handleRoleChange(e.target.value as RoleView)}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="salesRep">Sales Representative</option>
            </select>
          </label>
        </div>
        <nav aria-label="Settings navigation">
          {visibleGroups.map((group) => (
            <div key={group.id} className="settings-nav-group">
              <p className="nav-label">{group.label.toUpperCase()}</p>
              {group.items.map((item) => (
                <button key={item.id} type="button" className={activeSection === item.id ? 'active' : ''} onClick={() => selectSection(item.id)}>
                  {item.label}
                  {item.id === 'industry' && <em>{config.label}</em>}
                </button>
              ))}
            </div>
          ))}
          {roleView === 'salesRep' && (
            <p className="settings-role-note">Sales representatives only have access to personal preferences. Sign in as a Manager or Admin for full Settings access.</p>
          )}
        </nav>
      </aside>
      <div className="settings-content">
        <header className="settings-content-header">
          <div>
            <p className="eyebrow">{currentItem ? NAV_GROUPS.find((g) => g.items.includes(currentItem))?.label.toUpperCase() : 'SETTINGS'}</p>
            <h2>{currentItem?.label ?? 'Settings'}</h2>
          </div>
          <div className="settings-save-bar">
            {toast && <span className="settings-toast">{toast}</span>}
            {dirty && !toast && <span className="settings-unsaved">Unsaved changes</span>}
            <button type="button" onClick={discardChanges} disabled={!dirty}>Discard Changes</button>
            <button type="button" className="settings-save-btn" onClick={saveChanges} disabled={!dirty}>Save Changes</button>
          </div>
        </header>
        <div className="settings-content-body">
          {renderSection()}
          {activeSection === 'industry' && canSeeCurrent && (
            <IndustrySpecificSection industry={activeIndustry} rows={industryFor(activeIndustry)} onChange={(next) => update('industrySpecific', (prev) => ({ ...prev, [activeIndustry]: next }))} />
          )}
        </div>
      </div>
    </div>
  );
}
