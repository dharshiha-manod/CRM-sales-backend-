// FILE: admin/src/components/UsersPage.tsx
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useIndustryScope } from '../industry/useIndustryScope';
import { api } from '../lib/api';
import './UsersPage.css';

type Role = { id: string; code: string; name: string };
type Membership = {
  id: string; user_id: string; email?: string | null; status: string; industry_type_id: string | null;
  user_profiles?: { display_name?: string | null; phone?: string | null } | null;
  roles?: Role | null;
  industry_types?: { id: string; code: string; name: string } | null;
};

const GLOBAL_ROLES = new Set(['super_admin', 'admin']);
const emptyCreate = { displayName: '', email: '', phone: '', password: '', confirmPassword: '', roleCode: 'sales_representative', status: 'active' };
const errorMessage = (error: unknown) => { const apiError = error as Error & { details?: { fieldErrors?: Record<string, string[]> } }; const fields = apiError.details?.fieldErrors ? Object.values(apiError.details.fieldErrors).flat().join(' ') : ''; return fields || apiError.message; };

export function UsersPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const [users, setUsers] = useState<Membership[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState(emptyCreate);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
      const [memberships, availableRoles] = await Promise.all([
        api<{ data: Membership[] }>(`/users${query}`),
        api<{ data: Role[] }>('/users/roles'),
      ]);
      setUsers(memberships.data);
      setRoles(availableRoles.data);
    } catch (error) { setMessage(errorMessage(error)); }
  };

  useEffect(() => { void load(); }, [activeIndustryTypeId]);

  const filtered = useMemo(
    () => users.filter((user) => `${user.user_profiles?.display_name ?? ''} ${user.email ?? ''} ${user.roles?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())),
    [users, search],
  );

  const roleIsGlobal = GLOBAL_ROLES.has(form.roleCode);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirmPassword) { setMessage('Passwords do not match.'); return; }
    if (!roleIsGlobal && !activeIndustryTypeId) { setMessage('Select an Industry Type in the sidebar before creating a non-admin user.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const { confirmPassword: _confirmPassword, ...rest } = form;
      const payload = { ...rest, industryTypeId: roleIsGlobal ? null : activeIndustryTypeId };
      await api('/users', { method: 'POST', body: JSON.stringify(payload) });
      setForm(emptyCreate);
      setShowCreate(false);
      setMessage('User account created and access assigned.');
      await load();
    } catch (error) { setMessage(errorMessage(error)); } finally { setSaving(false); }
  }

  return (
    <>
      <section className="users-heading">
        <div><p className="eyebrow">TEAM &amp; ACCESS</p><h2>Users</h2><p>Manage secure organization access and team roles.</p></div>
        <button type="button" className="add-user" onClick={() => { setMessage(''); setShowCreate(true); }}>+ Add user</button>
      </section>
      {showCreate && (
        <section className="create-user-panel">
          <div className="panel-title"><div><p className="eyebrow">NEW ACCOUNT</p><h2>Create user</h2></div><button type="button" onClick={() => setShowCreate(false)}>Close</button></div>
          <form className="user-create-form" onSubmit={submit}>
            <input required placeholder="Full name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            <input required type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Phone number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              {roles.map((role) => <option key={role.id} value={role.code}>{role.name}</option>)}
            </select>
            {!roleIsGlobal && <p className="password-help">Will be assigned to your current Industry Type ({activeIndustryTypeId ? 'selected in the sidebar' : 'none selected — pick one first'}).</p>}
            <label className="password-field">
              <input required minLength={12} type={showPassword ? 'text' : 'password'} placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
            </label>
            <input required minLength={12} type={showPassword ? 'text' : 'password'} placeholder="Confirm password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
            <small className="password-help">12+ characters, including uppercase, lowercase, and a number.</small>
            <button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create user'}</button>
          </form>
        </section>
      )}
      <section className="users-table-panel">
        <div className="table-toolbar">
          <h2>All users <span>({users.length})</span></h2>
          <div className="table-toolbar-controls">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users" />
          </div>
        </div>
        {message && <p role="status" className={message.includes('created') ? 'success' : 'error'}>{message}</p>}
        <table>
          <thead><tr><th>Full name</th><th>Email</th><th>Role</th><th>Industry</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((user) => (
              <tr key={user.id}>
                <td>{user.user_profiles?.display_name ?? 'Unnamed user'}</td>
                <td>{user.email ?? '—'}</td>
                <td><span className="role-badge">{user.roles?.name ?? '—'}</span></td>
                <td>{user.industry_types?.name ?? (GLOBAL_ROLES.has(user.roles?.code ?? '') ? 'All industries' : '—')}</td>
                <td>{user.user_profiles?.phone ?? '—'}</td>
                <td><span className={`status-badge ${user.status}`}>{user.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="empty-row">No users found.</td></tr>}
          </tbody>
        </table>
        <p className="table-footer">Showing {filtered.length} of {users.length} users</p>
      </section>
    </>
  );
}