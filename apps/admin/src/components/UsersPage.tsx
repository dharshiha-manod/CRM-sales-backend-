// FILE: admin/src/components/UsersPage.tsx
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIndustryScope } from '../industry/useIndustryScope';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import './UsersPage.css';

type Role = { id: string; code: string; name: string };
type Membership = {
  id: string; user_id: string; email?: string | null; status: string; industry_type_id: string | null;
  user_profiles?: { display_name?: string | null; phone?: string | null } | null;
  roles?: Role | null;
  industry_types?: { id: string; code: string; name: string } | null;
};
type Toast = { kind: 'success' | 'error'; text: string };
type Dialog =
  | { type: 'create' }
  | { type: 'edit'; user: Membership }
  | { type: 'password'; user: Membership }
  | { type: 'confirm'; action: 'deactivate' | 'delete'; user: Membership };

const GLOBAL_ROLES = new Set(['super_admin', 'admin']);
// The only roles the product supports, in display order, with a plain-English description.
const ROLE_INFO: Record<string, string> = {
  super_admin: 'Full access to everything, including managing other admins.',
  admin: 'Manages users, settings and all industries in the web admin.',
  sales_manager: 'Uses the web admin for orders, targets and reports. Cannot manage users.',
  sales_representative: 'Field work in the mobile app: leads, visits and orders. Locked to one industry.',
};
const ROLE_ORDER = Object.keys(ROLE_INFO);
const PAGE_SIZE = 10;
const emptyForm = { displayName: '', email: '', phone: '', password: '', confirmPassword: '', roleCode: 'sales_representative', status: 'active' };

const errorMessage = (error: unknown) => {
  const apiError = error as Error & { details?: { fieldErrors?: Record<string, string[]> } };
  const fields = apiError.details?.fieldErrors ? Object.values(apiError.details.fieldErrors).flat().join(' ') : '';
  return fields || apiError.message;
};
const nameOf = (u: Membership) => u.user_profiles?.display_name?.trim() || 'Unnamed user';
const initialsOf = (u: Membership) => nameOf(u).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
const statusLabel = (s: string) => (s === 'disabled' ? 'Deactivated' : s === 'invited' ? 'Invited' : 'Active');
// Matches the API rule (12+ chars, upper, lower, number) so mistakes are caught before sending.
const passwordProblem = (p: string) =>
  p.length < 12 ? 'Use at least 12 characters.' : !/[a-z]/.test(p) ? 'Add a lowercase letter.' : !/[A-Z]/.test(p) ? 'Add an uppercase letter.' : !/[0-9]/.test(p) ? 'Add a number.' : '';
const passwordChecks = (p: string) => [
  { label: '12+ characters', ok: p.length >= 12 },
  { label: 'Uppercase letter', ok: /[A-Z]/.test(p) },
  { label: 'Lowercase letter', ok: /[a-z]/.test(p) },
  { label: 'Number', ok: /[0-9]/.test(p) },
];
function generatePassword() {
  const sets = ['abcdefghjkmnpqrstuvwxyz', 'ABCDEFGHJKMNPQRSTUVWXYZ', '23456789', '!@#$%&*?'];
  const all = sets.join('');
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 12 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/** Small modal shell: closes on Escape / backdrop click, locks focus to the first field. */
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('form input, form select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="um-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="um-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="um-modal-head">
          <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="um-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function UsersPage() {
  const { activeIndustryTypeId } = useIndustryScope();
  const [users, setUsers] = useState<Membership[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<{ id: string; top: number; right: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const notify = useCallback((kind: Toast['kind'], text: string) => setToast({ kind, text }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { void supabase?.auth.getSession().then(({ data }) => setMyUserId(data.session?.user.id ?? null)); }, []);

  const load = useCallback(async () => {
    try {
      const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
      const [memberships, availableRoles] = await Promise.all([api<{ data: Membership[] }>(`/users${query}`), api<{ data: Role[] }>('/users/roles')]);
      setUsers(memberships.data);
      setRoles(availableRoles.data.filter((r) => r.code in ROLE_INFO).sort((a, b) => ROLE_ORDER.indexOf(a.code) - ROLE_ORDER.indexOf(b.code)));
    } catch (error) { notify('error', errorMessage(error)); } finally { setLoading(false); }
  }, [activeIndustryTypeId, notify]);
  useEffect(() => { void load(); }, [load]);

  // Close the row menu on any outside click, scroll, or resize.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  const counts = useMemo(() => ({
    all: users.length,
    active: users.filter((u) => u.status === 'active').length,
    disabled: users.filter((u) => u.status === 'disabled').length,
  }), [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (roleFilter !== 'all' && u.roles?.code !== roleFilter) return false;
      return !q || `${nameOf(u)} ${u.email ?? ''} ${u.user_profiles?.phone ?? ''} ${u.roles?.name ?? ''}`.toLowerCase().includes(q);
    });
  }, [users, search, roleFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter]);

  const closeDialog = useCallback(() => { setDialog(null); setFormError(''); setBusy(false); }, []);
  const openCreate = () => { setForm(emptyForm); setShowPassword(false); setFormError(''); setDialog({ type: 'create' }); };
  const openEdit = (user: Membership) => {
    setForm({ ...emptyForm, displayName: user.user_profiles?.display_name ?? '', email: user.email ?? '', phone: user.user_profiles?.phone ?? '', roleCode: user.roles?.code ?? 'sales_representative', status: user.status });
    setFormError(''); setDialog({ type: 'edit', user });
  };
  const openPassword = (user: Membership) => { setNewPassword(''); setShowPassword(false); setCopied(false); setFormError(''); setDialog({ type: 'password', user }); };

  const roleIsGlobal = GLOBAL_ROLES.has(form.roleCode);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirmPassword) { setFormError('Passwords do not match.'); return; }
    const problem = passwordProblem(form.password);
    if (problem) { setFormError(problem); return; }
    if (!roleIsGlobal && !activeIndustryTypeId) { setFormError('Select an Industry Type in the sidebar before creating a non-admin user.'); return; }
    setBusy(true); setFormError('');
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({
        displayName: form.displayName, email: form.email, phone: form.phone || null, password: form.password,
        roleCode: form.roleCode, status: form.status, industryTypeId: roleIsGlobal ? null : activeIndustryTypeId,
      }) });
      closeDialog(); notify('success', `${form.displayName} was added.`); await load();
    } catch (error) { setFormError(errorMessage(error)); setBusy(false); }
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (dialog?.type !== 'edit') return;
    const user = dialog.user;
    if (!roleIsGlobal && !user.industry_type_id && !activeIndustryTypeId) { setFormError('Select an Industry Type in the sidebar first.'); return; }
    setBusy(true); setFormError('');
    try {
      await api(`/users/${user.id}`, { method: 'PUT', body: JSON.stringify({
        displayName: form.displayName, phone: form.phone || null, roleCode: form.roleCode, status: form.status,
        industryTypeId: roleIsGlobal ? null : (user.industry_type_id ?? activeIndustryTypeId),
      }) });
      closeDialog(); notify('success', 'Changes saved.'); await load();
    } catch (error) { setFormError(errorMessage(error)); setBusy(false); }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (dialog?.type !== 'password') return;
    const problem = passwordProblem(newPassword);
    if (problem) { setFormError(problem); return; }
    setBusy(true); setFormError('');
    try {
      await api(`/users/${dialog.user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: newPassword }) });
      const name = nameOf(dialog.user);
      closeDialog(); notify('success', `Password reset for ${name}. They were signed out everywhere.`);
    } catch (error) { setFormError(errorMessage(error)); setBusy(false); }
  }

  async function setStatus(user: Membership, status: 'active' | 'disabled') {
    try {
      await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      notify('success', `${nameOf(user)} is now ${status === 'active' ? 'active' : 'deactivated'}.`); await load();
    } catch (error) { notify('error', errorMessage(error)); }
  }

  async function confirmAction() {
    if (dialog?.type !== 'confirm') return;
    const { action, user } = dialog;
    setBusy(true);
    try {
      if (action === 'delete') { await api(`/users/${user.id}`, { method: 'DELETE' }); notify('success', `${nameOf(user)} was deleted.`); await load(); }
      else { await setStatus(user, 'disabled'); }
      closeDialog();
    } catch (error) { closeDialog(); notify('error', errorMessage(error)); }
  }

  const rowMenuUser = menu ? users.find((u) => u.id === menu.id) : undefined;
  const isSelf = (u: Membership) => !!myUserId && u.user_id === myUserId;

  return (
    <>
      <section className="users-heading">
        <div><p className="eyebrow">TEAM &amp; ACCESS</p><h2>Users</h2><p>Manage secure organization access and team roles.</p></div>
        <button type="button" className="add-user" onClick={openCreate}>+ Add user</button>
      </section>

      <section className="users-table-panel">
        <div className="um-tabs" role="tablist" aria-label="Filter by status">
          {([['all', 'All'], ['active', 'Active'], ['disabled', 'Deactivated']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={statusFilter === key} className={`um-tab${statusFilter === key ? ' is-on' : ''}`} onClick={() => setStatusFilter(key)}>
              {label} <span>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="um-toolbar">
          <input className="um-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone" aria-label="Search users" />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
            <option value="all">All roles</option>
            {roles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
          </select>
        </div>

        <div className="um-table-wrap">
          <table className="um-table">
            <thead><tr><th>User</th><th>Role</th><th>Industry</th><th>Phone</th><th>Status</th><th className="um-actions-col"><span className="um-sr">Actions</span></th></tr></thead>
            <tbody>
              {loading && Array.from({ length: 4 }, (_, i) => <tr key={i} className="um-skeleton"><td colSpan={6}><span /></td></tr>)}
              {!loading && visible.map((user) => (
                <tr key={user.id} className={user.status === 'disabled' ? 'is-disabled' : ''}>
                  <td>
                    <div className="um-person">
                      <span className="um-avatar" aria-hidden="true">{initialsOf(user)}</span>
                      <span className="um-person-text">
                        <strong>{nameOf(user)}{isSelf(user) && <em className="um-you">You</em>}</strong>
                        <small>{user.email ?? '—'}</small>
                      </span>
                    </div>
                  </td>
                  <td><span className="role-badge">{user.roles?.name ?? '—'}</span></td>
                  <td>{user.industry_types?.name ?? (GLOBAL_ROLES.has(user.roles?.code ?? '') ? 'All industries' : '—')}</td>
                  <td>{user.user_profiles?.phone || '—'}</td>
                  <td><span className={`status-badge ${user.status}`}>{statusLabel(user.status)}</span></td>
                  <td className="um-actions-col">
                    <button type="button" className="um-row-btn" onClick={() => openEdit(user)}>Edit</button>
                    <button type="button" className="um-icon-btn" aria-label={`More actions for ${nameOf(user)}`} aria-haspopup="menu"
                      onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.id === user.id ? null : { id: user.id, top: r.bottom + 4, right: window.innerWidth - r.right }); }}>⋯</button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="empty-row">{users.length === 0 ? 'No users yet. Add your first user to get started.' : 'No users match your filters.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="um-footer">
          <p className="table-footer">Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} users</p>
          {pageCount > 1 && (
            <div className="um-pager">
              <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
              <span>Page {safePage} of {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button>
            </div>
          )}
        </div>
      </section>

      {menu && rowMenuUser && (
        <div className="um-menu" role="menu" style={{ top: menu.top, right: menu.right }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); openEdit(rowMenuUser); }}>Edit details</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); openPassword(rowMenuUser); }}>Reset password</button>
          {rowMenuUser.status === 'disabled'
            ? <button type="button" role="menuitem" onClick={() => { setMenu(null); void setStatus(rowMenuUser, 'active'); }}>Reactivate</button>
            : <button type="button" role="menuitem" disabled={isSelf(rowMenuUser)} onClick={() => { setMenu(null); setDialog({ type: 'confirm', action: 'deactivate', user: rowMenuUser }); }}>Deactivate</button>}
          <hr />
          <button type="button" role="menuitem" className="is-danger" disabled={isSelf(rowMenuUser)} onClick={() => { setMenu(null); setDialog({ type: 'confirm', action: 'delete', user: rowMenuUser }); }}>Delete user</button>
        </div>
      )}

      {dialog?.type === 'create' && (
        <Modal title="Add user" subtitle="Create their login and choose what they can access." onClose={closeDialog}>
          <form className="um-form" onSubmit={submitCreate}>
            <label><span className="um-label">Full name <b className="um-req">*</b></span><input required placeholder="e.g. Priya Raman" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label><span className="um-label">Email address <b className="um-req">*</b></span><input required type="email" placeholder="name@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label><span className="um-label">Phone number <i className="um-opt">Optional</i></span><input type="tel" placeholder="Mobile number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label><span className="um-label">Role <b className="um-req">*</b></span>
              <select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}</select>
            </label>
         
            <label>
              <span className="um-label">Temporary password <b className="um-req">*</b>
                <button type="button" className="um-link" onClick={() => { const p = generatePassword(); setForm({ ...form, password: p, confirmPassword: p }); setShowPassword(true); }}>Generate</button>
              </span>
              <span className="um-input-wrap">
                <input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="um-eye" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
              </span>
            </label>
            <label>
              <span className="um-label">Confirm password <b className="um-req">*</b>
                {form.confirmPassword && <span className={`um-match ${form.password === form.confirmPassword ? 'is-ok' : 'is-bad'}`}>{form.password === form.confirmPassword ? '✓ Match' : 'Does not match'}</span>}
              </span>
              <input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
            </label>
            <ul className="um-checks um-span" aria-label="Password requirements">
              {passwordChecks(form.password).map((c) => <li key={c.label} className={c.ok ? 'is-ok' : ''}>{c.label}</li>)}
            </ul>
            {formError && <p role="alert" className="error um-span">{formError}</p>}
            <div className="um-buttons um-span"><button type="button" onClick={closeDialog}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button></div>
          </form>
        </Modal>
      )}

      {dialog?.type === 'edit' && (
        <Modal title="Edit user" subtitle={dialog.user.email ?? undefined} onClose={closeDialog}>
          <form className="um-form" onSubmit={submitEdit}>
            <label>Full name<input required minLength={2} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
            <label>Phone number<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label>Role<select value={form.roleCode} disabled={isSelf(dialog.user)} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}</select></label>
            <label>Status
              <select value={form.status} disabled={isSelf(dialog.user)} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option><option value="disabled">Deactivated</option>
                {dialog.user.status === 'invited' && <option value="invited">Invited</option>}
              </select>
            </label>
            <p className="um-hint um-span">{ROLE_INFO[form.roleCode]}</p>
            {isSelf(dialog.user) && <p className="um-hint um-span">You can’t change your own role or status.</p>}
            {formError && <p role="alert" className="error um-span">{formError}</p>}
            <div className="um-buttons um-span"><button type="button" onClick={closeDialog}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
          </form>
        </Modal>
      )}

      {dialog?.type === 'password' && (
        <Modal title="Reset password" subtitle={`${nameOf(dialog.user)} · ${dialog.user.email ?? ''}`} onClose={closeDialog}>
          <form className="um-form um-single" onSubmit={submitPassword}>
            <label>New temporary password
              <span className="um-password">
                <input required autoComplete="new-password" type={showPassword ? 'text' : 'password'} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setCopied(false); }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
                <button type="button" onClick={() => { setNewPassword(generatePassword()); setShowPassword(true); setCopied(false); }}>Generate</button>
              </span>
            </label>
            <button type="button" className="um-link" disabled={!newPassword} onClick={() => { void navigator.clipboard.writeText(newPassword).then(() => setCopied(true)); }}>{copied ? 'Copied ✓' : 'Copy password'}</button>
            <p className="um-hint">Share it with {nameOf(dialog.user)} securely. They will be signed out of all devices and must sign in with this password.</p>
            {formError && <p role="alert" className="error">{formError}</p>}
            <div className="um-buttons"><button type="button" onClick={closeDialog}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button></div>
          </form>
        </Modal>
      )}

      {dialog?.type === 'confirm' && (
        <Modal title={dialog.action === 'delete' ? `Delete ${nameOf(dialog.user)}?` : `Deactivate ${nameOf(dialog.user)}?`} onClose={closeDialog}>
          <div className="um-form um-single">
            <p className="um-confirm">
              {dialog.action === 'delete'
                ? 'This removes their access and cannot be undone. If they have leads, orders or activity linked to them, deactivate them instead so that history is kept.'
                : 'They will no longer be able to sign in or appear in new assignments. Their history is kept, and you can reactivate them any time.'}
            </p>
            <div className="um-buttons">
              <button type="button" onClick={closeDialog}>Cancel</button>
              <button type="button" className={dialog.action === 'delete' ? 'um-danger' : 'active'} disabled={busy} onClick={() => void confirmAction()}>
                {busy ? 'Working…' : dialog.action === 'delete' ? 'Delete user' : 'Deactivate'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <div className={`um-toast ${toast.kind}`} role="status" aria-live="polite">{toast.text}</div>}
    </>
  );
}