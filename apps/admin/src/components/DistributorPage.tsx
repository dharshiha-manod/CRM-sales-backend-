import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './MasterDataPages.css';

type Assignment = { id: string; status: string; sales_representatives?: { employee_code: string; user_profiles?: { display_name?: string | null } | null } | null };
type Client = {
  id: string;
  client_code: string;
  client_name: string;
  client_type: string;
  outlet_type?: string | null;
  status: 'active' | 'inactive';
  priority: 'low' | 'normal' | 'high' | 'critical';
  city?: string | null;
  gstin?: string | null;
  credit_limit?: number | null;
  credit_days?: number | null;
  sales_representative_client_assignments?: Assignment[];
};
type Order = { id: string; order_number: string; status: string; total_amount: number; created_at: string; client_id?: string };
type Collection = { id: string; amount: number; mode: string; collected_at: string; client_id?: string };

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

function activeRep(client: Client): string {
  const assignment = client.sales_representative_client_assignments?.find((a) => a.status === 'active') ?? client.sales_representative_client_assignments?.[0];
  return assignment?.sales_representatives?.user_profiles?.display_name ?? assignment?.sales_representatives?.employee_code ?? '';
}

const AVATAR_PALETTE = ['#c6791f', '#3d5a80', '#8b5a83', '#2e7d6b', '#3f6b4a', '#a6402b'];
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function DistributorPage({ industryLabel = 'FMCG' }: { industryLabel?: string } = {}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Client['status']>('all');
  const [creditFilter, setCreditFilter] = useState<'all' | 'healthy' | 'watch' | 'over'>('all');

  const [viewing, setViewing] = useState<Client | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [clientsRes, ordersRes, collectionsRes] = await Promise.all([
        api<{ data: Client[] }>('/clients'),
        api<{ data: Order[] }>('/orders').catch(() => ({ data: [] })),
        api<{ data: Collection[] }>('/collections').catch(() => ({ data: [] })),
      ]);
      setClients((clientsRes.data ?? []).filter((c) => (c.outlet_type ?? '').toLowerCase() === 'distributor'));
      setOrders(ordersRes.data ?? []);
      setCollections(collectionsRes.data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load distributor data.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function ledger(clientId: string) {
    const clientOrders = orders.filter((o) => o.client_id === clientId && o.status !== 'cancelled');
    const clientCollections = collections.filter((c) => c.client_id === clientId);
    const totalSales = clientOrders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);
    const totalCollected = clientCollections.reduce((sum, c) => sum + (c.amount ?? 0), 0);
    const outstanding = Math.max(0, totalSales - totalCollected);
    const lastOrder = clientOrders.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return { orderCount: clientOrders.length, totalSales, totalCollected, outstanding, lastOrderDate: lastOrder?.created_at ?? null };
  }

  function creditTone(client: Client, outstanding: number): 'healthy' | 'watch' | 'over' {
    if (!client.credit_limit) return 'healthy';
    const pct = outstanding / client.credit_limit;
    if (pct >= 1) return 'over';
    if (pct >= 0.75) return 'watch';
    return 'healthy';
  }

  const rows = useMemo(() => {
    return clients.map((c) => ({ client: c, ...ledger(c.id), rep: activeRep(c) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, orders, collections]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.client.status !== statusFilter) return false;
      const tone = creditTone(r.client, r.outstanding);
      if (creditFilter !== 'all' && tone !== creditFilter) return false;
      if (!q) return true;
      return (
        r.client.client_name.toLowerCase().includes(q) ||
        r.client.client_code.toLowerCase().includes(q) ||
        (r.client.city ?? '').toLowerCase().includes(q) ||
        r.rep.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, creditFilter]);

  async function toggleStatus(client: Client) {
    try {
      await api(`/clients/${client.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: client.status === 'active' ? 'inactive' : 'active' }) });
      setMessage('Distributor status updated successfully.');
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Unable to update status.');
    }
  }

  function openView(client: Client) {
    setViewing(client);
  }

  const totalDistributors = clients.length;
  const activeDistributors = clients.filter((c) => c.status === 'active').length;
  const totalCreditExtended = clients.reduce((sum, c) => sum + (c.credit_limit ?? 0), 0);
  const totalOutstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);
  const overLimitCount = rows.filter((r) => creditTone(r.client, r.outstanding) === 'over').length;

  const viewingLedger = viewing ? ledger(viewing.id) : null;
  const viewingOrders = viewing ? orders.filter((o) => o.client_id === viewing.id).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : [];
  const viewingCollections = viewing ? collections.filter((c) => c.client_id === viewing.id).slice().sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime()) : [];

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">{industryLabel.toUpperCase()} · DISTRIBUTOR MANAGEMENT</p>
          <h2>Distributor management</h2>
          <p>Track distributor credit health, order volume and collections. Distributors are clients tagged with outlet type "Distributor" — add or edit one from the Clients directory.</p>
        </div>
      </div>

         <div className="kpi-grid">
        <div className="kpi-card" data-tone="ink">
          <div className="kpi-icon">▤</div>
          <div>
            <span>Distributors</span>
            <strong>{totalDistributors}</strong>
            <small>{activeDistributors} active</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="blue">
          <div className="kpi-icon">₹</div>
          <div>
            <span>Credit extended</span>
            <strong>{money(totalCreditExtended)}</strong>
            <small>combined credit limit</small>
          </div>
        </div>
        <div className="kpi-card" data-tone="amber">
          <div className="kpi-icon">◒</div>
          <div>
            <span>Outstanding</span>
            <strong>{money(totalOutstanding)}</strong>
            <small>across all distributors</small>
          </div>
        </div>
        <div className="kpi-card" data-tone={overLimitCount > 0 ? 'red' : 'green'}>
          <div className="kpi-icon">⚠</div>
          <div>
            <span>Over credit limit</span>
            <strong>{overLimitCount}</strong>
            <small>need collection follow-up</small>
          </div>
        </div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input
            type="search"
            placeholder="Search distributor, city or representative…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | Client['status'])}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={creditFilter} onChange={(e) => setCreditFilter(e.target.value as typeof creditFilter)}>
            <option value="all">All credit health</option>
            <option value="healthy">Healthy</option>
            <option value="watch">Near limit</option>
            <option value="over">Over limit</option>
          </select>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}
      {message && <p className={message.includes('successfully') ? 'success-message' : 'error-message'}>{message}</p>}

      {loading ? (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Distributor</th>
                <th>City</th>
                <th>Representative</th>
                <th>Credit terms</th>
                <th>Orders</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i} className="skeleton-row">
                  <td><span className="skeleton-block" style={{ width: '75%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '60%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '65%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '30%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '55%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '50%' }} /></td>
                  <td><span className="skeleton-block" style={{ width: '70%' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Distributor</th>
                <th>City</th>
                <th>Representative</th>
                <th>Credit terms</th>
                <th>Orders</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ client, orderCount, totalSales, outstanding, rep }) => {
                const tone = creditTone(client, outstanding);
                const pct = client.credit_limit ? Math.min(100, Math.round((outstanding / client.credit_limit) * 100)) : 0;
                return (
                  <tr key={client.id}>
                    <td>
                      <strong>{client.client_name}</strong>
                      <small>{client.client_code}</small>
                    </td>
                    <td>{client.city || '—'}</td>
                    <td>
                      {rep ? (
                        <div className="rep-cell">
                          <span className="rep-avatar" style={{ background: avatarColor(rep) }}>{initials(rep)}</span>
                          <span>{rep}</span>
                        </div>
                      ) : (
                        <span className="text-faint-inline">Unassigned</span>
                      )}
                    </td>
                    <td>{client.credit_limit != null ? `${money(client.credit_limit)} · ${client.credit_days ?? 0}d` : '—'}</td>
                    <td>
                      {orderCount}
                      <small style={{ display: 'block', color: 'var(--text-faint)' }}>{money(totalSales)}</small>
                    </td>
                    <td>
                      <div className="coverage-cell">
                        {client.credit_limit ? (
                          <div className="coverage-bar"><div className={`coverage-bar-fill ${tone === 'over' ? 'tone-over' : tone === 'watch' ? 'tone-watch' : ''}`} style={{ width: `${pct}%` }} /></div>
                        ) : null}
                        <span className={outstanding > 0 ? 'text-warn' : ''}>{money(outstanding)}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${client.status}`}>{client.status}</span>
                    </td>
                    <td className="master-actions">
                      <button type="button" className="icon-action" title="View distributor" aria-label={`View ${client.client_name}`} onClick={() => openView(client)}>
                        ◉
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        title={client.status === 'active' ? 'Deactivate' : 'Activate'}
                        aria-label={`Change status of ${client.client_name}`}
                        onClick={() => void toggleStatus(client)}
                      >
                        {client.status === 'active' ? '⊘' : '✓'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    <div className="empty-state">
                      <span className="empty-state-icon">▤</span>
                      <p>
                        {clients.length === 0
                          ? 'No distributors yet. Tag a client with outlet type "Distributor" in the Clients directory.'
                          : 'No distributors match your search or filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewing && viewingLedger && (
        <div className="modal-backdrop" onMouseDown={() => setViewing(null)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">DISTRIBUTOR</p>
                <h3>{viewing.client_name}</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" onClick={() => setViewing(null)}>
                ×
              </button>
            </div>

                    <dl className="detail-dl">
              <dt>Code</dt>
              <dd>{viewing.client_code}</dd>
              <dt>City</dt>
              <dd>{viewing.city || '—'}</dd>
              <dt>GSTIN</dt>
              <dd>{viewing.gstin || '—'}</dd>
              <dt>Credit terms</dt>
              <dd>{viewing.credit_limit != null ? `${money(viewing.credit_limit)} · ${viewing.credit_days ?? 0} days` : '—'}</dd>
              <dt>Total sales</dt>
              <dd>{money(viewingLedger.totalSales)}</dd>
              <dt>Total collected</dt>
              <dd>{money(viewingLedger.totalCollected)}</dd>
              <dt>Outstanding</dt>
              <dd className={viewingLedger.outstanding > 0 ? 'text-warn' : ''}>{money(viewingLedger.outstanding)}</dd>
            </dl>

            <h5 className="ledger-heading">Recent orders</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Order no.</th><th>Status</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingOrders.slice(0, 8).map((o) => (
                    <tr key={o.id}>
                      <td>{o.order_number}</td>
                      <td><span className={`status-badge status-${o.status}`}>{o.status}</span></td>
                      <td>{money(o.total_amount)}</td>
                      <td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(o.created_at))}</td>
                    </tr>
                  ))}
                  {viewingOrders.length === 0 && <tr><td colSpan={4} className="empty-row">No orders recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <h5 className="ledger-heading">Recent collections</h5>
            <div className="data-table-wrap">
              <table>
                <thead><tr><th>Amount</th><th>Mode</th><th>Date</th></tr></thead>
                <tbody>
                  {viewingCollections.slice(0, 8).map((c) => (
                    <tr key={c.id}>
                      <td>{money(c.amount)}</td>
                      <td className="capitalize">{c.mode}</td>
                      <td>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(c.collected_at))}</td>
                    </tr>
                  ))}
                  {viewingCollections.length === 0 && <tr><td colSpan={3} className="empty-row">No collections recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button type="button" className="primary-action" onClick={() => setViewing(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}