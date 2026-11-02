import type { FieldDef } from './PharmaMasterPage';

type SetForm = (updater: (prev: Record<string, string>) => Record<string, string>) => void;

/** Sales rep chosen from the real Sales representatives list (stores the employee code, same as Trading). */
export const repField = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'lookup',
  lookupResource: '/sales-representatives',
  lookupValueKey: 'employee_code',
  lookupLabelKey: 'user_profiles.display_name',
  ...extra,
});

/** Hospital / customer chosen from the real Clients list (already limited to the active industry). */
export const hospitalField = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  type: 'lookup',
  lookupResource: '/clients',
  lookupValueKey: 'client_name',
  lookupLabelKey: 'client_name',
  lookupSecondaryLabelKey: 'client_code',
  ...extra,
});

/** When a hospital is picked: fills the rep assigned to that client (and, if contactKey is given, the client's primary contact). Never overwrites a value already chosen. */
export function fillRepFromClient(repKey: string, contactKey?: string | string[], specialtyKey?: string) {
  return (matched: Record<string, unknown>, setForm: SetForm) => {
    if (contactKey) {
      const contacts = (matched.client_contacts as Array<{ name?: string; designation?: string | null; is_primary?: boolean }> | undefined) ?? [];
      const primary = contacts.find((c) => c.is_primary) ?? contacts[0];
      const keys = Array.isArray(contactKey) ? contactKey : [contactKey];
      if (primary?.name) for (const k of keys) setForm((prev) => (prev[k] ? prev : { ...prev, [k]: primary.name as string }));
      if (specialtyKey && primary?.designation) setForm((prev) => (prev[specialtyKey] ? prev : { ...prev, [specialtyKey]: primary.designation as string }));
    }
    const assignments = (matched.sales_representative_client_assignments as Array<{ status?: string; sales_representatives?: { employee_code?: string } | null }> | undefined) ?? [];
    const active = assignments.find((a) => a.status === 'active' && a.sales_representatives?.employee_code);
    const code = active?.sales_representatives?.employee_code;
    if (!code) return;
    setForm((prev) => (prev[repKey] ? prev : { ...prev, [repKey]: code }));
  };
}
