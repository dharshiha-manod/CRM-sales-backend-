import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { useIndustry, INDUSTRY_ORDER } from '../industry/IndustryContext';  
import { INDUSTRY_CONFIGS } from '../industry/mockData';
import type { IndustryKey } from '../industry/types';
import { hydrateSettingsState } from '../settings/types';
import './MasterDataPages.css';
import './NotificationsPage.css';
/* ────────────────────────────── Types ────────────────────────────── */

type Role = 'admin' | 'manager' | 'rep';
type Priority = 'normal' | 'important' | 'critical';
type QuickFilter = 'all' | 'unread' | 'read' | 'important' | 'action';
type NotifCategory = 'sales' | 'collections' | 'inventory' | 'field' | 'target' | 'followup' | 'system' | 'ivr';
type NotifIndustry = IndustryKey | 'global';
type IconName = 'cart' | 'wallet' | 'package' | 'mapPin' | 'target' | 'clock' | 'settings' | 'phone' | 'user' | 'refresh' | 'bell' | 'moreHorizontal' | 'check' | 'x' | 'search' | 'filter' | 'chevronDown';

interface DetailField { label: string; value: string; }

interface NotificationItem {
  id: string;
  category: NotifCategory;
  title: string;
  description: string;
  module: string;
  navigateTo: string;
  industry: NotifIndustry;
  roles: Role[];
  assignedTo?: string;
  timestamp: string;
  read: boolean;
  priority: Priority;
  actionRequired?: boolean;
  actionKind?: 'approve_reject' | 'view_only';
  resolved?: 'approved' | 'rejected';
  details: DetailField[];
  primaryAction: string;
}
const REP_SELF = 'Arun Kumar';

/* ────────────────────────────── Icons ────────────────────────────── */
/* Compact inline icon set (Lucide-style strokes) — keeps the redesign
   free of emoji without adding a new dependency. */

const ICON_PATHS: Record<IconName, ReactNode> = {
  cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2.5 3h2.6l2.1 11.2a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.6L21 7.5H6" /></>,
  wallet: <><path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h12.6A2.2 2.2 0 0 1 20 7.2v9.6A2.2 2.2 0 0 1 17.8 19H5.2A2.2 2.2 0 0 1 3 16.8Z" /><path d="M15.5 12.6h3v2.4h-3a1.2 1.2 0 0 1 0-2.4Z" /></>,
  package: <><path d="M3.5 7.5 12 3l8.5 4.5-8.5 4.5-8.5-4.5Z" /><path d="M3.5 7.5v9L12 21l8.5-4.5v-9" /><path d="M12 12v9" /></>,
  mapPin: <><path d="M12 21s7-6.4 7-11.6A7 7 0 0 0 5 9.4C5 14.6 12 21 12 21Z" /><circle cx="12" cy="9.4" r="2.4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.4" /><circle cx="12" cy="12" r="1" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" /></>,
  settings: <><circle cx="12" cy="12" r="2.8" /><path d="M12 3.5v2.1M12 18.4v2.1M20.5 12h-2.1M5.6 12H3.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7 6.2 6.2" /></>,
  phone: <path d="M6.6 3.8 9 3.2c.6-.15 1.2.2 1.4.8l1 3a1.15 1.15 0 0 1-.35 1.25l-1.6 1.4a12.6 12.6 0 0 0 5.35 5.35l1.4-1.6c.35-.35.85-.45 1.25-.35l3 1c.6.2.95.8.8 1.4l-.6 2.4c-.15.6-.7 1-1.3.95C11.9 18.5 5.5 12.1 4.15 4.75c-.1-.6.3-1.15.9-1.3Z" />,
  user: <><circle cx="12" cy="8.2" r="3.4" /><path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" /></>,
  refresh: <><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.4" /><path d="M20 4v4.4h-4.4" /><path d="M20 12a8 8 0 0 1-13.66 5.66L4 15.6" /><path d="M4 20v-4.4h4.4" /></>,
  bell: <><path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.4 5.6 2 6.3H4c.6-.7 2-2.3 2-6.3Z" /><path d="M10.2 19a1.8 1.8 0 0 0 3.6 0" /></>,
  moreHorizontal: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  x: <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />,
  search: <><circle cx="10.6" cy="10.6" r="6.1" /><path d="m19.5 19.5-4.3-4.3" /></>,
  filter: <path d="M3.5 5h17L14 12.6V19l-4 2v-8.4Z" />,
  chevronDown: <path d="m5.5 8.5 6.5 6.5 6.5-6.5" />,
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`nx-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ────────────────────────────── Static config ────────────────────────────── */
const CATEGORY_META: Record<NotifCategory, { label: string; icon: IconName; group: string }> = {
  sales: { label: 'Sales', icon: 'cart', group: 'Orders' },
  collections: { label: 'Collections', icon: 'wallet', group: 'Collections' },
  inventory: { label: 'Inventory', icon: 'package', group: 'Inventory' },
  field: { label: 'Field Operations', icon: 'mapPin', group: 'Visits' },
  target: { label: 'Target', icon: 'target', group: 'Targets' },
  followup: { label: 'Follow-up', icon: 'clock', group: 'Follow-ups' },
  system: { label: 'System', icon: 'settings', group: 'System' },
  ivr: { label: 'IVR / Calls', icon: 'phone', group: 'IVR' },
};

/* System notifications cover both "User Management" and "Settings" modules —
   pick the more specific icon so the feed stays meaningful, not generic. */
function iconFor(n: NotificationItem): IconName {
  if (n.category === 'system' && n.module === 'User Management') return 'user';
  return CATEGORY_META[n.category].icon;
}

const SETTINGS_CATEGORIES = ['Orders', 'Collections', 'Inventory', 'Visits', 'GPS', 'Targets', 'Follow-ups', 'IVR', 'System'] as const;

function minutesAgo(mins: number): string { return new Date(Date.now() - mins * 60_000).toISOString(); }
function daysAgo(days: number, hour = 10): string { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour, 30, 0, 0); return d.toISOString(); }

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function dateGroup(iso: string): 'Today' | 'Yesterday' | 'Earlier this week' | 'Older' {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(iso);
  const diffDays = Math.floor((startToday.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Earlier this week';
  return 'Older';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Older'] as const;
/* ────────────────────────────── Live data ────────────────────────────── */

type LiveOrder = { id: string; order_number: string; total_amount: number; created_at: string; clients?: { client_code?: string | null; client_name?: string | null } | null };
type LiveCollection = { id: string; amount: number; created_at?: string | null; sale_orders?: { order_number?: string | null } | null };
type LiveClient = { client_code?: string | null; client_name?: string | null; created_at?: string | null; industry_types?: { code?: string | null } | null };
type LiveFollowUp = {
  id: string;
  title: string;
  due_at: string;
  status: string;
  client_id?: string | null;
  lead_id?: string | null;
  clients?: { client_name?: string | null; industry_types?: { code?: string | null } | null } | null;
  leads?: { company_name?: string | null; industry_type_id?: string | null } | null;
  sales_representatives?: { user_profiles?: { display_name?: string | null } | null } | null;
};
type LiveProduct = { id: string; product_code: string; product_name: string; stock_quantity?: number | null; industry_type_id?: string | null };
type LiveIndustryType = { id: string; code: string };

// Same key ProductsPage/InventoryPage already write min-stock/expiry into —
// there's no backend column for either yet, so we read the identical
// localStorage source of truth instead of inventing a second one here.
const FMCG_META_PREFIX = 'fs-fmcg-product-meta:';
function readProductMeta(productId: string): { minStockLevel: string; expiryDate: string } {
  try {
    const raw = window.localStorage.getItem(`${FMCG_META_PREFIX}${productId}`);
    return raw ? { minStockLevel: '', expiryDate: '', ...JSON.parse(raw) } : { minStockLevel: '', expiryDate: '' };
  } catch {
    return { minStockLevel: '', expiryDate: '' };
  }
}

// There's no backend "notifications" table — read/dismissed state for these
// live-derived items is tracked client-side, the same convention used for
// rep targets and inventory meta elsewhere in this codebase.
const READ_KEY = 'fs-notifications-read';
const DISMISSED_KEY = 'fs-notifications-dismissed';
function readIdSet(key: string): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(key) ?? '[]')); } catch { return new Set(); }
}
function saveIdSet(key: string, ids: Set<string>) {
  try { window.localStorage.setItem(key, JSON.stringify([...ids])); } catch { /* best effort */ }
}

const READ_STATE_CHANGED = 'fs-notifications-read-state-changed';
function notifyReadStateChanged() { window.dispatchEvent(new Event(READ_STATE_CHANGED)); }

function industryKeyFromCode(code?: string | null): NotifIndustry {
  const key = (code ?? '').toLowerCase();
  return (INDUSTRY_ORDER as readonly string[]).includes(key) ? (key as IndustryKey) : 'global';
}

function buildLiveNotifications(sources: {
  orders: LiveOrder[]; collections: LiveCollection[]; clients: LiveClient[]; followUps: LiveFollowUp[];
  products: LiveProduct[]; industryTypes: LiveIndustryType[];
}): NotificationItem[] {
  const readIds = readIdSet(READ_KEY);
  const dismissed = readIdSet(DISMISSED_KEY);
  const clientByCode = new Map(sources.clients.map((c) => [c.client_code ?? '', c]));
  const industryTypeById = new Map(sources.industryTypes.map((t) => [t.id, t.code]));
  const money = (v: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));

  const items: NotificationItem[] = [];

  for (const o of sources.orders) {
    const id = `order-${o.id}`;
    if (dismissed.has(id)) continue;
    const client = clientByCode.get(o.clients?.client_code ?? '');
    items.push({
      id, category: 'sales', title: 'New Order Received',
      description: `${o.clients?.client_name ?? 'A customer'} placed order ${o.order_number} worth ${money(o.total_amount)}.`,
      module: 'Orders', navigateTo: 'orders', industry: industryKeyFromCode(client?.industry_types?.code), roles: ['admin', 'manager', 'rep'],
      timestamp: o.created_at, read: readIds.has(id), priority: 'normal',
      details: [{ label: 'Order', value: o.order_number }, { label: 'Customer', value: o.clients?.client_name ?? '—' }, { label: 'Amount', value: money(o.total_amount) }],
      primaryAction: 'View Order',
    });
  }

  for (const c of sources.collections) {
    const id = `collection-${c.id}`;
    if (dismissed.has(id) || !c.created_at) continue;
    items.push({
      id, category: 'collections', title: 'Payment Received',
      description: `${money(c.amount)} was collected against order ${c.sale_orders?.order_number ?? '—'}.`,
      module: 'Collections', navigateTo: 'collections', industry: 'global', roles: ['admin', 'manager', 'rep'],
      timestamp: c.created_at, read: readIds.has(id), priority: 'normal',
      details: [{ label: 'Order', value: c.sale_orders?.order_number ?? '—' }, { label: 'Amount', value: money(c.amount) }],
      primaryAction: 'View Collection',
    });
  }

  for (const c of sources.clients) {
    const id = `client-${c.client_code ?? ''}`;
    if (!c.created_at || dismissed.has(id)) continue;
    items.push({
      id, category: 'sales', title: 'New Customer',
      description: `${c.client_name ?? 'A new client'} was added as a client.`,
      module: 'Clients', navigateTo: 'clients', industry: industryKeyFromCode(c.industry_types?.code), roles: ['admin', 'manager', 'rep'],
      timestamp: c.created_at, read: readIds.has(id), priority: 'normal',
      details: [{ label: 'Client', value: c.client_name ?? '—' }],
      primaryAction: 'View Client',
    });
  }

  for (const f of sources.followUps) {
    const id = `followup-${f.id}`;
    if (dismissed.has(id) || f.status !== 'pending' || new Date(f.due_at) >= new Date()) continue;
    const isLeadFollowUp = Boolean(f.lead_id);
    const sourceName = isLeadFollowUp ? f.leads?.company_name : f.clients?.client_name;
    const industry = isLeadFollowUp
      ? industryKeyFromCode(industryTypeById.get(f.leads?.industry_type_id ?? ''))
      : industryKeyFromCode(f.clients?.industry_types?.code);
    items.push({
      id, category: 'followup', title: 'Follow-up Overdue',
      description: isLeadFollowUp
        ? `Follow up: ${sourceName ?? 'a lead'} (Lead) is overdue.`
        : `${f.title} for ${sourceName ?? 'a client'} is overdue.`,
      module: 'Follow-ups', navigateTo: 'followUps', industry, roles: ['admin', 'manager', 'rep'],
      assignedTo: f.sales_representatives?.user_profiles?.display_name ?? undefined,
      timestamp: f.due_at, read: readIds.has(id), priority: 'important',
      details: [{ label: isLeadFollowUp ? 'Lead' : 'Client', value: sourceName ?? '—' }, { label: 'Assigned to', value: f.sales_representatives?.user_profiles?.display_name ?? '—' }],
      primaryAction: 'View Follow-up',
    });
  }

  const now = Date.now();
  for (const p of sources.products) {
    const meta = readProductMeta(p.id);
    const industry = industryKeyFromCode(industryTypeById.get(p.industry_type_id ?? ''));
    const stock = p.stock_quantity ?? 0;
    const minStock = Number(meta.minStockLevel || 0);
    if (minStock > 0 && stock <= minStock) {
      const id = `lowstock-${p.id}`;
      if (!dismissed.has(id)) {
        items.push({
          id, category: 'inventory', title: 'Low Stock Alert',
          description: `${p.product_name} has fallen to ${stock} units (below the minimum of ${minStock}).`,
          module: 'Inventory', navigateTo: 'inventory', industry, roles: ['admin', 'manager'],
          timestamp: new Date().toISOString(), read: readIds.has(id), priority: stock === 0 ? 'critical' : 'important',
          details: [{ label: 'Product', value: p.product_name }, { label: 'Current stock', value: `${stock} units` }, { label: 'Reorder level', value: `${minStock} units` }],
          primaryAction: 'View Inventory',
        });
      }
    }
    if (meta.expiryDate) {
      const daysLeft = Math.ceil((new Date(meta.expiryDate).getTime() - now) / 86_400_000);
      if (daysLeft >= 0 && daysLeft <= 30) {
        const id = `expiry-${p.id}`;
        if (!dismissed.has(id)) {
          items.push({
            id, category: 'inventory', title: 'Expiry Alert',
            description: `${p.product_name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
            module: 'Inventory', navigateTo: 'inventory', industry, roles: ['admin', 'manager'],
            timestamp: new Date().toISOString(), read: readIds.has(id), priority: daysLeft <= 7 ? 'critical' : 'important',
            details: [{ label: 'Product', value: p.product_name }, { label: 'Expires', value: meta.expiryDate }],
            primaryAction: 'View Inventory',
          });
        }
      }
    }
  }

  return items;
}

// Settings → Notifications → "In-app" column. Live feed items are matched to the
// Settings event rows by title; an item with no matching row is always shown.
const SETTINGS_EVENT_BY_TITLE: Record<string, string> = {
  'New Order Received': 'New Order',
  'Payment Received': 'Collection Received',
  'Follow-up Overdue': 'Follow-up Reminder',
  'Low Stock Alert': 'Low Stock',
  'Expiry Alert': 'Expiry Alert',
};

async function loadLiveNotifications(): Promise<NotificationItem[]> {
  const [orders, collections, clients, followUps, products, industryTypes, orgSettings] = await Promise.all([
    api<{ data: LiveOrder[] }>('/orders').catch(() => ({ data: [] })),
    api<{ data: LiveCollection[] }>('/collections').catch(() => ({ data: [] })),
    api<{ data: LiveClient[] }>('/clients').catch(() => ({ data: [] })),
    api<{ data: LiveFollowUp[] }>('/follow-ups').catch(() => ({ data: [] })),
    api<{ data: LiveProduct[] }>('/products').catch(() => ({ data: [] })),
    api<{ data: LiveIndustryType[] }>('/industry-types?status=active').catch(() => ({ data: [] })),
    api<{ data: { settings?: unknown } | null }>('/organization-settings').catch(() => ({ data: null })),
  ]);
  const items = buildLiveNotifications({
    orders: orders.data ?? [], collections: collections.data ?? [], clients: clients.data ?? [],
    followUps: followUps.data ?? [], products: products.data ?? [], industryTypes: industryTypes.data ?? [],
  });
  const inAppOff = new Set(
    hydrateSettingsState(orgSettings.data?.settings).notifications.filter((row) => !row.inApp).map((row) => row.category),
  );
  return items.filter((item) => {
    const event = SETTINGS_EVENT_BY_TITLE[item.title];
    return !event || !inAppOff.has(event);
  });
}

/** Shared notification data loader for surfaces outside the notification page. */
export function useUnreadNotificationCount(): number {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadLiveNotifications().then((items) => {
        if (active) setUnreadCount(items.filter((item) => !item.read).length);
      });
    };
    refresh();
    window.addEventListener(READ_STATE_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(READ_STATE_CHANGED, refresh);
    };
  }, []);

  return unreadCount;
}

/* ────────────────────────────── Component ────────────────────────────── */

export function NotificationsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { activeIndustry } = useIndustry();

const [role, setRole] = useState<Role>('admin');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadLive() {
    setLoading(true);
    try {
      setItems(await loadLiveNotifications());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadLive(); }, []);  
  const [selected, setSelected] = useState<NotificationItem | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, { inApp: boolean; email: boolean; sms: boolean }>>(
    () => Object.fromEntries(SETTINGS_CATEGORIES.map((c) => [c, { inApp: true, email: c !== 'IVR' && c !== 'System', sms: false }])),
  );

  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week'>('all');
  const [moduleFilter, setModuleFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState<'current' | 'all' | IndustryKey>('current');

function refresh() {
    void loadLive();
  }
function markRead(id: string, read = true) {
    const ids = readIdSet(READ_KEY);
    if (read) ids.add(id); else ids.delete(id);
    saveIdSet(READ_KEY, ids);
    notifyReadStateChanged();
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read } : n)));
    setSelected((cur) => (cur && cur.id === id ? { ...cur, read } : cur));
  }
  function markAllRead() {
    const ids = readIdSet(READ_KEY);
    items.forEach((n) => ids.add(n.id));
    saveIdSet(READ_KEY, ids);
    notifyReadStateChanged();
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    setSelected((cur) => (cur ? { ...cur, read: true } : cur));
  }
  function resolve(id: string, outcome: 'approved' | 'rejected') {
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, actionRequired: false, resolved: outcome, read: true } : n)));
    setSelected((cur) => (cur && cur.id === id ? { ...cur, actionRequired: false, resolved: outcome, read: true } : cur));
  }
  function deleteNotification(id: string) {
    const ids = readIdSet(DISMISSED_KEY);
    ids.add(id);
    saveIdSet(DISMISSED_KEY, ids);
    setItems((cur) => cur.filter((n) => n.id !== id));
    setSelected((cur) => (cur && cur.id === id ? null : cur));
  }
  function openNotification(n: NotificationItem) {
    markRead(n.id, true);
    setSelected({ ...n, read: true });
  }
  function goToModule(page: string) {
    onNavigate?.(page);
  }

  /* Role + industry scoping (mirrors the CRM's global industry context) */
  const roleScoped = useMemo(() => items.filter((n) => {
    if (!n.roles.includes(role)) return false;
    // Reps only see their own assigned activity, plus broadcast items with no specific assignee.
    if (role === 'rep') return !n.assignedTo || n.assignedTo === REP_SELF;
    return true;
  }), [items, role]);

  const industryScoped = useMemo(() => roleScoped.filter((n) => {
    if (n.industry === 'global') return true;
    if (industryFilter === 'all') return true;
    if (industryFilter === 'current') return n.industry === activeIndustry;
    return n.industry === industryFilter;
  }), [roleScoped, industryFilter, activeIndustry]);

  const moduleOptions = useMemo(() => [...new Set(industryScoped.map((n) => n.module))].sort(), [industryScoped]);

  const filtered = useMemo(() => industryScoped.filter((n) => {
    const text = `${n.title} ${n.description} ${n.module}`.toLowerCase();
    if (search && !text.includes(search.toLowerCase())) return false;
    if (quickFilter === 'unread' && n.read) return false;
    if (quickFilter === 'read' && !n.read) return false;
    if (quickFilter === 'important' && n.priority === 'normal') return false;
    if (quickFilter === 'action' && !n.actionRequired) return false;
    if (moduleFilter && n.module !== moduleFilter) return false;
    if (dateFilter === 'today' && dateGroup(n.timestamp) !== 'Today') return false;
    if (dateFilter === 'week' && !['Today', 'Yesterday', 'Earlier this week'].includes(dateGroup(n.timestamp))) return false;
    return true;
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [industryScoped, search, quickFilter, moduleFilter, dateFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, NotificationItem[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const n of filtered) map.get(dateGroup(n.timestamp))!.push(n);
    return map;
  }, [filtered]);

  const unreadCount = industryScoped.filter((n) => !n.read).length;
  const todayCount = industryScoped.filter((n) => dateGroup(n.timestamp) === 'Today').length;
  const importantCount = industryScoped.filter((n) => n.priority !== 'normal').length;
  const actionCount = industryScoped.filter((n) => n.actionRequired).length;

  const filtersActive = !!(search || quickFilter !== 'all' || moduleFilter || dateFilter !== 'all');
  function clearFilters() { setSearch(''); setQuickFilter('all'); setModuleFilter(''); setDateFilter('all'); }

  return (
    <section className="page-panel master-page notifications-page">
    <div className="page-panel-heading">
        <div>
          <p className="eyebrow">CRM NOTIFICATION CENTER</p>
          <h2>Notifications</h2>
          <p>Stay updated on important activity across your CRM.</p>
        </div>
        <div className="master-actions notif-header-actions">
          <label className="notif-role-select">
            <span>Viewing as</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Switch role view">
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="rep">Sales Representative</option>
            </select>
            <Icon name="chevronDown" className="notif-role-caret" />
          </label>
          <button type="button" className="quiet-button" disabled={unreadCount === 0} onClick={markAllRead}>Mark all as read</button>
          <button type="button" className="quiet-button notif-icon-label-btn" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" /><span>Notification Settings</span>
          </button>
          <button type="button" className="icon-action" aria-label="Refresh notifications" onClick={refresh}>
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <div className="kpi-grid notif-kpi-grid">
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-ink"><Icon name="bell" /></span>
          <div>
            <span>Unread</span>
            <strong>{unreadCount}</strong>
         
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-school"><Icon name="clock" /></span>
          <div>
            <span>Today</span>
            <strong>{todayCount}</strong>
       
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-amber"><Icon name="target" /></span>
          <div>
            <span>Important</span>
            <strong>{importantCount}</strong>
            
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon kpi-icon-red"><Icon name="check" /></span>
          <div>
            <span>Action Required</span>
            <strong>{actionCount}</strong>
          
          </div>
        </div>
      </div>
<div className="master-toolbar notif-toolbar">
        <div className="notif-search-row">
          <div className="notif-search-field">
            <Icon name="search" />
            <input type="search" value={search} placeholder="Search notifications..." onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="notif-quick-filters">
            {(['all', 'unread', 'read', 'important', 'action'] as QuickFilter[]).map((f) => (
              <button key={f} type="button" className={`notif-chip ${quickFilter === f ? 'is-active' : ''}`} onClick={() => setQuickFilter(f)}>
                {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f === 'read' ? 'Read' : f === 'important' ? 'Important' : 'Action Required'}
              </button>
            ))}
          </div>
          <button type="button" className="quiet-button notif-filters-toggle" onClick={() => setFiltersOpen((o) => !o)}>
            <Icon name="filter" /> Filters
          </button>
        </div>
        <div className={`notif-filter-fields ${filtersOpen ? 'is-open' : ''}`}>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)} aria-label="Date filter">
            <option value="all">Any date</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
          </select>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} aria-label="Module filter">
            <option value="">All modules</option>
            {moduleOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value as typeof industryFilter)} aria-label="Industry filter">
            <option value="current">{INDUSTRY_CONFIGS[activeIndustry].label} (current)</option>
            <option value="all">All industries</option>
            {INDUSTRY_ORDER.map((k) => <option key={k} value={k}>{INDUSTRY_CONFIGS[k].label}</option>)}
          </select>
          <button type="button" className="link-button" disabled={!filtersActive} onClick={clearFilters}>Clear filters</button>
        </div>
      </div>
  <div className="notif-workspace">
        <div className="notif-feed-col">
          {loading ? (
            <div className="notif-list">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="notif-row notif-skeleton-row">
                  <span className="skeleton-block" style={{ width: '2.15rem', height: '2.15rem', borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}>
                    <span className="skeleton-block" style={{ width: '40%', marginBottom: '.4rem' }} />
                    <span className="skeleton-block" style={{ width: '70%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state empty-state-lg">
              <div className="empty-state-icon"><Icon name="bell" /></div>
              <h3>No notifications found</h3>
              <p>Try changing your filters or search criteria.</p>
              {filtersActive && <button type="button" className="quiet-button" onClick={clearFilters}>Clear Filters</button>}
            </div>
          ) : (
            <div className="notif-list">
              {GROUP_ORDER.filter((g) => (grouped.get(g) ?? []).length > 0).map((g) => (
                <div key={g} className="notif-group">
                  <p className="notif-group-heading">{g.toUpperCase()}</p>
                  {(grouped.get(g) ?? []).map((n) => {
                    const isSelected = selected?.id === n.id;
                    return (
                      <div
                        key={n.id}
                        className={`notif-row priority-${n.priority} ${n.read ? 'is-read' : 'is-unread'} ${n.actionRequired ? 'is-action' : ''} ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => openNotification(n)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter') openNotification(n); }}
                      >
                        <span className={`notif-icon notif-icon-${n.category}`} aria-hidden><Icon name={iconFor(n)} /></span>
                        <div className="notif-body">
                          <div className="notif-title-row">
                            {!n.read && <span className="notif-dot" aria-label="Unread" />}
                            <strong className="notif-title">{n.title}</strong>
                            {n.priority !== 'normal' && <span className={`priority-badge priority-${n.priority}`}>{n.priority}</span>}
                            {n.actionRequired && <span className="status-badge status-pending">Action required</span>}
                            {n.resolved && <span className={`status-badge status-${n.resolved === 'approved' ? 'completed' : 'cancelled'}`}>{n.resolved}</span>}
                          </div>
                          <p className="notif-desc">{n.description}</p>
                          <p className="notif-meta">
                            <span className={`notif-industry-tag ind-${n.industry}`}>{n.industry === 'global' ? 'Global' : INDUSTRY_CONFIGS[n.industry].label}</span>
                            <span>•</span><span>{n.module}</span><span>•</span><span>{timeAgo(n.timestamp)}</span>
                          </p>
                        </div>
                        <div className="notif-row-actions">
                          <button type="button" className="notif-view-btn" onClick={(e) => { e.stopPropagation(); markRead(n.id, true); goToModule(n.navigateTo); }}>{n.primaryAction}</button>
                          <div className="notif-kebab-wrap">
                            <button
                              type="button"
                              className="icon-action"
                              aria-label="More actions"
                              onClick={(e) => { e.stopPropagation(); setMenuOpenId((cur) => (cur === n.id ? null : n.id)); }}
                            >
                              <Icon name="moreHorizontal" />
                            </button>
                            {menuOpenId === n.id && (
                              <>
                                <div className="notif-menu-backdrop" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); }} />
                                <div className="notif-menu" onClick={(e) => e.stopPropagation()}>
                                  <button type="button" onClick={() => { openNotification(n); setMenuOpenId(null); }}>View details</button>
                                  {n.read
                                    ? <button type="button" onClick={() => { markRead(n.id, false); setMenuOpenId(null); }}>Mark as unread</button>
                                    : <button type="button" onClick={() => { markRead(n.id, true); setMenuOpenId(null); }}>Mark as read</button>}
                                  <button type="button" className="notif-menu-danger" onClick={() => { deleteNotification(n.id); setMenuOpenId(null); }}>Delete</button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="notif-detail-col">
          {selected ? (
            <>
              <div className="notif-detail-head">
                <p className="eyebrow">NOTIFICATION DETAILS</p>
                <div className="notif-detail-title-row">
                  <span className={`notif-icon notif-icon-${selected.category}`}><Icon name={iconFor(selected)} /></span>
                  <div>
                    <h3>{selected.title}</h3>
                    <span className={`priority-badge priority-${selected.priority}`}>{selected.priority}</span>
                  </div>
                </div>
                <p className="notif-detail-desc">{selected.description}</p>
              </div>

              <dl className="detail-dl notif-detail-dl">
                <dt>Industry</dt>
                <dd><span className={`notif-industry-tag ind-${selected.industry}`}>{selected.industry === 'global' ? 'Global' : INDUSTRY_CONFIGS[selected.industry].label}</span></dd>
                <dt>Module</dt>
                <dd>{selected.module}</dd>
                {selected.details.map((f) => (
                  <Fragment key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </Fragment>
                ))}
                <dt>Created</dt>
                <dd>{timeAgo(selected.timestamp)}</dd>
                <dt>Status</dt>
                <dd>{selected.read ? 'Read' : 'Unread'}</dd>
              </dl>

              <div className="notif-detail-actions">
                {selected.actionRequired && selected.actionKind === 'approve_reject' && !selected.resolved ? (
                  <>
                    <button type="button" className="primary-action" onClick={() => resolve(selected.id, 'approved')}><Icon name="check" /> Approve</button>
                    <button type="button" className="quiet-button" onClick={() => resolve(selected.id, 'rejected')}><Icon name="x" /> Reject</button>
                    <button type="button" className="quiet-button" onClick={() => goToModule(selected.navigateTo)}>{selected.primaryAction}</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="primary-action" onClick={() => goToModule(selected.navigateTo)}>{selected.primaryAction}</button>
                    {!selected.read && <button type="button" className="quiet-button" onClick={() => markRead(selected.id, true)}>Mark as Read</button>}
                    {selected.category === 'field' && <button type="button" className="quiet-button" onClick={() => goToModule('followUps')}>Create Follow-up</button>}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="notif-detail-empty">
              <span className="empty-state-icon"><Icon name="bell" /></span>
              <p>Select a notification to view its full details and available actions.</p>
            </div>
          )}
        </aside>
      </div>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <div className="master-modal detail-panel" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">PREFERENCES</p>
                <h3>Notification Settings</h3>
              </div>
               <button type="button" className="icon-action" aria-label="Close" onClick={() => setSettingsOpen(false)}><Icon name="x" /></button>
            </div>
            <div className="notif-settings-list">
              <div className="notif-settings-header">
                <span>Category</span><span>In-App</span><span>Email</span><span>SMS</span>
              </div>
              {SETTINGS_CATEGORIES.map((cat) => (
                <div className="notif-settings-row" key={cat}>
                  <span>{cat}</span>
                  {(['inApp', 'email', 'sms'] as const).map((ch) => (
                    <label key={ch} className={`notif-toggle ${prefs[cat][ch] ? 'is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={prefs[cat][ch]}
                        onChange={() => setPrefs((cur) => ({ ...cur, [cat]: { ...cur[cat], [ch]: !cur[cat][ch] } }))}
                      />
                      <span className="notif-toggle-track"><span className="notif-toggle-thumb" /></span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
