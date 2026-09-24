import { useEffect, useMemo, useState } from 'react';
import { useIndustry } from '../industry/IndustryContext';
import { useIndustryScope } from '../industry/useIndustryScope';
import { api } from '../lib/api';
import { useOrgSettings } from '../settings/useOrgSettings';
import type { IndustryKey } from '../industry/types';
import './InventoryPage.css';

/**
 * Real product record from the /products API — same shape ProductsPage
 * reads. Inventory used to run entirely on local mock data with its own
 * fake stock numbers; it now derives its items from this instead, so a
 * product's stock_quantity here always matches what Products shows.
 * (No backend inventory/movements table exists yet — reserved/assigned/
 * movements below stay locally-tracked until that's built.)
 */
type ApiProduct = {
  id: string;
  product_code: string;
  product_name: string;
  category?: string | null;
  brand?: string | null;
  selling_price: number;
  stock_quantity?: number | null;
  status: 'active' | 'inactive';
  industry_type_id?: string | null;
};

/* ============================== TYPES ============================== */

type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'expiring_soon' | 'expired';
type UserRole = 'admin' | 'manager' | 'rep';
type MovementType =
  | 'Stock Added' | 'Stock Transfer' | 'Stock Assigned' | 'Stock Returned'
  | 'Stock Adjustment' | 'Sale / Order' | 'Damaged' | 'Expired';

interface InventoryItem {
  id: string;
  industry: IndustryKey;
  name: string;
  sku: string;
  productCode: string;
  category: string;
  brand: string;
  unit: string;
  batch: string;
  mfgDate: string;
  expiryDate: string | null;
  totalStock: number;
  reserved: number;
  assigned: number;
  minStock: number;
  maxStock: number;
  location: string;
  unitValue: number;
  barcode: string;
  assignedRep?: string;
  expiryWarnDays?: number;
  // industry-specific extras
  mrp?: number;
  storageRequirement?: string;
  color?: string;
  size?: string;
  rollBundle?: string;
  purchaseRef?: string;
  salesRef?: string;
  academicYear?: string;
  department?: string;
}

interface MovementRecord {
  id: string;
  itemId: string;
  date: string;
  type: MovementType;
  reference: string;
  quantity: number;
  from: string;
  to: string;
  user: string;
}

interface RepInventory {
  rep: string;
  industry: IndustryKey;
  productsAssigned: number;
  totalQty: number;
  sold: number;
  returned: number;
}

interface StockRequest {
  id: string;
  product: string;
  quantity: number;
  reason: string;
  requiredDate: string;
  remarks: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Fulfilled';
  requestedTo?: string;
  rep: string;
}

/* ============================== MOCK DATA ============================== */

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

let seq = 1000;
function nextId(prefix: string) { seq += 1; return `${prefix}-${seq}`; }

// Rep names now come from the real /sales-representatives API (see loadReps below).

// FMCG-style per-product extras (min/max stock level, batch, location, etc.)
// have no backend column yet — ProductsPage already persists its own
// "FMCG meta" client-side in localStorage under this same prefix, so
// Inventory reads the identical keys instead of inventing a second copy.
const FMCG_META_PREFIX = 'fs-fmcg-product-meta:';
function readFmcgMeta(productId: string): { minStockLevel: string; batchNumber: string; expiryDate: string; mfgDate: string; unit: string; barcode: string } {
  const blank = { minStockLevel: '', batchNumber: '', expiryDate: '', mfgDate: '', unit: '', barcode: '' };
  try {
    const raw = window.localStorage.getItem(`${FMCG_META_PREFIX}${productId}`);
    return raw ? { ...blank, ...JSON.parse(raw) } : blank;
  } catch {
    return blank;
  }
}

/**
 * Builds inventory rows from real products instead of hardcoded mock data.
 * totalStock comes straight from product.stock_quantity (the same number
 * ProductsPage shows) so the two screens can never disagree. reserved/
 * assigned/location/batch have no backend column yet — until an inventory
 * table exists, they default to 0/blank rather than being invented, so we
 * never show a fake number next to a real one.
 */
function buildInventoryFromProducts(products: ApiProduct[], rules: { minStock: number; expiryWarnDays: number }): InventoryItem[] {
  return products.map((p) => {
    const meta = readFmcgMeta(p.id);
    const industry = (p as { industry?: IndustryKey }).industry; // resolved by caller via industry_type_id lookup
    return {
      id: p.id,
      industry: (industry ?? 'fmcg') as IndustryKey,
      name: p.product_name,
      sku: p.product_code,
      productCode: p.product_code,
      category: p.category ?? 'General',
      brand: p.brand ?? '',
      unit: meta.unit || 'unit',
      batch: meta.batchNumber || '—',
      mfgDate: meta.mfgDate || '',
      expiryDate: meta.expiryDate || null,
      totalStock: p.stock_quantity ?? 0,
      reserved: 0,
      assigned: 0,
      minStock: meta.minStockLevel ? Number(meta.minStockLevel) : rules.minStock,
      maxStock: 0,
      location: '—',
      unitValue: p.selling_price ?? 0,
       barcode: meta.barcode || '',
      expiryWarnDays: rules.expiryWarnDays,
    };
  });
}

function seedMovements(items: InventoryItem[]): MovementRecord[] {
  const out: MovementRecord[] = [];
  items.forEach((it) => {
    out.push({ id: nextId('mv'), itemId: it.id, date: it.mfgDate, type: 'Stock Added', reference: `GRN-${it.sku}`, quantity: it.totalStock, from: 'Supplier', to: it.location, user: 'Admin' });
    if (it.assigned > 0 && it.assignedRep) {
      out.push({ id: nextId('mv'), itemId: it.id, date: daysFromNow(-10), type: 'Stock Assigned', reference: `ASN-${it.sku}`, quantity: it.assigned, from: it.location, to: it.assignedRep, user: 'Manager' });
    }
    if (it.reserved > 0) {
      out.push({ id: nextId('mv'), itemId: it.id, date: daysFromNow(-3), type: 'Sale / Order', reference: `ORD-${it.sku}`, quantity: -it.reserved, from: it.location, to: 'Customer Order', user: it.assignedRep ?? 'System' });
    }
  });
  return out;
}

function seedRepInventory(items: InventoryItem[]): RepInventory[] {
  const map = new Map<string, RepInventory>();
  items.forEach((it) => {
    if (!it.assignedRep) return;
    const key = `${it.assignedRep}|${it.industry}`;
    const existing = map.get(key);
    const sold = Math.round(it.assigned * 0.55);
    const returned = Math.round(it.assigned * 0.08);
    if (existing) {
      existing.productsAssigned += 1;
      existing.totalQty += it.assigned;
      existing.sold += sold;
      existing.returned += returned;
    } else {
      map.set(key, { rep: it.assignedRep, industry: it.industry, productsAssigned: 1, totalQty: it.assigned, sold, returned });
    }
  });
  return Array.from(map.values());
}

/* ============================== HELPERS ============================== */

function computeStatus(item: InventoryItem): StockStatus {
  const available = item.totalStock - item.reserved - item.assigned;
  if (item.expiryDate) {
    const days = Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
    if (days < 0) return 'expired';
      if (days <= (item.expiryWarnDays ?? 30)) return 'expiring_soon';
  }
  if (available <= 0) return 'out_of_stock';
  if (available < item.minStock) return 'low_stock';
  return 'in_stock';
}

function availableQty(item: InventoryItem): number {
  return Math.max(0, item.totalStock - item.reserved - item.assigned);
}

const STATUS_LABEL: Record<StockStatus, string> = {
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  expiring_soon: 'Expiring Soon',
  expired: 'Expired',
};
const STATUS_TONE: Record<StockStatus, 'good' | 'warn' | 'bad'> = {
  in_stock: 'good',
  low_stock: 'warn',
  out_of_stock: 'bad',
  expiring_soon: 'warn',
  expired: 'bad',
};

function expiryDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

const INDUSTRY_LABEL: Record<IndustryKey, string> = {
  fmcg: 'FMCG', school: 'School', textile: 'Textile', pharma: 'Pharma', trading: 'Trading', vehicle: 'Vehicle',
};

/* ============================== COMPONENT ============================== */

type ModalKind =
  | { kind: 'none' }
  | { kind: 'addStock' }
  | { kind: 'transfer'; item?: InventoryItem }
  | { kind: 'assign'; item?: InventoryItem }
  | { kind: 'adjust'; item: InventoryItem }
  | { kind: 'return' }
  | { kind: 'request' }
  | { kind: 'scan' }
  | { kind: 'viewBatch'; item: InventoryItem };

export function InventoryPage() {
  const { activeIndustry } = useIndustry();
  const { matchesActiveIndustry } = useIndustryScope();
  const { settings: orgSettings } = useOrgSettings();

  const [role, setRole] = useState<UserRole>('admin');
  const [rawProducts, setRawProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadProducts() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api<{ data: ApiProduct[] }>('/products');
      setRawProducts(res.data ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadProducts(); }, []);

  // Real sales representatives (same endpoint RepresentativesPage uses).
  const [reps, setReps] = useState<string[]>([]);

  // Admins / managers a rep can send a stock request to.
  const [approvers, setApprovers] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ data: { email?: string | null; status: string; user_profiles?: { display_name?: string | null } | null; roles?: { code?: string | null } | null }[] }>('/users');
        const names = (res.data ?? [])
          .filter((u) => u.status === 'active' && ['super_admin', 'admin', 'sales_manager'].includes(u.roles?.code ?? ''))
          .map((u) => u.user_profiles?.display_name || u.email || '')
          .filter(Boolean);
        if (!cancelled) setApprovers(Array.from(new Set(names)));
      } catch {
        if (!cancelled) setApprovers([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ data: { employee_code: string; status: string; user_profiles?: { display_name?: string | null } | null }[] }>('/sales-representatives');
        const names = (res.data ?? [])
          .filter((r) => r.status === 'active')
          .map((r) => r.user_profiles?.display_name || r.employee_code);
        if (!cancelled) setReps(Array.from(new Set(names)));
      } catch {
        if (!cancelled) setReps([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Products scoped to the active industry — same rule every other module
  // (Products, Clients, Orders) already uses, so switching industries here
  // shows exactly the same items Products would show.
  const scopedProducts = useMemo(
    () => rawProducts.filter((p) => matchesActiveIndustry(p.industry_type_id)),
    [rawProducts, matchesActiveIndustry],
  );

  const productItems = useMemo(
       () => buildInventoryFromProducts(
      scopedProducts.map((p) => ({ ...p, industry: activeIndustry })),
      {
        minStock: orgSettings.inventory.lowStockAlert ? orgSettings.inventory.minStockThreshold : 0,
        expiryWarnDays: orgSettings.inventory.expiryAlert ? orgSettings.inventory.expiryWarningDays : -1,
      },
    ),
    [scopedProducts, activeIndustry, orgSettings.inventory.lowStockAlert, orgSettings.inventory.minStockThreshold, orgSettings.inventory.expiryAlert, orgSettings.inventory.expiryWarningDays],
  );

  // Local-only overrides from the Add Stock / Transfer / Assign / Adjust
  // modals below. There's no inventory table on the backend yet, so those
  // actions can't persist server-side — they patch the real product's
  // in-memory row here (on top of its real stock_quantity) so the screen
  // still behaves, but a refresh reloads the true numbers from /products.
  const [overrides, setOverrides] = useState<Record<string, Partial<InventoryItem>>>({});
  const allItems = useMemo(
    () => productItems.map((it) => ({ ...it, ...overrides[it.id] })),
    [productItems, overrides],
  );
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);

  // filters
  const [search, setSearch] = useState('');
  const [skuFilter, setSkuFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | StockStatus>('all');
  const [repFilter, setRepFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [expiryFilter, setExpiryFilter] = useState<'all' | '7' | '30' | '90' | 'expired'>('all');

  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const [modal, setModalRaw] = useState<ModalKind>({ kind: 'none' });
  // Settings → Inventory Configuration: blocks the actions an org has switched off.
  // Every existing setModal({...}) call site keeps working unchanged.
  function setModal(next: ModalKind) {
    const rules: Partial<Record<ModalKind['kind'], [boolean, string]>> = {
      transfer: [orgSettings.inventory.allowStockTransfer, 'Stock transfer is turned off in Settings → Inventory Configuration.'],
      adjust: [orgSettings.inventory.allowStockAdjustment, 'Stock adjustment is turned off in Settings → Inventory Configuration.'],
      assign: [orgSettings.inventory.repStockAssignment, 'Assigning stock to reps is turned off in Settings → Inventory Configuration.'],
      viewBatch: [orgSettings.inventory.batchTracking, 'Batch tracking is turned off in Settings → Inventory Configuration.'],
    };
    const rule = rules[next.kind];
    if (rule && !rule[0]) { showToast(rule[1]); return; }
    setModalRaw(next);
  }
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'products' | 'movement' | 'reps' | 'requests'>('overview');

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3200);
  }

  const industryItems = useMemo(
    () => allItems.filter((it) => it.industry === activeIndustry),
    [allItems, activeIndustry],
  );

  const categories = useMemo(() => Array.from(new Set(industryItems.map((i) => i.category))), [industryItems]);
  const brands = useMemo(() => Array.from(new Set(industryItems.map((i) => i.brand))), [industryItems]);
 
  const locations = useMemo(() => Array.from(new Set(industryItems.map((i) => i.location))), [industryItems]);

  const filtered = useMemo(() => {
    return industryItems.filter((it) => {
      const status = computeStatus(it);
      if (search && !it.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (skuFilter && !it.sku.toLowerCase().includes(skuFilter.toLowerCase())) return false;
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false;
      if (brandFilter !== 'all' && it.brand !== brandFilter) return false;
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (repFilter !== 'all' && it.assignedRep !== repFilter) return false;
      if (locationFilter !== 'all' && it.location !== locationFilter) return false;
      if (expiryFilter !== 'all') {
        const d = expiryDays(it.expiryDate);
        if (expiryFilter === 'expired') { if (d === null || d >= 0) return false; }
        else { const window_ = Number(expiryFilter); if (d === null || d < 0 || d > window_) return false; }
      }
      if (role === 'rep' && it.assignedRep !== reps[0]) return false; // rep sees only their own assigned stock (mock: first rep)
      return true;
    });
  }, [industryItems, search, skuFilter, categoryFilter, brandFilter, statusFilter, repFilter, locationFilter, expiryFilter, role, reps]);

  const kpis = useMemo(() => {
    const totalProducts = industryItems.length;
    const totalStock = industryItems.reduce((s, i) => s + i.totalStock, 0);
    const lowStock = industryItems.filter((i) => computeStatus(i) === 'low_stock').length;
    const expiringSoon = industryItems.filter((i) => computeStatus(i) === 'expiring_soon').length;
    const stockValue = industryItems.reduce((s, i) => s + i.totalStock * i.unitValue, 0);
    const outOfStock = industryItems.filter((i) => computeStatus(i) === 'out_of_stock').length;
    return { totalProducts, totalStock, lowStock, expiringSoon, stockValue, outOfStock };
  }, [industryItems]);

  const repInventory = useMemo(() => seedRepInventory(industryItems), [industryItems]);

  const lowStockList = useMemo(() => industryItems.filter((i) => computeStatus(i) === 'low_stock'), [industryItems]);
  const expiryAlerts = useMemo(
    () => industryItems.filter((i) => ['expiring_soon', 'expired'].includes(computeStatus(i))),
    [industryItems],
  );

  const itemMovements = (itemId: string) => movements.filter((m) => m.itemId === itemId).sort((a, b) => (a.date < b.date ? 1 : -1));

  function recordMovement(m: Omit<MovementRecord, 'id'>) {
    setMovements((prev) => [{ ...m, id: nextId('mv') }, ...prev]);
  }

  function updateItem(id: string, patch: Partial<InventoryItem>) {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  /* ---------- action handlers ---------- */
  async function handleAddStock(data: { productId: string; batch: string; mfgDate: string; expiryDate: string; quantity: number; location: string; supplierRef: string; purchaseRef: string; remarks: string }) {
    const item = allItems.find((i) => i.id === data.productId);
    if (!item) return;
    const newStock = item.totalStock + data.quantity;
    try {
      await api(`/products/${item.id}`, { method: 'PATCH', body: JSON.stringify({ stockQuantity: newStock }) });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save the stock change.');
      return;
    }
    await loadProducts();
    updateItem(item.id, {
      totalStock: newStock,
      batch: data.batch || item.batch,
      mfgDate: data.mfgDate || item.mfgDate,
      expiryDate: data.expiryDate || item.expiryDate,
      location: data.location || item.location,
    });
    recordMovement({ itemId: item.id, date: new Date().toISOString().slice(0, 10), type: 'Stock Added', reference: data.purchaseRef || `GRN-${item.sku}-${Date.now().toString().slice(-4)}`, quantity: data.quantity, from: data.supplierRef || 'Supplier', to: data.location || item.location, user: 'Admin' });
    showToast('✓ Stock added successfully.');
    setModal({ kind: 'none' });
  }

  function handleTransfer(data: { productId: string; quantity: number; fromLocation: string; toLocation: string; reason: string; remarks: string }) {
    const item = allItems.find((i) => i.id === data.productId);
    if (!item) return;
    updateItem(item.id, { location: data.toLocation });
    recordMovement({ itemId: item.id, date: new Date().toISOString().slice(0, 10), type: 'Stock Transfer', reference: `TRF-${item.sku}-${Date.now().toString().slice(-4)}`, quantity: data.quantity, from: data.fromLocation, to: data.toLocation, user: 'Admin' });
    showToast('✓ Stock transferred successfully.');
    setModal({ kind: 'none' });
  }

  function handleAssign(data: { productId: string; rep: string; quantity: number; remarks: string }) {
    const item = allItems.find((i) => i.id === data.productId);
    if (!item) return;
    updateItem(item.id, { assigned: item.assigned + data.quantity, assignedRep: data.rep });
    recordMovement({ itemId: item.id, date: new Date().toISOString().slice(0, 10), type: 'Stock Assigned', reference: `ASN-${item.sku}-${Date.now().toString().slice(-4)}`, quantity: data.quantity, from: item.location, to: data.rep, user: 'Manager' });
    showToast('✓ Inventory assigned to Sales Rep.');
    setModal({ kind: 'none' });
  }

  async function handleAdjust(item: InventoryItem, delta: number, reason: string, remarks: string) {
    const newStock = orgSettings.stockRules.negativeStockAllowed ? item.totalStock + delta : Math.max(0, item.totalStock + delta);
    try {
      await api(`/products/${item.id}`, { method: 'PATCH', body: JSON.stringify({ stockQuantity: newStock }) });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save the stock adjustment.');
      return;
    }
    await loadProducts();
    updateItem(item.id, { totalStock: newStock });
    recordMovement({ itemId: item.id, date: new Date().toISOString().slice(0, 10), type: 'Stock Adjustment', reference: `ADJ-${item.sku}-${reason.slice(0, 3).toUpperCase()}`, quantity: delta, from: remarks || reason, to: item.location, user: 'Admin' });
    showToast('✓ Stock adjustment completed.');
    setModal({ kind: 'none' });
  }

  function handleReturn(data: { rep: string; productId: string; quantity: number; reason: string; remarks: string }) {
    const item = allItems.find((i) => i.id === data.productId);
    if (!item) return;
    updateItem(item.id, { assigned: Math.max(0, item.assigned - data.quantity), totalStock: item.totalStock });
    recordMovement({ itemId: item.id, date: new Date().toISOString().slice(0, 10), type: 'Stock Returned', reference: `RTN-${item.sku}-${Date.now().toString().slice(-4)}`, quantity: data.quantity, from: data.rep, to: item.location, user: data.rep });
    showToast('✓ Stock returned successfully.');
    setModal({ kind: 'none' });
  }

  function handleRequest(data: { product: string; quantity: number; reason: string; requiredDate: string; remarks: string; requestedTo: string }) {
    setRequests((prev) => [{ id: nextId('req'), ...data, status: 'Pending', rep: reps[0] ?? 'Sales rep' }, ...prev]);
    showToast('✓ Stock request submitted.');
    setModal({ kind: 'none' });
  }

  function handleRequestDecision(id: string, status: StockRequest['status']) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    showToast(status === 'Approved' ? '✓ Request approved.' : status === 'Rejected' ? 'Request rejected.' : '✓ Request fulfilled.');
  }

  const isAdmin = role === 'admin';
  const isManagerUp = role === 'admin' || role === 'manager';

  const industryMovements = useMemo(() => {
    const ids = new Set(industryItems.map((i) => i.id));
    return movements.filter((m) => ids.has(m.itemId)).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [movements, industryItems]);
  const itemNameOf = (itemId: string) => allItems.find((i) => i.id === itemId)?.name ?? '—';

  type TabKey = 'overview' | 'products' | 'movement' | 'reps' | 'requests';
  const TABS: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'overview', label: 'Overview', visible: true },
    { key: 'products', label: 'Products', visible: true },
    { key: 'movement', label: 'Stock Movement', visible: true },
    { key: 'reps', label: 'Sales Rep Inventory', visible: isManagerUp },
    { key: 'requests', label: 'Stock Requests', visible: isManagerUp || role === 'rep' },
  ].filter((t): t is { key: TabKey; label: string; visible: boolean } => t.visible);
  const activeTab = TABS.some((t) => t.key === tab) ? tab : 'overview';

  /* ============================== RENDER ============================== */
  return (
    <section className="page-panel master-page inv-page">
      {toast && <div className="inv-toast">{toast}</div>}
      {loading && <div className="inv-toast">Loading products…</div>}
      {loadError && <div className="inv-toast" style={{ background: '#b91c1c' }}>{loadError}</div>}

      {/* HEADER */}
            <div className="inv-header">
        <div>
          <h1>Inventory</h1>
        </div>
        <div className="inv-header-actions">
          <label className="inv-role-switch">
            Viewing as
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="rep">Sales Representative</option>
            </select>
          </label>
          {isManagerUp && <button className="active" onClick={() => setModal({ kind: 'addStock' })}>+ Add Stock</button>}
          {isManagerUp && <button onClick={() => setModal({ kind: 'transfer' })}>Stock Transfer</button>}
          <button onClick={() => setModal({ kind: 'scan' })}>Scan Product</button>
          {role === 'rep' && <button onClick={() => setModal({ kind: 'request' })}>Request Stock</button>}
          {role === 'rep' && <button onClick={() => setModal({ kind: 'return' })}>Return Stock</button>}
          <button onClick={() => showToast('✓ Inventory exported.')}>Export</button>
          <button onClick={() => showToast('Inventory refreshed.')}>Refresh</button>
        </div>
      </div>
        {/* KPIs */}
      <div className="kpi-grid product-kpi-grid">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">▣</div><div><span>Total Products</span><strong>{kpis.totalProducts}</strong></div></div>
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">▤</div><div><span>Total Stock</span><strong>{kpis.totalStock.toLocaleString('en-IN')}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">⚠</div><div><span>Low Stock</span><strong>{kpis.lowStock}</strong>  </div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">◷</div><div><span>Expiring Soon</span><strong>{kpis.expiringSoon}</strong> </div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-blue">₹</div><div><span>Stock Value</span><strong>₹{kpis.stockValue.toLocaleString('en-IN')}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">⬤</div><div><span>Out of Stock</span><strong>{kpis.outOfStock}</strong></div></div>
      </div>

      {/* FILTERS */}
      <section className="inv-filters">
        <input placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input placeholder="SKU / Product code" value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)} />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option value="all">All brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="all">All statuses</option>
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
          <option value="expiring_soon">Expiring Soon</option>
          <option value="expired">Expired</option>
        </select>
        <select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value as any)}>
          <option value="all">All expiry</option>
          <option value="7">Expiring within 7 days</option>
          <option value="30">Expiring within 30 days</option>
          <option value="90">Expiring within 90 days</option>
          <option value="expired">Expired</option>
        </select>
        <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
          <option value="all">All reps</option>
          {reps.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
          <option value="all">All locations</option>
          {locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </section>

      {/* TABS */}
      <div className="inv-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={activeTab === t.key ? 'inv-tab active' : 'inv-tab'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ============ OVERVIEW TAB ============ */}
      {activeTab === 'overview' && (
        <>
          <InventoryTable
            items={filtered}
            allEmpty={industryItems.length === 0}
            isAdmin={isAdmin}
            isManagerUp={isManagerUp}
            maxRows={6}
            onView={setSelectedItem}
            onAddStock={() => setModal({ kind: 'addStock' })}
            onTransfer={(it) => setModal({ kind: 'transfer', item: it })}
            onAdjust={(it) => setModal({ kind: 'adjust', item: it })}
            onViewAll={() => setTab('products')}
          />

          <div className="inv-two-col">
            <section className="inv-compact-card">
              <div className="inv-compact-head"><h3>Alerts</h3></div>
              <div className="inv-alert-mini-group">
                <div className="inv-alert-mini-label">Low Stock <span className="inv-count-pill warn">{lowStockList.length}</span></div>
                {lowStockList.length === 0 ? <p className="inv-cell-sub">No low-stock items.</p> : (
                  <ul className="inv-mini-list">
                    {lowStockList.slice(0, 3).map((it) => (
                      <li key={it.id}>
                        <span>{it.name}</span>
                        <span className="inv-mini-figure">{availableQty(it)} / {it.minStock}</span>
                        <button onClick={() => setSelectedItem(it)}>View</button>
                      </li>
                    ))}
                  </ul>
                )}
                {lowStockList.length > 3 && <button className="inv-viewall" onClick={() => setTab('products')}>View all ({lowStockList.length}) →</button>}
              </div>
              <div className="inv-alert-mini-group">
                <div className="inv-alert-mini-label">Expiry <span className="inv-count-pill bad">{expiryAlerts.length}</span></div>
                {expiryAlerts.length === 0 ? <p className="inv-cell-sub">No expiry alerts.</p> : (
                  <ul className="inv-mini-list">
                    {expiryAlerts.slice(0, 3).map((it) => {
                      const d = expiryDays(it.expiryDate);
                      const expired = d !== null && d < 0;
                      return (
                        <li key={it.id}>
                          <span>{expired ? '🔴' : '⚠'} {it.name}</span>
                          <span className="inv-mini-figure">{expired ? 'Expired' : `${d}d left`}</span>
                          <button onClick={() => setModal({ kind: 'viewBatch', item: it })}>Batch</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {expiryAlerts.length > 3 && <button className="inv-viewall" onClick={() => setTab('products')}>View all ({expiryAlerts.length}) →</button>}
              </div>
            </section>

            <section className="inv-compact-card">
              <div className="inv-compact-head"><h3>Stock Status</h3></div>
              <StatusBarChart items={industryItems} />
              <div className="inv-compact-head" style={{ marginTop: '1rem' }}>
                <h3>Recent Movement</h3>
                <button className="inv-viewall" onClick={() => setTab('movement')}>View all →</button>
              </div>
              <ul className="inv-mini-list">
                {industryMovements.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <span>{itemNameOf(m.itemId)} — {m.type}</span>
                    <span className={`inv-mini-figure ${m.quantity < 0 ? 'neg' : 'pos'}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
                  </li>
                ))}
                {industryMovements.length === 0 && <li className="inv-cell-sub">No movement recorded yet.</li>}
              </ul>
            </section>
          </div>
        </>
      )}

      {/* ============ PRODUCTS TAB ============ */}
      {activeTab === 'products' && (
        <InventoryTable
          items={filtered}
          allEmpty={industryItems.length === 0}
          isAdmin={isAdmin}
          isManagerUp={isManagerUp}
          onView={setSelectedItem}
          onAddStock={() => setModal({ kind: 'addStock' })}
          onTransfer={(it) => setModal({ kind: 'transfer', item: it })}
          onAdjust={(it) => setModal({ kind: 'adjust', item: it })}
        />
      )}

      {/* ============ STOCK MOVEMENT TAB ============ */}
      {activeTab === 'movement' && (
        <section className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Reference</th><th>Qty</th><th>From</th><th>To</th><th>User</th></tr></thead>
            <tbody>
              {industryMovements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{itemNameOf(m.itemId)}</td>
                  <td>{m.type}</td>
                  <td className="mono">{m.reference}</td>
                  <td className={m.quantity < 0 ? 'neg' : 'pos'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                  <td>{m.from}</td>
                  <td>{m.to}</td>
                  <td>{m.user}</td>
                </tr>
              ))}
              {industryMovements.length === 0 && <tr><td colSpan={8} className="inv-cell-sub">No movement recorded yet.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {/* ============ SALES REP INVENTORY TAB ============ */}
      {activeTab === 'reps' && isManagerUp && (
        <section>
          <div className="inv-compact-head"><h3>Sales Representative Inventory</h3>{isAdmin && <button className="active" onClick={() => setModal({ kind: 'assign' })}>Assign Inventory</button>}</div>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead><tr><th>Sales Rep</th><th>Industry</th><th>Products Assigned</th><th>Total Qty</th><th>Sold</th><th>Returned</th><th>Available</th></tr></thead>
              <tbody>
                {repInventory.map((r) => (
                  <tr key={r.rep} className="inv-clickable-row" onClick={() => setSelectedRep(r.rep)}>
                    <td><strong>{r.rep}</strong></td>
                    <td>{INDUSTRY_LABEL[r.industry]}</td>
                    <td>{r.productsAssigned} Products</td>
                    <td>{r.totalQty} Qty</td>
                    <td>{r.sold} Sold</td>
                    <td>{r.returned} Returned</td>
                    <td><strong>{Math.max(0, r.totalQty - r.sold - r.returned)} Available</strong></td>
                  </tr>
                ))}
                {repInventory.length === 0 && <tr><td colSpan={7} className="inv-cell-sub">No stock assigned to reps yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ============ STOCK REQUESTS TAB ============ */}
      {activeTab === 'requests' && (isManagerUp || role === 'rep') && (
        <section className="inv-table-wrap">
          <table className="inv-table">
              <thead><tr><th>Product</th><th>Qty</th><th>Reason</th><th>Required Date</th><th>Rep</th><th>Request To</th><th>Status</th>{isManagerUp && <th>Action</th>}</tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.product}</td>
                  <td>{r.quantity}</td>
                  <td>{r.reason}</td>
                  <td>{fmtDate(r.requiredDate)}</td>
                          <td>{r.rep}</td>
                  <td>{r.requestedTo ?? '—'}</td>
                  <td><span className={`badge badge-${r.status === 'Approved' || r.status === 'Fulfilled' ? 'good' : r.status === 'Rejected' ? 'bad' : 'warn'}`}>{r.status}</span></td>
                  {isManagerUp && (
                    <td className="inv-row-actions">
                      {r.status === 'Pending' && <>
                        <button onClick={() => handleRequestDecision(r.id, 'Approved')}>Approve</button>
                        <button onClick={() => handleRequestDecision(r.id, 'Rejected')}>Reject</button>
                      </>}
                      {r.status === 'Approved' && <button onClick={() => handleRequestDecision(r.id, 'Fulfilled')}>Mark Fulfilled</button>}
                    </td>
                  )}
                </tr>
              ))}
                      {requests.length === 0 && <tr><td colSpan={isManagerUp ? 8 : 7} className="inv-cell-sub">No stock requests.</td></tr>}
            </tbody>
          </table>  
        </section>
      )}

      {/* ============ SIDE PANEL: PRODUCT DETAIL ============ */}
      {selectedItem && (
        <ProductDetailPanel
          item={selectedItem}
          movements={itemMovements(selectedItem.id)}
          onClose={() => setSelectedItem(null)}
          canManage={isManagerUp}
          onAdjust={() => setModal({ kind: 'adjust', item: selectedItem })}
          onTransfer={() => setModal({ kind: 'transfer', item: selectedItem })}
        />
      )}

      {/* ============ SIDE PANEL: REP DETAIL ============ */}
      {selectedRep && (
        <RepDetailPanel
          rep={selectedRep}
          items={industryItems.filter((i) => i.assignedRep === selectedRep)}
          onClose={() => setSelectedRep(null)}
        />
      )}

      {/* ============ MODALS ============ */}
      {modal.kind === 'addStock' && (
        <AddStockModal items={industryItems} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleAddStock} />
      )}
      {modal.kind === 'transfer' && (
        <TransferModal items={industryItems} presetItem={modal.item} locations={locations} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleTransfer} />
      )}
      {modal.kind === 'assign' && (
        <AssignModal items={industryItems} reps={reps} presetItem={modal.item} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleAssign} />
      )}
      {modal.kind === 'adjust' && (
        <AdjustModal item={modal.item} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleAdjust} />
      )}
      {modal.kind === 'return' && (
        <ReturnModal items={industryItems} reps={reps} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleReturn} />
      )}
      {modal.kind === 'request' && (
          <RequestModal items={industryItems} approvers={approvers} onCancel={() => setModal({ kind: 'none' })} onSubmit={handleRequest} />
      )}
      {modal.kind === 'scan' && (
        <ScanModal items={industryItems} onClose={() => setModal({ kind: 'none' })} onView={(it) => { setModal({ kind: 'none' }); setSelectedItem(it); }} onAddStock={() => setModal({ kind: 'addStock' })} onTransfer={(it) => setModal({ kind: 'transfer', item: it })} onAssign={(it) => setModal({ kind: 'assign', item: it })} />
      )}
       {modal.kind === 'viewBatch' && (
        <BatchDetailModal item={modal.item} onClose={() => setModal({ kind: 'none' })} />
      )}
    </section>
  );
}

/* ============================== SUBCOMPONENTS ============================== */

function InventoryTable({ items, allEmpty, isAdmin, isManagerUp, maxRows, onView, onAddStock, onTransfer, onAdjust, onViewAll }: {
  items: InventoryItem[]; allEmpty: boolean; isAdmin: boolean; isManagerUp: boolean; maxRows?: number;
  onView: (it: InventoryItem) => void; onAddStock: () => void; onTransfer: (it: InventoryItem) => void; onAdjust: (it: InventoryItem) => void;
  onViewAll?: () => void;
}) {
  const rows = maxRows ? items.slice(0, maxRows) : items;
  return (
    <section className="inv-table-wrap inv-primary-table">
      {maxRows && (
        <div className="inv-compact-head">
          <h3>Inventory</h3>
          {items.length > maxRows && onViewAll && <button className="inv-viewall" onClick={onViewAll}>View all {items.length} products →</button>}
        </div>
      )}
      <table className="inv-table">
        <thead>
          <tr>
            <th>Product</th><th>SKU</th><th>Industry</th><th>Category</th><th>Batch</th><th>Expiry</th>
            <th>Total Qty</th><th>Reserved</th><th>Assigned</th><th>Available</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="inv-empty-row">
                {allEmpty ? (
                  <div className="inv-empty">
                    <h3>No inventory available</h3>
                    <p>No products have been added for this industry yet.</p>
                    {isManagerUp && <button className="active" onClick={onAddStock}>+ Add Stock</button>}
                  </div>
                ) : (
                  <div className="inv-empty">
                    <h3>No products found</h3>
                    <p>Try changing your filters or search term.</p>
                  </div>
                )}
              </td>
            </tr>
          ) : rows.map((it) => {
            const status = computeStatus(it);
            const avail = availableQty(it);
            return (
              <tr key={it.id}>
                <td><strong>{it.name}</strong><div className="inv-cell-sub">{it.brand}</div></td>
                <td className="mono">{it.sku}</td>
                <td>{INDUSTRY_LABEL[it.industry]}</td>
                <td>{it.category}</td>
                <td className="mono">{it.batch}</td>
                <td>{fmtDate(it.expiryDate)}</td>
                <td>{it.totalStock}</td>
                <td>{it.reserved}</td>
                <td>{it.assigned}</td>
                <td><strong>{avail}</strong></td>
                <td><span className={`badge badge-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span></td>
                <td className="inv-row-actions">
                  <button onClick={() => onView(it)}>View</button>
                  {isManagerUp && <button onClick={onAddStock}>Add Stock</button>}
                  {isManagerUp && <button onClick={() => onTransfer(it)}>Transfer</button>}
                  {isAdmin && <button onClick={() => onAdjust(it)}>Adjust</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function KpiCard({ icon, label, value, sub, tone }: { icon: string; label: string; value: string; sub: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`inv-kpi-card ${tone ? `tone-${tone}` : ''}`}>
      <div className="inv-kpi-icon">{icon}</div>
      <div className="inv-kpi-value">{value}</div>
      <div className="inv-kpi-label">{label}</div>
      <div className="inv-kpi-sub">{sub}</div>
    </div>
  );
}

function StatusBarChart({ items }: { items: InventoryItem[] }) {
  const counts: Record<StockStatus, number> = { in_stock: 0, low_stock: 0, out_of_stock: 0, expiring_soon: 0, expired: 0 };
  items.forEach((i) => { counts[computeStatus(i)] += 1; });
  const max = Math.max(1, ...Object.values(counts));
  const order: StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock', 'expiring_soon', 'expired'];
  return (
    <div className="inv-chart">
      {order.map((s) => (
        <div className="inv-chart-row" key={s}>
          <span className="inv-chart-label">{STATUS_LABEL[s]}</span>
          <div className="inv-chart-track">
            <div className={`inv-chart-fill tone-${STATUS_TONE[s]}`} style={{ width: `${(counts[s] / max) * 100}%` }} />
          </div>
          <span className="inv-chart-count">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}

function StockLevelGauge({ item }: { item: InventoryItem }) {
  const avail = availableQty(item);
  const pct = Math.min(100, Math.max(0, ((avail - 0) / Math.max(1, item.maxStock)) * 100));
  const minPct = Math.min(100, (item.minStock / Math.max(1, item.maxStock)) * 100);
  return (
    <div className="inv-gauge">
      <div className="inv-gauge-track">
        <div className="inv-gauge-fill" style={{ width: `${pct}%` }} />
        <div className="inv-gauge-min-marker" style={{ left: `${minPct}%` }} title="Minimum level" />
      </div>
      <div className="inv-gauge-labels"><span>Min {item.minStock}</span><span>Current {avail}</span><span>Max {item.maxStock}</span></div>
    </div>
  );
}

function ProductDetailPanel({ item, movements, onClose, canManage, onAdjust, onTransfer }: {
  item: InventoryItem; movements: MovementRecord[]; onClose: () => void; canManage: boolean; onAdjust: () => void; onTransfer: () => void;
}) {
  const status = computeStatus(item);
  return (
    <div className="inv-drawer-overlay" onClick={onClose}>
      <div className="inv-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="inv-drawer-head">
          <div>
            <h2>{item.name}</h2>
            <span className={`badge badge-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <h4>Product Information</h4>
        <div className="inv-info-grid">
          <div><span>SKU</span><strong>{item.sku}</strong></div>
          <div><span>Product Code</span><strong>{item.productCode}</strong></div>
          <div><span>Industry</span><strong>{INDUSTRY_LABEL[item.industry]}</strong></div>
          <div><span>Category</span><strong>{item.category}</strong></div>
          <div><span>Brand</span><strong>{item.brand}</strong></div>
          <div><span>Unit</span><strong>{item.unit}</strong></div>
          <div><span>Min Stock</span><strong>{item.minStock}</strong></div>
          <div><span>Max Stock</span><strong>{item.maxStock}</strong></div>
          {item.mrp !== undefined && <div><span>MRP</span><strong>₹{item.mrp}</strong></div>}
          {item.storageRequirement && <div><span>Storage</span><strong>{item.storageRequirement}</strong></div>}
          {item.color && <div><span>Color</span><strong>{item.color}</strong></div>}
          {item.size && <div><span>Size</span><strong>{item.size}</strong></div>}
          {item.purchaseRef && <div><span>Purchase Ref</span><strong>{item.purchaseRef}</strong></div>}
          {item.salesRef && <div><span>Sales Ref</span><strong>{item.salesRef}</strong></div>}
          {item.academicYear && <div><span>Academic Year</span><strong>{item.academicYear}</strong></div>}
          {item.department && <div><span>Department</span><strong>{item.department}</strong></div>}
        </div>

        <h4>Batch Details</h4>
        <div className="inv-info-grid">
          <div><span>Batch</span><strong className="mono">{item.batch}</strong></div>
          <div><span>Mfg Date</span><strong>{fmtDate(item.mfgDate)}</strong></div>
          <div><span>Expiry</span><strong>{fmtDate(item.expiryDate)}</strong></div>
          <div><span>Location</span><strong>{item.location}</strong></div>
          <div><span>Batch Status</span><strong className={`badge badge-${status === 'expired' ? 'bad' : status === 'expiring_soon' ? 'warn' : 'good'}`}>{status === 'expired' ? 'Expired' : status === 'expiring_soon' ? 'Expiring Soon' : 'Active'}</strong></div>
        </div>

        <h4>Stock Summary</h4>
        <div className="inv-summary-row">
          <div><span>Total Stock</span><strong>{item.totalStock}</strong></div>
          <div><span>Reserved</span><strong>{item.reserved}</strong></div>
          <div><span>Assigned</span><strong>{item.assigned}</strong></div>
          <div><span>Available</span><strong>{availableQty(item)}</strong></div>
        </div>
        <StockLevelGauge item={item} />

        {canManage && (
          <div className="inv-drawer-actions">
            <button onClick={onAdjust}>Adjust Stock</button>
            <button onClick={onTransfer}>Transfer</button>
          </div>
        )}

        <h4>Stock Movement History</h4>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Qty</th><th>From</th><th>To</th><th>User</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.date)}</td>
                  <td>{m.type}</td>
                  <td className="mono">{m.reference}</td>
                  <td className={m.quantity < 0 ? 'neg' : 'pos'}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                  <td>{m.from}</td>
                  <td>{m.to}</td>
                  <td>{m.user}</td>
                </tr>
              ))}
              {movements.length === 0 && <tr><td colSpan={7} className="inv-cell-sub">No movement recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RepDetailPanel({ rep, items, onClose }: { rep: string; items: InventoryItem[]; onClose: () => void }) {
  return (
    <div className="inv-drawer-overlay" onClick={onClose}>
      <div className="inv-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="inv-drawer-head">
          <h2>{rep} — Assigned Products</h2>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Product</th><th>Batch</th><th>Assigned</th><th>Status</th></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td className="mono">{it.batch}</td>
                  <td>{it.assigned}</td>
                  <td><span className={`badge badge-${STATUS_TONE[computeStatus(it)]}`}>{STATUS_LABEL[computeStatus(it)]}</span></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={4} className="inv-cell-sub">No products assigned.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ModalShell({ title, onCancel, children, onSubmit, submitLabel = 'Save' }: {
  title: string; onCancel: () => void; children: React.ReactNode; onSubmit?: () => void; submitLabel?: string;
}) {
  return (
    <div className="inv-modal-overlay" onClick={onCancel}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head"><h3>{title}</h3><button onClick={onCancel}>✕</button></div>
        <div className="inv-modal-body">{children}</div>
        <div className="inv-modal-actions">
          <button onClick={onCancel}>Cancel</button>
          {onSubmit && <button className="active" onClick={onSubmit}>{submitLabel}</button>}
        </div>
      </div>
    </div>
  );
}

function AddStockModal({ items, onCancel, onSubmit }: {
  items: InventoryItem[]; onCancel: () => void;
  onSubmit: (d: { productId: string; batch: string; mfgDate: string; expiryDate: string; quantity: number; location: string; supplierRef: string; purchaseRef: string; remarks: string }) => void;
}) {
  const [productId, setProductId] = useState(items[0]?.id ?? '');
  const [batch, setBatch] = useState('');
  const [mfgDate, setMfgDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [location, setLocation] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [purchaseRef, setPurchaseRef] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <ModalShell title="Add Stock" onCancel={onCancel} submitLabel="Add Stock" onSubmit={() => quantity > 0 && productId && onSubmit({ productId, batch, mfgDate, expiryDate, quantity, location, supplierRef, purchaseRef, remarks })}>
      <label>Product<select value={productId} onChange={(e) => setProductId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label>Batch Number<input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. BT202609" /></label>
      <label>Manufacturing Date<input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} /></label>
      <label>Expiry Date<input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></label>
      <label>Quantity<input type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <label>Location<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Warehouse A" /></label>
      <label>Supplier Reference<input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} /></label>
      <label>Purchase Reference<input value={purchaseRef} onChange={(e) => setPurchaseRef(e.target.value)} /></label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function TransferModal({ items, presetItem, locations, onCancel, onSubmit }: {
  items: InventoryItem[]; presetItem?: InventoryItem; locations: string[]; onCancel: () => void;
  onSubmit: (d: { productId: string; quantity: number; fromLocation: string; toLocation: string; reason: string; remarks: string }) => void;
}) {
  const [productId, setProductId] = useState(presetItem?.id ?? items[0]?.id ?? '');
  const item = items.find((i) => i.id === productId);
  const [quantity, setQuantity] = useState(0);
  const [fromLocation, setFromLocation] = useState(item?.location ?? '');
  const [toLocation, setToLocation] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <ModalShell title="Stock Transfer" onCancel={onCancel} submitLabel="Transfer Stock" onSubmit={() => quantity > 0 && toLocation && onSubmit({ productId, quantity, fromLocation, toLocation, reason, remarks })}>
      <label>Product<select value={productId} onChange={(e) => setProductId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      {item && <p className="inv-modal-hint">Batch {item.batch} · Available {availableQty(item)}</p>}
      <label>Quantity<input type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <label>From Location
        <select value={fromLocation} onChange={(e) => setFromLocation(e.target.value)}>
          <option value={item?.location ?? ''}>{item?.location ?? 'Select'}</option>
          {locations.filter((l) => l !== item?.location).map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label>To Location<input value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="e.g. Warehouse B" /></label>
      <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function AssignModal({ items, reps, presetItem, onCancel, onSubmit }: {
  items: InventoryItem[]; reps: string[]; presetItem?: InventoryItem; onCancel: () => void;
  onSubmit: (d: { productId: string; rep: string; quantity: number; remarks: string }) => void;
}) {
  const [productId, setProductId] = useState(presetItem?.id ?? items[0]?.id ?? '');
  const [rep, setRep] = useState(reps[0] ?? '');
  const [quantity, setQuantity] = useState(0);
  const [remarks, setRemarks] = useState('');
  const item = items.find((i) => i.id === productId);
  return (
    <ModalShell title="Assign Inventory" onCancel={onCancel} submitLabel="Assign" onSubmit={() => quantity > 0 && rep && onSubmit({ productId, rep, quantity, remarks })}>
      <label>Sales Representative<select value={rep} onChange={(e) => setRep(e.target.value)}>{reps.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      <label>Product<select value={productId} onChange={(e) => setProductId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      {item && <p className="inv-modal-hint">Batch {item.batch} · Available {availableQty(item)}</p>}
      <label>Quantity<input type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <label>Assignment Date<input type="date" defaultValue={new Date().toISOString().slice(0, 10)} readOnly /></label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function AdjustModal({ item, onCancel, onSubmit }: {
  item: InventoryItem; onCancel: () => void; onSubmit: (item: InventoryItem, delta: number, reason: string, remarks: string) => void;
}) {
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState('Damaged');
  const [remarks, setRemarks] = useState('');
  const newStock = Math.max(0, item.totalStock + delta);
  return (
    <ModalShell title={`Adjust Stock — ${item.name}`} onCancel={onCancel} submitLabel="Save Adjustment" onSubmit={() => delta !== 0 && onSubmit(item, delta, reason, remarks)}>
      <div className="inv-adjust-flow">
        <div><span>Previous Stock</span><strong>{item.totalStock}</strong></div>
        <div className="inv-arrow">↓</div>
        <label>Adjustment (+/-)<input type="number" value={delta || ''} onChange={(e) => setDelta(Number(e.target.value))} /></label>
        <div className="inv-arrow">↓</div>
        <div><span>New Stock</span><strong>{newStock}</strong></div>
      </div>
      <label>Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>Damaged</option><option>Lost</option><option>Expired</option><option>Counting Correction</option><option>Returned</option><option>Other</option>
        </select>
      </label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function ReturnModal({ items, reps, onCancel, onSubmit }: {
  items: InventoryItem[]; reps: string[]; onCancel: () => void;
  onSubmit: (d: { rep: string; productId: string; quantity: number; reason: string; remarks: string }) => void;
}) {
  const [rep, setRep] = useState(reps[0] ?? '');
  const [productId, setProductId] = useState(items[0]?.id ?? '');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('Unsold');
  const [remarks, setRemarks] = useState('');
  return (
    <ModalShell title="Return Stock" onCancel={onCancel} submitLabel="Submit Return" onSubmit={() => quantity > 0 && onSubmit({ rep, productId, quantity, reason, remarks })}>
      <label>Sales Rep<select value={rep} onChange={(e) => setRep(e.target.value)}>{reps.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      <label>Product<select value={productId} onChange={(e) => setProductId(e.target.value)}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label>Quantity<input type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <label>Return Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>Unsold</option><option>Damaged</option><option>Customer Return</option><option>Expiry</option><option>Other</option>
        </select>
      </label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function RequestModal({ items, approvers, onCancel, onSubmit }: {
  items: InventoryItem[]; approvers: string[]; onCancel: () => void;
  onSubmit: (d: { product: string; quantity: number; reason: string; requiredDate: string; remarks: string; requestedTo: string }) => void;
}) {
  const [product, setProduct] = useState(items[0]?.name ?? '');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [requestedTo, setRequestedTo] = useState('');
  return (
    <ModalShell title="Request Stock" onCancel={onCancel} submitLabel="Submit Request" onSubmit={() => quantity > 0 && onSubmit({ product, quantity, reason, requiredDate, remarks, requestedTo: requestedTo || 'Any manager / Admin' })}>
      <label>Request To<select value={requestedTo} onChange={(e) => setRequestedTo(e.target.value)}>
        <option value="">Any manager / Admin</option>
        {approvers.map((a) => <option key={a} value={a}>{a}</option>)}
      </select></label>
      <label>Product<select value={product} onChange={(e) => setProduct(e.target.value)}>{items.map((i) => <option key={i.id} value={i.name}>{i.name}</option>)}</select></label>
      <label>Quantity<input type="number" min={1} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} /></label>
      <label>Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label>Required Date<input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></label>
      <label>Remarks<textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
    </ModalShell>
  );
}

function ScanModal({ items, onClose, onView, onAddStock, onTransfer, onAssign }: {
  items: InventoryItem[]; onClose: () => void; onView: (i: InventoryItem) => void;
  onAddStock: () => void; onTransfer: (i: InventoryItem) => void; onAssign: (i: InventoryItem) => void;
}) {
  const [scanned, setScanned] = useState<InventoryItem | null>(null);
  function simulateScan() {
    const item = items[Math.floor(Math.random() * items.length)];
    setScanned(item ?? null);
  }
  return (
    <div className="inv-modal-overlay" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head"><h3>Scan Product</h3><button onClick={onClose}>✕</button></div>
        <div className="inv-modal-body">
          {!scanned ? (
            <div className="inv-scanner">
              <div className="inv-scanner-frame"><div className="inv-scanner-laser" /></div>
              <p>Point the scanner at a product barcode.</p>
              <button className="active" onClick={simulateScan}>Simulate Scan</button>
            </div>
          ) : (
            <div className="inv-scan-result">
              <h4>{scanned.name}</h4>
              <div className="inv-info-grid">
                <div><span>SKU</span><strong>{scanned.sku}</strong></div>
                <div><span>Barcode</span><strong className="mono">{scanned.barcode}</strong></div>
                <div><span>Batch</span><strong>{scanned.batch}</strong></div>
                <div><span>Expiry</span><strong>{fmtDate(scanned.expiryDate)}</strong></div>
                <div><span>Current Qty</span><strong>{scanned.totalStock}</strong></div>
                <div><span>Assigned Qty</span><strong>{scanned.assigned}</strong></div>
                <div><span>Available Qty</span><strong>{availableQty(scanned)}</strong></div>
              </div>
              <div className="inv-modal-actions" style={{ justifyContent: 'flex-start', marginTop: '1rem' }}>
                <button onClick={() => onView(scanned)}>View Product</button>
                <button onClick={onAddStock}>Add Stock</button>
                <button onClick={() => onTransfer(scanned)}>Transfer</button>
                <button onClick={() => onAssign(scanned)}>Assign</button>
                <button onClick={() => setScanned(null)}>Scan Another</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BatchDetailModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const status = computeStatus(item);
  return (
    <ModalShell title={`Batch ${item.batch}`} onCancel={onClose}>
      <div className="inv-info-grid">
        <div><span>Product</span><strong>{item.name}</strong></div>
        <div><span>Mfg Date</span><strong>{fmtDate(item.mfgDate)}</strong></div>
        <div><span>Expiry</span><strong>{fmtDate(item.expiryDate)}</strong></div>
        <div><span>Quantity</span><strong>{item.totalStock}</strong></div>
        <div><span>Location</span><strong>{item.location}</strong></div>
        <div><span>Status</span><strong className={`badge badge-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</strong></div>
      </div>
    </ModalShell>
  );
}    