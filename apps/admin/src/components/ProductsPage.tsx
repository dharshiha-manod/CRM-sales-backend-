import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useIndustry } from '../industry/IndustryContext';
import { loadNameList, brandListKey, categoryListKey, unitListKey } from './BrandsCategoriesPage';
import './MasterDataPages.css';

type Product = {
  id: string;
  product_code: string;
  product_name: string;
 category?: string | null;
  selling_price: number;
  cost_price?: number | null;
  stock_quantity?: number | null;
  status: 'active' | 'inactive';
  // Real, backend-persisted GST/tax rate for this product (products.tax_percent).
  tax_percent?: number | null;
  // Resolved server-side from the product_industry_types join table (see
  // products.repository.ts) — not a real column on the products row itself.
  industry_type_id?: string | null;
};
// FMCG-specific fields have no backend column yet — persisted client-side in
// localStorage, keyed by product id, until real columns exist.
const FMCG_META_PREFIX = 'fs-fmcg-product-meta:';
type FmcgMeta = {
  barcode: string;
  brand: string;
  subCategory: string;
  unit: string;
  packSize: string;
  mrp: string;
  discountPercent: string;
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  minStockLevel: string;
};

const blankFmcgMeta: FmcgMeta = {
  barcode: '',
  brand: '',
  subCategory: '',
  unit: 'pcs',
  packSize: '',
  mrp: '',
  discountPercent: '',
  batchNumber: '',
  mfgDate: '',
  expiryDate: '',
  minStockLevel: '',
};
function loadFmcgMeta(productId: string): FmcgMeta {
  try {
    const raw = window.localStorage.getItem(`${FMCG_META_PREFIX}${productId}`);
    return raw ? { ...blankFmcgMeta, ...JSON.parse(raw) } : blankFmcgMeta;
  } catch {
    return blankFmcgMeta;
  }
}

function saveFmcgMeta(productId: string, meta: FmcgMeta) {
  try {
    window.localStorage.setItem(`${FMCG_META_PREFIX}${productId}`, JSON.stringify(meta));
  } catch {
    // Best-effort — if storage is full/unavailable the product itself still saved via the API.
  }
}

function loadAllFmcgMeta(): Record<string, FmcgMeta> {
  const out: Record<string, FmcgMeta> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(FMCG_META_PREFIX)) {
        const productId = key.slice(FMCG_META_PREFIX.length);
        out[productId] = loadFmcgMeta(productId);
      }
    }
  } catch {
    // Best-effort.
  }
  return out;
}

function expiryStatus(expiryDate: string): { label: string; className: string } | null {
  if (!expiryDate) return null;
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'Expired', className: 'status-cancelled' };
  if (days <= 30) return { label: `Expiring in ${days}d`, className: 'status-quoted' };
  return { label: 'OK', className: 'status-completed' };
}

type StockState = 'in' | 'low' | 'out';
function stockStatus(stockQuantity: number | null | undefined, minStockLevel: string): StockState {
  if (stockQuantity == null) return 'in';
  if (stockQuantity <= 0) return 'out';
  if (minStockLevel !== '' && stockQuantity <= Number(minStockLevel)) return 'low';
  return 'in';
}

const formatMoney = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateShort = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(value));

// Selling price is derived from MRP and Discount% so the person filling the
// form doesn't have to do the subtraction themselves. Returns '' when MRP
// isn't a usable number yet, so we never clobber whatever they typed.
function computeSellingPrice(mrp: string, discountPercent: string): string {
  const mrpNum = Number(mrp);
  if (!mrp || Number.isNaN(mrpNum) || mrpNum <= 0) return '';
  const discountNum = Number(discountPercent);
  const discount = Number.isNaN(discountNum) ? 0 : discountNum;
  return (mrpNum - (mrpNum * discount) / 100).toFixed(2);
}

// Turns Category + Product name into a short suggested SKU, e.g.
// "GEN-RICEB-482", so the person doesn't have to invent a code by hand.
// It's only a starting suggestion — the box stays editable, and this never
// overwrites a code that already exists (new products only, box must be empty).
function slugPart(text: string, length: number): string {
  const cleaned = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, length) || 'GEN';
}
function generateProductCode(category: string, productName: string): string {
  const catPart = slugPart(category, 3);
  const namePart = slugPart(productName, 4);
  const suffix = Math.floor(100 + Math.random() * 900); // random 3-digit number lowers collision risk
  return `${catPart}-${namePart}-${suffix}`;
}

type ProductForm = { 
  productCode: string;
  productName: string;
 category: string;
  sellingPrice: string;
  costPrice: string;
  stockQuantity: string;  
  status: 'active' | 'inactive';
  industryTypeId: string;
  // Real, backend-persisted field (products.tax_percent) — not part of
  // FmcgMeta/localStorage.
  taxPercent: string;
} & FmcgMeta;

const blankForm: ProductForm = {
  productCode: '',
  productName: '',
 category: '',
  sellingPrice: '',
  costPrice: '',
  stockQuantity: '',
  status: 'active',
  industryTypeId: '',
  taxPercent: '',
  ...blankFmcgMeta,
};

// Related-orders lookup: match by product_code against sale_order_items, the
// same shape OrdersPage already uses — no new endpoint, no id join required.
type RelatedOrderLine = { products?: { product_code?: string } | null };
type RelatedOrder = { id: string; order_number: string; status: string; total_amount: number; created_at: string; sale_order_items?: RelatedOrderLine[] };

export function ProductsPage() {
  const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const { activeIndustry } = useIndustry();
  const [items, setItems] = useState<Product[]>([]);
  const [industryTypes, setIndustryTypes] = useState<{ id: string; name: string }[]>([]);
  const [allOrders, setAllOrders] = useState<RelatedOrder[]>([]);
  const [form, setForm] = useState<ProductForm>(blankForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | Product['status']>('all');
  const [filterStock, setFilterStock] = useState<'all' | StockState>('all');
  const [filterExpiry, setFilterExpiry] = useState<'all' | 'expiring' | 'expired' | 'none'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fmcgMetaMap, setFmcgMetaMap] = useState<Record<string, FmcgMeta>>({});
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [savedBrands, setSavedBrands] = useState<string[]>(() => loadNameList(brandListKey(activeIndustry)));
  const [savedCategories, setSavedCategories] = useState<string[]>(() => loadNameList(categoryListKey(activeIndustry)));
  const [savedUnits, setSavedUnits] = useState<string[]>(() => loadNameList(unitListKey(activeIndustry)));

  // Re-read the saved Brand/Category/Unit master lists whenever the active
  // Industry Type changes — otherwise this page keeps showing whichever
  // industry's list happened to be loaded first, even after switching.
  useEffect(() => {
    setSavedBrands(loadNameList(brandListKey(activeIndustry)));
    setSavedCategories(loadNameList(categoryListKey(activeIndustry)));
    setSavedUnits(loadNameList(unitListKey(activeIndustry)));
  }, [activeIndustry]);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      setItems((await api<{ data: Product[] }>('/products')).data ?? []);
      setFmcgMetaMap(loadAllFmcgMeta());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders() {
    try {
      setAllOrders((await api<{ data: RelatedOrder[] }>('/orders')).data ?? []);
    } catch {
      // non-fatal — the "Related orders" panel simply shows empty
    }
  }

  useEffect(() => { void load(); void loadOrders(); }, []);
  useEffect(() => {
    api<{ data: { id: string; name: string }[] }>('/industry-types?status=active')
      .then((res) => setIndustryTypes(res.data ?? []))
      .catch(() => { /* non-fatal: the industry picker just won't populate */ });
  }, []);

  // Everything below is scoped to the active industry first (reusing the
  // shared useIndustryScope hook — no separate industry state here), then
  // narrowed further by the toolbar filters.
  const industryItems = useMemo(
    () => items.filter((item) => matchesActiveIndustry(item.industry_type_id)),
    [items, activeIndustryTypeId],
  );

   const categories = useMemo(
    () => [...new Set([
      ...industryItems.map((item) => item.category?.trim()).filter((item): item is string => Boolean(item)),
      ...savedCategories,
    ])].sort(),
    [industryItems, savedCategories],
  );
   const categoryOptions = categories.length > 0 ? categories : ['General'];
  const brands = useMemo(
    () => [...new Set([
      ...industryItems.map((item) => (fmcgMetaMap[item.id]?.brand ?? '').trim()).filter(Boolean),
      ...savedBrands,
    ])].sort(),
    [industryItems, fmcgMetaMap, savedBrands],
  );
  const subCategories = useMemo(
    () => [...new Set(industryItems.map((item) => (fmcgMetaMap[item.id]?.subCategory ?? '').trim()).filter(Boolean))].sort(),
    [industryItems, fmcgMetaMap],
  );
  const filteredItems = useMemo(() => industryItems.filter((item) => {
    const meta = fmcgMetaMap[item.id] ?? blankFmcgMeta;
    const term = search.trim().toLowerCase();
    const searchMatches = !term
      || item.product_name.toLowerCase().includes(term)
      || item.product_code.toLowerCase().includes(term)
      || meta.barcode.toLowerCase().includes(term);
    const brandMatches = !filterBrand || meta.brand === filterBrand;
    const categoryMatches = !filterCategory || item.category === filterCategory;
    const statusMatches = filterStatus === 'all' || item.status === filterStatus;
    const stockMatches = filterStock === 'all' || stockStatus(item.stock_quantity, meta.minStockLevel) === filterStock;
    const expiry = expiryStatus(meta.expiryDate);
    const expiryMatches = filterExpiry === 'all'
      || (filterExpiry === 'expiring' && !!expiry && expiry.label.startsWith('Expiring'))
      || (filterExpiry === 'expired' && expiry?.label === 'Expired')
      || (filterExpiry === 'none' && !meta.expiryDate);
    return searchMatches && brandMatches && categoryMatches && statusMatches && stockMatches && expiryMatches;
  }), [industryItems, fmcgMetaMap, search, filterBrand, filterCategory, filterStatus, filterStock, filterExpiry]);

  const kpis = useMemo(() => {
    let active = 0, lowStock = 0, outOfStock = 0, expiringSoon = 0, totalStock = 0;
    industryItems.forEach((item) => {
      if (item.status === 'active') active += 1;
      const meta = fmcgMetaMap[item.id] ?? blankFmcgMeta;
      const state = stockStatus(item.stock_quantity, meta.minStockLevel);
      if (state === 'low') lowStock += 1;
      if (state === 'out') outOfStock += 1;
      const expiry = expiryStatus(meta.expiryDate);
      if (expiry?.label.startsWith('Expiring')) expiringSoon += 1;
      totalStock += item.stock_quantity ?? 0;
    });
    return { total: industryItems.length, active, lowStock, outOfStock, expiringSoon, totalStock };
  }, [industryItems, fmcgMetaMap]);
  function openCreate() {
    setEditing(null);
    setSavedBrands(loadNameList(brandListKey(activeIndustry)));
    setSavedCategories(loadNameList(categoryListKey(activeIndustry)));
    setSavedUnits(loadNameList(unitListKey(activeIndustry)));
    // Automation: default to whichever Industry Type tab is already open —
    // that's the overwhelmingly common case, and it's still editable below
    // for the rare product that belongs to a different industry.
    setForm({ ...blankForm, category: categoryOptions[0] ?? '', industryTypeId: activeIndustryTypeId ?? '' });
    setMessage('');
    setModalOpen(true);
  }
  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      productCode: product.product_code,
      productName: product.product_name,
      category: product.category ?? categoryOptions[0] ?? '',
     sellingPrice: String(product.selling_price),
      costPrice: product.cost_price == null ? '' : String(product.cost_price),
      stockQuantity: product.stock_quantity == null ? '' : String(product.stock_quantity),
         status: product.status,
      industryTypeId: product.industry_type_id ?? activeIndustryTypeId ?? '',
      ...loadFmcgMeta(product.id),
      unit: product.unit ?? 'pcs',
      taxPercent: product.tax_percent == null ? '' : String(product.tax_percent),
    });
    setMessage('');
    setModalOpen(true);
  }

  function closeModal(force = false) {
    if (saving && !force) return;
    setModalOpen(false);
    setEditing(null);
    setForm(blankForm);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
       // Industry Type is set globally via the sidebar picker, not per-product.
    setSaving(true);
    setMessage('');
     const fmcgMeta: FmcgMeta = {
      barcode: form.barcode,
      brand: form.brand,
      subCategory: form.subCategory,
      unit: form.unit,
      packSize: form.packSize,
      mrp: form.mrp,
      discountPercent: form.discountPercent,
      batchNumber: form.batchNumber,
      mfgDate: form.mfgDate,
      expiryDate: form.expiryDate,
      minStockLevel: form.minStockLevel,
    };
    const body = {
      productCode: form.productCode,
      productName: form.productName,
      category: form.category || null,
         sellingPrice: Number(form.sellingPrice),
      costPrice: form.costPrice === '' ? null : Number(form.costPrice),
      stockQuantity: form.stockQuantity === '' ? null : Number(form.stockQuantity),
      status: form.status,
      unit: form.unit || null,
      taxPercent: form.taxPercent === '' ? null : Number(form.taxPercent),
      industryTypeIds: [form.industryTypeId || activeIndustryTypeId || ''].filter(Boolean),
    };
    try {
      const response = await api<{ data: Product }>(editing ? `/products/${editing.id}` : '/products', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      const productId = editing ? editing.id : response.data.id;
      saveFmcgMeta(productId, fmcgMeta);
      setMessage(editing ? 'Product updated successfully.' : 'Product added successfully.');
      closeModal(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  }

  // Toggles the existing `status` field both ways — the same PATCH the
  // original "Deactivate" action used, just also offered as "Activate" since
  // the API already accepts either value (no new backend capability).
  async function deleteProduct(product: Product) {
    if (!window.confirm(`Permanently delete ${product.product_name}? This cannot be undone.`)) return;
    setSaving(true);
    setMessage('');
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      setMessage('Product deleted successfully.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete product.');
    } finally {
      setSaving(false);
    }
  }
  async function toggleStatus(product: Product) {
    const next: Product['status'] = product.status === 'active' ? 'inactive' : 'active';
    const verb = next === 'inactive' ? 'Deactivate' : 'Activate';
    if (!window.confirm(`${verb} ${product.product_name}?`)) return;
    setSaving(true);
    setMessage('');
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      setMessage(`Product ${next === 'inactive' ? 'deactivated' : 'activated'} successfully.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update product status.');
    } finally {
      setSaving(false);
    }
  }
  function clearFilters() {
    setSearch('');
    setFilterBrand('');
    setFilterCategory('');
    setFilterStatus('all');
    setFilterStock('all');
    setFilterExpiry('all');
  }

  function toggleMenu(event: React.MouseEvent<HTMLButtonElement>, productId: string) {
    if (menuFor?.id === productId) { setMenuFor(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFor({ id: productId, top: rect.bottom + 4, left: Math.max(8, rect.right - 170) });
  }

  const activeFilterCount = Number(Boolean(search)) + Number(Boolean(filterBrand)) + Number(Boolean(filterCategory))
    + Number(filterStatus !== 'all') + Number(filterStock !== 'all') + Number(filterExpiry !== 'all');

  const relatedOrders = useMemo(() => {
    if (!viewing) return [];
    return allOrders.filter((order) => order.sale_order_items?.some((line) => line.products?.product_code === viewing.product_code));
  }, [allOrders, viewing]);

  return (
    <section className="page-panel master-page products-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">PRODUCT CATALOG</p>
          <h2>Products</h2>
          <p>Manage products, pricing, inventory and batch information.</p>
        </div>
        <button type="button" className="primary-action" onClick={openCreate}>+ Add Product</button>
      </div>
      <div className="kpi-grid product-kpi-grid">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">▣</div><div><span>Total Products</span><strong>{kpis.total}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon kpi-icon-green">✓</div><div><span>Active Products</span><strong>{kpis.active}</strong></div></div>
        <div className="kpi-card" data-tone="amber"><div className="kpi-icon kpi-icon-amber">⚠</div><div><span>Low Stock</span><strong>{kpis.lowStock}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon kpi-icon-red">⬤</div><div><span>Out of Stock</span><strong>{kpis.outOfStock}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon kpi-icon-blue">◷</div><div><span>Expiring Soon</span><strong>{kpis.expiringSoon}</strong></div></div>
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon kpi-icon-ink">▤</div><div><span>Total Stock</span><strong>{kpis.totalStock.toLocaleString('en-IN')}</strong></div></div>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input type="search" value={search} placeholder="Search product, SKU or barcode" onChange={(event) => setSearch(event.target.value)} />
          <select value={filterBrand} onChange={(event) => setFilterBrand(event.target.value)}>
            <option value="">All brands</option>
            {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as typeof filterStatus)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={filterStock} onChange={(event) => setFilterStock(event.target.value as typeof filterStock)}>
            <option value="all">All stock levels</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
          <select value={filterExpiry} onChange={(event) => setFilterExpiry(event.target.value as typeof filterExpiry)}>
            <option value="all">All batches</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            <option value="none">No batch/expiry set</option>
          </select>
          <button type="button" className="link-button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</button>
        </div>
      </div>

      {message && <p role="status" className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}
      {loading ? <p>Loading products…</p> : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr><th>Product</th><th>SKU / Barcode</th><th>Brand</th><th>Category</th><th>Selling Price</th><th>Stock</th><th>Batch / Expiry</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const meta = fmcgMetaMap[item.id] ?? blankFmcgMeta;
                const expiry = expiryStatus(meta.expiryDate);
                const stockState = stockStatus(item.stock_quantity, meta.minStockLevel);
                return (
                  <tr key={item.id}>
                    <td><strong>{item.product_name}</strong></td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{item.product_code}</span>
                      <br /><small className="text-faint-inline">{meta.barcode || 'No barcode'}</small>
                    </td>
                    <td>{meta.brand || '—'}</td>
                    <td>{item.category ?? '—'}{meta.subCategory ? ` / ${meta.subCategory}` : ''}</td>
                                        <td>
                      {formatMoney(Number(item.selling_price) + (Number(item.selling_price) * Number(item.tax_percent || 0)) / 100)}
                      <br /><small className="text-faint-inline">Before tax {formatMoney(Number(item.selling_price))}</small>
                    </td>
                    <td>
                      {item.stock_quantity ?? '—'}
                      {stockState === 'low' && <><br /><span className="status-badge status-quoted">Low stock</span></>}
                      {stockState === 'out' && <><br /><span className="status-badge status-cancelled">Out of stock</span></>}
                    </td>
                    <td>
                      {meta.batchNumber || '—'}
                      {expiry && <><br /><span className={`status-badge ${expiry.className}`}>{expiry.label}</span></>}
                    </td>
                    <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                    <td className="master-actions">
                      <button type="button" className="icon-action row-menu-trigger" title="More actions" aria-label={`Actions for ${item.product_name}`} onClick={(event) => toggleMenu(event, item.id)}>⋯</button>
                    </td>
                  </tr>
                );
              })}
              {industryItems.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state empty-state-lg">
                      <div className="empty-state-icon">▣</div>
                      <p><strong>No products yet</strong><br />Add your first product to start managing your product catalog.</p>
                      <button type="button" className="primary-action" onClick={openCreate}>+ Add Product</button>
                    </div>
                  </td>
                </tr>
              )}
              {industryItems.length > 0 && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-state-icon">⌕</div>
                      <p><strong>No products match your filters</strong><br />Try adjusting or clearing the filters above.</p>
                      <button type="button" className="quiet-button" onClick={clearFilters}>Clear filters</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {menuFor && (
        <>
          <div className="row-menu-backdrop" onMouseDown={() => setMenuFor(null)} />
          <div className="row-menu" style={{ top: menuFor.top, left: menuFor.left }}>
            {(() => {
              const item = filteredItems.find((product) => product.id === menuFor.id);
              if (!item) return null;
              return (
                <>
                  <button type="button" onClick={() => { setMenuFor(null); setViewing(item); }}>View</button>
                  <button type="button" onClick={() => { setMenuFor(null); openEdit(item); }} disabled={saving}>Edit</button>
                  <button type="button" onClick={() => { setMenuFor(null); void toggleStatus(item); }} disabled={saving}>{item.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                  <button type="button" onClick={() => { setMenuFor(null); void deleteProduct(item); }} disabled={saving}>Delete</button>
                </>
              );
            })()}
          </div>
        </>
      )}

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => closeModal()}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">PRODUCT CATALOG</p><h3 id="product-modal-title">{editing ? 'Edit product' : 'Add product'}</h3></div>
              <button type="button" className="icon-action" aria-label="Close product form" title="Close" onClick={() => closeModal()}>×</button>
            </div>
            <form className="master-modal-form" onSubmit={submit}>
              <div className="field-grid">
                                           <label>SKU / product code (auto-suggested)<input required readOnly={!editing} placeholder="Auto-generated" value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} /></label>
                <label>Product name<input required value={form.productName} onChange={(event) => { const productName = event.target.value; setForm((current) => ({ ...current, productName, productCode: !editing ? generateProductCode(current.category, productName) : current.productCode })); }} /></label>
                <label>
                             {/* Industry Type field removed — it's set globally via the
                      sidebar Industry Type picker, so every product created
                      or edited here is automatically scoped to that. */}   
                </label>
                <label>Barcode<input value={form.barcode} placeholder="Scan or type" onChange={(event) => setForm({ ...form, barcode: event.target.value })} /></label>
                              <label>
                  Brand
                  <select value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })}>
                    <option value="">Select a brand</option>
                    {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                  </select>
                </label>
                <label>
                  Category
                  <select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                    {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
                <label>
                  Sub-category
                  <input list="subcategory-options" value={form.subCategory} onChange={(event) => setForm({ ...form, subCategory: event.target.value })} />
                  <datalist id="subcategory-options">{subCategories.map((subCategory) => <option key={subCategory} value={subCategory} />)}</datalist>
                </label>  
                              <label>
                  Unit
                                 <select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}>
                    <option value="pcs">Pieces</option>
                    <option value="carton">Carton</option>
                    <option value="box">Box</option>
                    <option value="kg">Kg</option>
                    <option value="litre">Litre</option>
                    {savedUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>  
                <label>Pack size<input placeholder="e.g. 12x200ml" value={form.packSize} onChange={(event) => setForm({ ...form, packSize: event.target.value })} /></label>
<label>MRP (₹)<input min="0" type="number" step="0.01" value={form.mrp} onChange={(event) => { const mrp = event.target.value; setForm((current) => ({ ...current, mrp, sellingPrice: computeSellingPrice(mrp, current.discountPercent) || current.sellingPrice })); }} /></label>
<label>Discount (%)<input min="0" max="100" type="number" step="0.01" value={form.discountPercent} onChange={(event) => { const discountPercent = event.target.value; setForm((current) => ({ ...current, discountPercent, sellingPrice: computeSellingPrice(current.mrp, discountPercent) || current.sellingPrice })); }} /></label>
<label>Selling price (₹) — auto from MRP &amp; Discount<input required min="0" type="number" step="0.01" value={form.sellingPrice} readOnly disabled={Boolean(form.mrp)} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} /></label>
                 <label>Purchase price (₹)<input min="0" type="number" step="0.01" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} /></label>
                <label>Tax / GST (%)<input min="0" max="100" type="number" step="0.01" value={form.taxPercent} onChange={(event) => setForm({ ...form, taxPercent: event.target.value })} /></label>
                <label>Final price incl. GST (₹)<input readOnly disabled value={form.sellingPrice && form.taxPercent ? (Number(form.sellingPrice) + (Number(form.sellingPrice) * Number(form.taxPercent)) / 100).toFixed(2) : form.sellingPrice} /></label>
                <label>Opening stock<input min="0" type="number" step="1" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} /></label>
                <label>Minimum stock level<input min="0" type="number" step="1" value={form.minStockLevel} onChange={(event) => setForm({ ...form, minStockLevel: event.target.value })} /></label>
                <label>Batch number<input value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} /></label>
                <label>Manufacturing date<input type="date" value={form.mfgDate} onChange={(event) => setForm({ ...form, mfgDate: event.target.value })} /></label>
                <label>Expiry date<input type="date" value={form.expiryDate} onChange={(event) => setForm({ ...form, expiryDate: event.target.value })} /></label>
                <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              </div>
              <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => closeModal()} disabled={saving}>Cancel</button><button type="submit" className="primary-action" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button></div>
            </form>
          </div>
        </div>
      )}

      {viewing && (() => {
        const meta = fmcgMetaMap[viewing.id] ?? blankFmcgMeta;
        const expiry = expiryStatus(meta.expiryDate);
        const stockState = stockStatus(viewing.stock_quantity, meta.minStockLevel);
        return (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setViewing(null)}>
            <div className="master-modal detail-panel" role="dialog" aria-modal="true" aria-labelledby="product-view-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-heading">
                <div><p className="eyebrow">PRODUCT DETAILS</p><h3 id="product-view-title">{viewing.product_name}</h3></div>
                <button type="button" className="icon-action" aria-label="Close product details" title="Close" onClick={() => setViewing(null)}>×</button>
              </div>
              <dl className="detail-dl">
                <dt>SKU</dt><dd>{viewing.product_code}</dd>
                <dt>Barcode</dt><dd>{meta.barcode || 'Not recorded'}</dd>
                <dt>Brand</dt><dd>{meta.brand || 'Not recorded'}</dd>
                <dt>Category</dt><dd>{viewing.category ?? '—'}{meta.subCategory ? ` / ${meta.subCategory}` : ''}</dd>
                <dt>Unit / Pack size</dt><dd>{meta.unit}{meta.packSize ? ` · ${meta.packSize}` : ''}</dd>
             <dt>Selling price</dt><dd>{formatMoney(Number(viewing.selling_price))}</dd>
                <dt>Purchase price</dt><dd>{viewing.cost_price == null ? 'Not recorded' : formatMoney(Number(viewing.cost_price))}</dd>
                <dt>MRP</dt><dd>{meta.mrp ? formatMoney(Number(meta.mrp)) : 'Not recorded'}</dd>
                         <dt>Discount / Tax</dt><dd>{meta.discountPercent || 0}% / {viewing.tax_percent || 0}%</dd>
                <dt>Price incl. GST</dt><dd>{formatMoney(Number(viewing.selling_price) + (Number(viewing.selling_price) * Number(viewing.tax_percent || 0)) / 100)}</dd>
                <dt>Current stock</dt>
                <dd>
                  {viewing.stock_quantity ?? '—'}{meta.minStockLevel ? ` (min ${meta.minStockLevel})` : ''}
                  {stockState === 'low' && <span className="status-badge status-quoted" style={{ marginLeft: '.5rem' }}>Low stock</span>}
                  {stockState === 'out' && <span className="status-badge status-cancelled" style={{ marginLeft: '.5rem' }}>Out of stock</span>}
                </dd>
                <dt>Batch number</dt><dd>{meta.batchNumber || 'Not recorded'}</dd>
                <dt>Manufacturing date</dt><dd>{meta.mfgDate || 'Not recorded'}</dd>
                <dt>Expiry date</dt><dd>{meta.expiryDate || 'Not recorded'}{expiry && <span className={`status-badge ${expiry.className}`} style={{ marginLeft: '.5rem' }}>{expiry.label}</span>}</dd>
                <dt>Status</dt><dd><span className={`status-badge ${viewing.status}`}>{viewing.status}</span></dd>
              </dl>
              <div style={{ padding: '0 1.6rem 1.6rem' }}>
                <p className="ledger-heading">Related orders</p>
                <div className="data-table-wrap">
                  <table>
                    <thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
                    <tbody>
                      {relatedOrders.map((order) => (
                        <tr key={order.id}>
                          <td>{order.order_number}</td>
                          <td>{dateShort(order.created_at)}</td>
                          <td><span className={`status-badge status-${order.status}`}>{order.status}</span></td>
                          <td>{formatMoney(Number(order.total_amount))}</td>
                        </tr>
                      ))}
                      {relatedOrders.length === 0 && <tr><td colSpan={4} className="empty-row">No orders reference this product yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}