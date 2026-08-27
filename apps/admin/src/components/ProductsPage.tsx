import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import './ProductsPage.css';

type Product = {
  id: string;
  product_code: string;
  product_name: string;
  category?: string | null;
  selling_price: number;
  stock_quantity?: number | null;
  status: 'active' | 'inactive';
};

type ProductForm = {
  productCode: string;
  productName: string;
  category: string;
  sellingPrice: string;
  stockQuantity: string;
  status: 'active' | 'inactive';
};

const blankForm: ProductForm = {
  productCode: '',
  productName: '',
  category: '',
  sellingPrice: '',
  stockQuantity: '',
  status: 'active',
};

export function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(blankForm);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | Product['status']>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const query = new URLSearchParams(search.trim() ? { search: search.trim() } : {});
      setItems((await api<{ data: Product[] }>(`/products?${query}`)).data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category?.trim()).filter((item): item is string => Boolean(item)))].sort(),
    [items],
  );
  const categoryOptions = categories.length > 0 ? categories : ['General'];
  const filteredItems = items.filter((item) => {
    const categoryMatches = !filterCategory || item.category === filterCategory;
    const statusMatches = filterStatus === 'all' || item.status === filterStatus;
    return categoryMatches && statusMatches;
  });

  function openCreate() {
    setEditing(null);
    setForm({ ...blankForm, category: categoryOptions[0] ?? '' });
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
      stockQuantity: product.stock_quantity == null ? '' : String(product.stock_quantity),
      status: product.status,
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
    setSaving(true);
    setMessage('');
    const body = {
      ...form,
      category: form.category || null,
      sellingPrice: Number(form.sellingPrice),
      stockQuantity: form.stockQuantity === '' ? null : Number(form.stockQuantity),
    };
    try {
      await api(editing ? `/products/${editing.id}` : '/products', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setMessage(editing ? 'Product updated successfully.' : 'Product added successfully.');
      closeModal(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(product: Product) {
    if (!window.confirm(`Deactivate ${product.product_name}? It will no longer be available for new field orders.`)) return;
    setSaving(true);
    setMessage('');
    try {
      await api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) });
      setMessage('Product deactivated successfully.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to deactivate product.');
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setFilterCategory('');
    setFilterStatus('all');
  }

  const activeFilterCount = Number(Boolean(filterCategory)) + Number(filterStatus !== 'all');

  return (
    <section className="page-panel products-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">PRODUCT CATALOG</p>
          <h2>Products</h2>
          <p>Maintain the active catalog used by representatives during field visits.</p>
        </div>
      </div>

      <div className="products-toolbar">
        <div className="products-toolbar-search">
          <input
            value={search}
            placeholder="Search product name or SKU"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void load(); }}
          />
          <button type="button" className="quiet-button" onClick={() => void load()} disabled={loading}>Search</button>
          <button type="button" className="quiet-button" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
        <button type="button" className="primary-action" onClick={openCreate}>+ Add product</button>
      </div>

      {filtersOpen && (
        <div className="products-filter-bar" aria-label="Product filters">
          <label>
            Category
            <select value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)}>
              <option value="">All categories</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as typeof filterStatus)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <button type="button" className="link-button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</button>
        </div>
      )}

      {message && <p role="status" className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}

      {loading ? <p>Loading products…</p> : (
        <div className="data-table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Selling price</th><th>Current stock</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.product_code}</td>
                  <td><strong>{item.product_name}</strong></td>
                  <td>{item.category ?? '—'}</td>
                  <td>₹{Number(item.selling_price).toFixed(2)}</td>
                  <td>{item.stock_quantity ?? '—'}</td>
                  <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                  <td className="product-actions">
                    <button type="button" className="icon-action" title="View product" aria-label={`View ${item.product_name}`} onClick={() => setViewing(item)}>◉</button>
                    <button type="button" className="icon-action" title="Edit product" aria-label={`Edit ${item.product_name}`} onClick={() => openEdit(item)} disabled={saving}>✎</button>
                    {item.status === 'active' && <button type="button" className="icon-action" title="Deactivate product" aria-label={`Deactivate ${item.product_name}`} onClick={() => void deactivate(item)} disabled={saving}>⊘</button>}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && <tr><td colSpan={7} className="empty-row">No products found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <div className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><p className="eyebrow">PRODUCT CATALOG</p><h3 id="product-modal-title">{editing ? 'Edit product' : 'Add product'}</h3></div>
              <button type="button" className="icon-action" aria-label="Close product form" title="Close" onClick={closeModal}>×</button>
            </div>
            <form className="product-modal-form" onSubmit={submit}>
              <label>SKU / product code<input required value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} /></label>
              <label>Product name<input required value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} /></label>
              <label>Category<select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
              <label>Selling price<input required min="0" type="number" step="0.01" value={form.sellingPrice} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} /></label>
              <label>Opening stock<input min="0" type="number" step="1" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} /></label>
              <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <div className="modal-actions"><button type="button" className="quiet-button" onClick={closeModal} disabled={saving}>Cancel</button><button type="submit" className="primary-action" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button></div>
            </form>
          </div>
        </div>
      )}

      {viewing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setViewing(null)}>
          <div className="product-modal product-view-modal" role="dialog" aria-modal="true" aria-labelledby="product-view-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading"><div><p className="eyebrow">PRODUCT DETAILS</p><h3 id="product-view-title">{viewing.product_name}</h3></div><button type="button" className="icon-action" aria-label="Close product details" title="Close" onClick={() => setViewing(null)}>×</button></div>
            <dl><dt>SKU</dt><dd>{viewing.product_code}</dd><dt>Category</dt><dd>{viewing.category ?? '—'}</dd><dt>Selling price</dt><dd>₹{Number(viewing.selling_price).toFixed(2)}</dd><dt>Current stock</dt><dd>{viewing.stock_quantity ?? '—'}</dd><dt>Status</dt><dd><span className={`status-badge ${viewing.status}`}>{viewing.status}</span></dd></dl>
          </div>
        </div>
      )}
    </section>
  );
}
