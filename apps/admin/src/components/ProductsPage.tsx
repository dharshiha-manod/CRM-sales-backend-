import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { useIndustry } from '../industry/IndustryContext';
import { kpiClick } from '../lib/kpiClick';
import { addDaysIso, lockedUnitsByProduct, previewBatchNo } from '../lib/batchExpiry';
import { useOrgSettings } from '../settings/useOrgSettings';
import { loadNameList, brandListKey, categoryListKey, unitListKey } from './BrandsCategoriesPage';
import './MasterDataPages.css';

// Pack size hint shown in the product form, per Industry Type.
const PACK_SIZE_PLACEHOLDERS: Record<string, string> = {
  fmcg: 'e.g. 12x200ml',
  trading: 'e.g. 6 m length, 10 pcs per bundle',
  pharma: 'e.g. 10 tablets x 10 strips',
  textile: 'e.g. 30 m roll',
  school: 'e.g. Set of 5 books',
  vehicle: 'e.g. Set of 4',
};

type Product = {
  id: string;
  product_code: string;
  product_name: string;
 category?: string | null;
  selling_price: number;
  cost_price?: number | null;
  shelf_life_days?: number | null;
  unit?: string | null;
  stock_quantity?: number | null;
  status: 'active' | 'inactive';
  // Real, backend-persisted GST/tax rate for this product (products.tax_percent).
  tax_percent?: number | null;
  hsn_code?: string | null;
  specification?: string | null;
  origin_country?: string | null;
  supplier_name?: string | null;
  currency?: string | null;
  // Saved in the database so every device sees the same MRP / discount.
  mrp?: number | null;
  discount_percent?: number | null;
  // Resolved server-side from the product_industry_types join table (see
  // products.repository.ts) — not a real column on the products row itself.
  industry_type_id?: string | null;
  // Textile only — saved in the database (products.textile_details, JSON).
  textile_details?: StoredTextileDetails | null;
  // Pharma only — saved in the database (products.pharma_details, JSON).
  pharma_details?: StoredPharmaDetails | null;
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
  trackBatch: boolean;
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
  trackBatch: false,
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

// Batch/expiry tracking is decided per product. Older saved products that
// already have batch or date values count as tracked, so nothing is lost.
const BATCH_DEFAULT_INDUSTRIES = ['fmcg', 'pharma'];
function tracksBatch(meta: FmcgMeta): boolean {
  return Boolean(meta.trackBatch || meta.batchNumber || meta.mfgDate || meta.expiryDate);
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
function newCodeSuffix(): number {
  return Math.floor(100 + Math.random() * 900); // random 3-digit number lowers collision risk
}
// The suffix is passed in (and kept for the whole form session) so the code
// does not change its number on every keystroke, only when Category/Name change.
function generateProductCode(category: string, productName: string, suffix: number): string {
  const catPart = slugPart(category, 3);
  const namePart = slugPart(productName, 4);
  return `${catPart}-${namePart}-${suffix}`;
}

// ---------- Pharma (medicine) product details — used only when the active industry is pharma ----------
type StoredPharmaDetails = {
  genericName?: string | null; composition?: string | null; strength?: string | null; dosageForm?: string | null; manufacturer?: string | null;
  drugCategory?: 'OTC' | 'Prescription' | 'Narcotic / Psychotropic' | null; drugSchedule?: string | null; storageCondition?: string | null; coldChain?: boolean | null;
};
type PharmaDetails = {
  genericName: string; composition: string; strength: string; dosageForm: string; manufacturer: string;
  drugCategory: '' | 'OTC' | 'Prescription' | 'Narcotic / Psychotropic'; drugSchedule: string; storageCondition: string; coldChain: boolean;
};
const blankPharma: PharmaDetails = { genericName: '', composition: '', strength: '', dosageForm: '', manufacturer: '', drugCategory: '', drugSchedule: '', storageCondition: '', coldChain: false };
const DRUG_SCHEDULES = ['None (non-scheduled)', 'Schedule G', 'Schedule H', 'Schedule H1', 'Schedule X', 'Schedule C / C1'];
const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Ointment / Cream', 'Drops', 'Inhaler', 'Powder / Sachet', 'Other'];
function pharmaFromProduct(product: Product): PharmaDetails {
  const d = product.pharma_details;
  if (!d) return blankPharma;
  return { genericName: d.genericName ?? '', composition: d.composition ?? '', strength: d.strength ?? '', dosageForm: d.dosageForm ?? '', manufacturer: d.manufacturer ?? '', drugCategory: d.drugCategory ?? '', drugSchedule: d.drugSchedule ?? '', storageCondition: d.storageCondition ?? '', coldChain: Boolean(d.coldChain) };
}
function pharmaToPayload(p: PharmaDetails): StoredPharmaDetails | null {
  const t = (v: string) => v.trim() || null;
  const empty = !p.genericName.trim() && !p.composition.trim() && !p.strength.trim() && !p.dosageForm && !p.manufacturer.trim() && !p.drugCategory && !p.drugSchedule && !p.storageCondition.trim() && !p.coldChain;
  if (empty) return null;
  return { genericName: t(p.genericName), composition: t(p.composition), strength: t(p.strength), dosageForm: t(p.dosageForm), manufacturer: t(p.manufacturer), drugCategory: p.drugCategory || null, drugSchedule: t(p.drugSchedule), storageCondition: t(p.storageCondition), coldChain: p.coldChain };
}

// ---------- Textile (fabric) product details — used only when the active industry is textile ----------
type StoredTextileDetails = {
  fabricType?: string | null; composition?: string | null;
  width?: number | null; widthUnit?: 'in' | 'cm' | null; gsm?: number | null;
  lengthPerRoll?: number | null; lengthUnit?: 'm' | 'yd' | null; pattern?: string | null;
  designCode?: string | null; sizes?: string[]; imageUrl?: string | null;
  colors?: { name: string; code?: string | null; quantity?: number | null }[];
};
type TextileColor = { name: string; code: string; quantity: string };
type TextileDetails = {
  fabricType: string; composition: string; width: string; widthUnit: 'in' | 'cm'; gsm: string;
  lengthPerRoll: string; lengthUnit: 'm' | 'yd'; pattern: string; colors: TextileColor[];
  designCode: string; sizes: string; imageUrl: string;
};
const blankTextile: TextileDetails = {
  fabricType: '', composition: '', width: '', widthUnit: 'in', gsm: '',
  lengthPerRoll: '', lengthUnit: 'm', pattern: '', colors: [],
  designCode: '', sizes: '', imageUrl: '',
};
const FABRIC_TYPES = ['Cotton', 'Silk', 'Linen', 'Wool', 'Polyester', 'Viscose / Rayon', 'Nylon', 'Denim', 'Georgette', 'Chiffon', 'Satin', 'Velvet', 'Blended'];
const numOrNull = (value: string) => (value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value));
function textileFromProduct(product: Product): TextileDetails {
  const t = product.textile_details;
  if (!t) return blankTextile;
  return {
    fabricType: t.fabricType ?? '', composition: t.composition ?? '',
    width: t.width == null ? '' : String(t.width), widthUnit: t.widthUnit ?? 'in',
    gsm: t.gsm == null ? '' : String(t.gsm),
    lengthPerRoll: t.lengthPerRoll == null ? '' : String(t.lengthPerRoll), lengthUnit: t.lengthUnit ?? 'm',
    pattern: t.pattern ?? '',
    designCode: t.designCode ?? '', sizes: (t.sizes ?? []).join(', '), imageUrl: t.imageUrl ?? '',
    colors: (t.colors ?? []).map((c) => ({ name: c.name, code: c.code ?? '', quantity: c.quantity == null ? '' : String(c.quantity) })),
  };
}
function textileToPayload(t: TextileDetails): StoredTextileDetails | null {
  const colors = t.colors.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), code: c.code.trim() || null, quantity: numOrNull(c.quantity) }));
  const sizes = t.sizes.split(',').map((s) => s.trim()).filter(Boolean);
  const empty = !t.fabricType && !t.composition && !t.width && !t.gsm && !t.lengthPerRoll && !t.pattern && !t.designCode.trim() && !t.imageUrl && sizes.length === 0 && colors.length === 0;
  if (empty) return null;
  return {
    fabricType: t.fabricType.trim() || null, composition: t.composition.trim() || null,
    width: numOrNull(t.width), widthUnit: t.widthUnit, gsm: numOrNull(t.gsm),
    lengthPerRoll: numOrNull(t.lengthPerRoll), lengthUnit: t.lengthUnit, pattern: t.pattern.trim() || null, colors,
    designCode: t.designCode.trim() || null, sizes, imageUrl: t.imageUrl || null,
  };
}
// Shrinks a picked picture to at most 900px (JPEG) so uploads stay small, then stores it and returns its public URL.
async function uploadProductImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG or WebP).');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const res = await api<{ data: { url: string } }>('/products/image', { method: 'POST', body: JSON.stringify({ dataUrl }) });
  return res.data.url;
}
const textileSizeText = (t?: StoredTextileDetails | null) => [
  t?.width ? `${t.width} ${t.widthUnit ?? 'in'} wide` : '',
  t?.gsm ? `${t.gsm} GSM` : '',
].filter(Boolean).join(' · ');
// Textile SKU suggestion, e.g. "TEX-COT-RED-482" (fabric type + first colour, else fabric name).
function generateTextileCode(t: TextileDetails, productName: string, suffix: number): string {
  const colour = t.colors.find((c) => c.name.trim())?.name ?? '';
  return `TEX-${slugPart(t.fabricType || productName, 3)}-${slugPart(colour || productName, 4)}-${suffix}`;
}

type ProductForm = { 
  productCode: string;
  productName: string;
 category: string;
  sellingPrice: string;
  costPrice: string;
  stockQuantity: string;
  shelfLifeDays: string;
  status: 'active' | 'inactive';
  industryTypeId: string;
  // Real, backend-persisted field (products.tax_percent) — not part of
  // FmcgMeta/localStorage.
  taxPercent: string;
  // Trading fields — real, backend-persisted columns on `products`.
  hsnCode: string;
  specification: string;
  originCountry: string;
  supplierName: string;
  currency: string;
} & FmcgMeta & { textile: TextileDetails; pharma: PharmaDetails };

const blankForm: ProductForm = {
  productCode: '',
  productName: '',
 category: '',
  sellingPrice: '',
  costPrice: '',
  stockQuantity: '',
  shelfLifeDays: '',
  status: 'active',
  industryTypeId: '',
  taxPercent: '',
  hsnCode: '',
  specification: '',
  originCountry: '',
  supplierName: '',
  currency: 'INR',
  ...blankFmcgMeta,
  textile: blankTextile,
  pharma: blankPharma,
};

// Related-orders lookup: match by product_code against sale_order_items, the
// same shape OrdersPage already uses — no new endpoint, no id join required.
type RelatedOrderLine = { products?: { product_code?: string } | null };
type RelatedOrder = { id: string; order_number: string; status: string; total_amount: number; created_at: string; sale_order_items?: RelatedOrderLine[] };

export function ProductsPage() {
  const { matchesActiveIndustry, activeIndustryTypeId } = useIndustryScope();
  const { activeIndustry } = useIndustry();
  const isTrading = activeIndustry === 'trading';
  const isTextile = activeIndustry === 'textile';
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [currencyCodes, setCurrencyCodes] = useState<string[]>(['INR']);
  const [items, setItems] = useState<Product[]>([]);
  const [industryTypes, setIndustryTypes] = useState<{ id: string; name: string }[]>([]);
  const [allOrders, setAllOrders] = useState<RelatedOrder[]>([]);
  const [form, setForm] = useState<ProductForm>(blankForm);
  // Auto-SKU bookkeeping: one stable random suffix per "Add product" session,
  // and a flag so a SKU the person typed by hand is never overwritten.
  const codeSuffixRef = useRef(newCodeSuffix());
  const codeTouchedRef = useRef(false);
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
  const [imageBusy, setImageBusy] = useState(false);
  async function pickTextileImage(file: File | undefined) {
    if (!file) return;
    setImageBusy(true);
    try { setTextile({ imageUrl: await uploadProductImage(file) }); setMessage(''); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Unable to upload the image.'); }
    finally { setImageBusy(false); }
  }
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
      const products = (await api<{ data: Product[] }>('/products')).data ?? [];
      setItems(products);
      const metaMap = loadAllFmcgMeta();
      for (const p of products) {
        if (p.mrp != null) {
          // MRP / discount come from the database first, so every device shows the same values.
          metaMap[p.id] = { ...(metaMap[p.id] ?? blankFmcgMeta), mrp: String(p.mrp), discountPercent: p.discount_percent ? String(p.discount_percent) : '' };
        } else if (metaMap[p.id] && Number(metaMap[p.id].mrp) > 0) {
          // One-time copy: older product whose MRP/discount only lived in this browser -> save to the database.
          void api(`/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ mrp: Number(metaMap[p.id].mrp), discountPercent: Number(metaMap[p.id].discountPercent || 0) }) }).catch(() => undefined);
        }
      }
      setFmcgMetaMap(metaMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load products.');
    } finally {
      setLoading(false);
    }
  }

  // FMCG only: units sitting in expired / blocked batches, so Stock can show what is really sellable.
  const { settings: orgSettings } = useOrgSettings();
  const blockDays = Math.max(0, Number(orgSettings.expiryBatch.blockSaleWithinDaysOfExpiry) || 0);
  const [fmcgBatches, setFmcgBatches] = useState<{ product_id: string; batch_no: string; mfg_date: string | null; expiry_date: string | null; quantity: number }[]>([]);
  useEffect(() => {
    if (activeIndustry !== 'fmcg') { setFmcgBatches([]); return; }
    let live = true;
    api<{ data: { product_id: string; batch_no: string; mfg_date: string | null; expiry_date: string | null; quantity: number }[] }>('/fmcg/batches').then((r) => { if (live) setFmcgBatches(r.data ?? []); }).catch(() => { if (live) setFmcgBatches([]); });
    return () => { live = false; };
  }, [activeIndustry, activeIndustryTypeId]);
  const lockedUnits = useMemo(() => lockedUnitsByProduct(fmcgBatches, blockDays), [fmcgBatches, blockDays]);
  // FMCG: batch / expiry come from the real batches (earliest-expiring one that still has units), never from typed product fields.
  const nearestBatch = useMemo(() => {
    const out: Record<string, { batch: string; mfg: string; expiry: string; count: number }> = {};
    const live = fmcgBatches.filter((b) => Number(b.quantity) > 0).sort((a, b) => (a.expiry_date ?? '9999') < (b.expiry_date ?? '9999') ? -1 : 1);
    for (const b of live) {
      const hit = out[b.product_id];
      if (hit) hit.count += 1; else out[b.product_id] = { batch: b.batch_no, mfg: b.mfg_date ?? '', expiry: b.expiry_date ?? '', count: 1 };
    }
    return out;
  }, [fmcgBatches]);
  const metaOf = (id: string): FmcgMeta => {
    const base = fmcgMetaMap[id] ?? blankFmcgMeta;
    if (activeIndustry !== 'fmcg') return base;
    const n = nearestBatch[id];
    return { ...base, batchNumber: n ? `${n.batch}${n.count > 1 ? ` (+${n.count - 1} more)` : ''}` : '', mfgDate: n?.mfg ?? '', expiryDate: n?.expiry ?? '' };
  };

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

  // Trading only: suppliers and currencies come from the Trading modules.
  // Non-fatal — if this fails the fields still work as free text / INR.
  useEffect(() => {
    if (!isTrading) return;
    api<{ data: { supplier_name?: string }[] }>('/trading/suppliers')
      .then((res) => setSupplierNames([...new Set((res.data ?? []).map((row) => String(row.supplier_name ?? '').trim()).filter(Boolean))].sort()))
      .catch(() => { /* fall back to typing the supplier */ });
    api<{ data: { currency_code?: string }[] }>('/trading/currency-rates')
      .then((res) => setCurrencyCodes([...new Set(['INR', ...(res.data ?? []).map((row) => String(row.currency_code ?? '').trim()).filter(Boolean)])]))
      .catch(() => { /* fall back to INR only */ });
  }, [isTrading]);

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
    const meta = metaOf(item.id);
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
  }), [industryItems, fmcgMetaMap, nearestBatch, activeIndustry, search, filterBrand, filterCategory, filterStatus, filterStock, filterExpiry]);

  const kpis = useMemo(() => {
    let active = 0, lowStock = 0, outOfStock = 0, expiringSoon = 0, totalStock = 0;
    industryItems.forEach((item) => {
      if (item.status === 'active') active += 1;
      const meta = metaOf(item.id);
      const state = stockStatus(item.stock_quantity, meta.minStockLevel);
      if (state === 'low') lowStock += 1;
      if (state === 'out') outOfStock += 1;
      const expiry = expiryStatus(meta.expiryDate);
      if (expiry?.label.startsWith('Expiring')) expiringSoon += 1;
      totalStock += item.stock_quantity ?? 0;
    });
    return { total: industryItems.length, active, lowStock, outOfStock, expiringSoon, totalStock };
  }, [industryItems, fmcgMetaMap, nearestBatch, activeIndustry]);

  // Show the Batch/Expiry column, card and filter only when they're useful:
  // always for FMCG/Pharma, otherwise only if some product tracks batches.
  const showBatchUi = BATCH_DEFAULT_INDUSTRIES.includes(activeIndustry)
    || industryItems.some((item) => tracksBatch(fmcgMetaMap[item.id] ?? blankFmcgMeta));

  // Pharma only: expiry = manufacturing date + shelf life (days), until the user types an expiry themselves.
  const expiryTouchedRef = useRef(false);
  useEffect(() => {
    if (!modalOpen) { expiryTouchedRef.current = false; return; }
    if (activeIndustry !== 'pharma' || !form.trackBatch) return;
    if (expiryTouchedRef.current || (editing && form.expiryDate)) return;
    const days = Number(form.shelfLifeDays);
    if (!form.mfgDate || !days || days <= 0) return;
    const next = addDaysIso(form.mfgDate, days);
    if (next !== form.expiryDate) setForm((f) => ({ ...f, expiryDate: next }));
  }, [activeIndustry, modalOpen, editing, form.trackBatch, form.mfgDate, form.shelfLifeDays]);

  // Textile: suggest the SKU from fabric type + colour while adding (never overwrites a typed code).
  useEffect(() => {
    if (!isTextile || !modalOpen || editing || codeTouchedRef.current) return;
    const code = generateTextileCode(form.textile, form.productName, codeSuffixRef.current);
    setForm((current) => (current.productCode === code ? current : { ...current, productCode: code }));
  }, [isTextile, modalOpen, editing, form.textile.fabricType, form.textile.colors, form.productName]);
  function setTextile(patch: Partial<TextileDetails>) {
    setForm((current) => {
      const textile = { ...current.textile, ...patch };
      // When colours carry quantities, the product's stock is their total.
      const withQty = textile.colors.filter((c) => c.quantity.trim() !== '');
      const stockQuantity = patch.colors && withQty.length > 0
        ? String(withQty.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0))
        : current.stockQuantity;
      return { ...current, textile, stockQuantity };
    });
  }
  const setTextileColor = (index: number, patch: Partial<TextileColor>) =>
    setTextile({ colors: form.textile.colors.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  function openCreate() {
    setEditing(null);
    setSavedBrands(loadNameList(brandListKey(activeIndustry)));
    setSavedCategories(loadNameList(categoryListKey(activeIndustry)));
    setSavedUnits(loadNameList(unitListKey(activeIndustry)));
    // Automation: default to whichever Industry Type tab is already open —
    // that's the overwhelmingly common case, and it's still editable below
    // for the rare product that belongs to a different industry.
    codeSuffixRef.current = newCodeSuffix();
    codeTouchedRef.current = false;
    // Category starts empty on purpose: defaulting to the first saved category
    // (e.g. "Hardware" from an old product) silently put wrong categories and
    // SKU prefixes on new products.
    setForm({ ...blankForm, category: '', industryTypeId: activeIndustryTypeId ?? '', trackBatch: BATCH_DEFAULT_INDUSTRIES.includes(activeIndustry) });
    setMessage('');
    setModalOpen(true);
  }
  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      productCode: product.product_code,
      productName: product.product_name,
      // No category stays blank — never silently default to the first one in the list.
      category: product.category ?? '',
     sellingPrice: String(product.selling_price),
      costPrice: product.cost_price == null ? '' : String(product.cost_price),
      stockQuantity: product.stock_quantity == null ? '' : String(product.stock_quantity),
      shelfLifeDays: product.shelf_life_days ? String(product.shelf_life_days) : '',
         status: product.status,
      industryTypeId: product.industry_type_id ?? activeIndustryTypeId ?? '',
         ...loadFmcgMeta(product.id),
      trackBatch: tracksBatch(loadFmcgMeta(product.id)),
      ...(product.mrp != null ? { mrp: String(product.mrp), discountPercent: product.discount_percent ? String(product.discount_percent) : '' } : {}),
      unit: product.unit ?? 'pcs',
        taxPercent: product.tax_percent == null ? '' : String(product.tax_percent),
      hsnCode: product.hsn_code ?? '',
      specification: product.specification ?? '',
      originCountry: product.origin_country ?? '',
      supplierName: product.supplier_name ?? '',
      currency: product.currency ?? 'INR',
      textile: textileFromProduct(product),
      pharma: pharmaFromProduct(product),
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
    // Instant lock: `saving` is state and updates only after a re-render, so a fast double-click
    // could run this twice and create two batches. This flag blocks the second run immediately.
    const formEl = event.currentTarget as HTMLFormElement;
    if (formEl.dataset.busy === '1') return;
    if (activeIndustry === 'pharma' && form.trackBatch && !form.expiryDate) {
      setMessage('Enter the expiry date, or enter the manufacturing date and shelf life so it is calculated.');
      return;
    }
    formEl.dataset.busy = '1';
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
      batchNumber: form.trackBatch ? form.batchNumber : '',
      mfgDate: form.trackBatch ? form.mfgDate : '',
      expiryDate: form.trackBatch ? form.expiryDate : '',
      minStockLevel: form.minStockLevel,
      trackBatch: form.trackBatch,
    };
    const body = {
      productCode: form.productCode,
      productName: form.productName,
      category: form.category || null,
      sellingPrice: Number(form.sellingPrice),
      costPrice: form.costPrice === '' ? null : Number(form.costPrice),
      stockQuantity: isTextile && form.textile.colors.some((c) => c.quantity.trim() !== '')
        ? form.textile.colors.reduce((sum, c) => sum + (Number(c.quantity) || 0), 0)
        : (form.stockQuantity === '' ? null : Number(form.stockQuantity)),
      ...(showBatchUi ? { shelfLifeDays: form.shelfLifeDays === '' ? null : Number(form.shelfLifeDays) } : {}),
      status: form.status,
      unit: form.unit || null,
      taxPercent: form.taxPercent === '' ? (activeIndustry === 'pharma' ? 0 : null) : Number(form.taxPercent),
      hsnCode: form.hsnCode || null,
      specification: form.specification || null,
      originCountry: form.originCountry || null,
      supplierName: form.supplierName || null,
      currency: form.currency || null,
      mrp: form.mrp === '' ? null : Number(form.mrp),
      discountPercent: form.discountPercent === '' ? null : Number(form.discountPercent),
      industryTypeIds: [form.industryTypeId || activeIndustryTypeId || ''].filter(Boolean),
      // Textile only — other industries never send this field.
      ...(isTextile ? { textileDetails: textileToPayload(form.textile) } : {}),
      // Pharma only — other industries never send this field.
      ...(activeIndustry === 'pharma' ? { pharmaDetails: pharmaToPayload(form.pharma) } : {}),
    };
    try {
      const response = await api<{ data: Product }>(editing ? `/products/${editing.id}` : '/products', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      const productId = editing ? editing.id : response.data.id;
      saveFmcgMeta(productId, fmcgMeta);
      let pharmaBatchNote = '';
      // Pharma only: the batch entered on the product becomes (or updates) a real record in Pharma > Batch & Expiry.
      if (activeIndustry === 'pharma' && form.trackBatch && form.expiryDate) {
        try {
          const list = await api<{ data: { id: string; batch_number: string; product_code?: string | null; manufacture_date?: string | null; quantity?: number | string | null }[] }>('/pharma/batches');
          const existingBatches = list.data ?? [];
          const sameCode = (code?: string | null) => String(code ?? '').trim().toLowerCase() === form.productCode.trim().toLowerCase();
          const ofProduct = existingBatches.filter((b) => sameCode(b.product_code));
          const typed = form.batchNumber.trim();
          // No number typed: reuse this product's batch with the same manufacture date.
          // When editing a product that has exactly one batch, that batch is the one being edited, so it is updated, never duplicated.
          const sameLot = typed
            ? undefined
            : (ofProduct.find((b) => String(b.manufacture_date ?? '').slice(0, 10) === (form.mfgDate || ''))
              ?? (editing && ofProduct.length === 1 ? ofProduct[0] : undefined));
          const batchNo = typed || sameLot?.batch_number
            || previewBatchNo(form.productCode, form.mfgDate, existingBatches.map((b) => b.batch_number));
              const match = existingBatches.find((b) => b.batch_number.toLowerCase() === batchNo.toLowerCase());
          saveFmcgMeta(productId, { ...fmcgMeta, batchNumber: batchNo }); // keep the real (auto) batch number so the Products list shows it
          // A product with ONE batch: the stock typed on the product is that batch's quantity.
          const soleBatch = !!match && ofProduct.length === 1 && ofProduct[0].id === match.id;
          const batchFields = {
            batch_number: batchNo,
            product_code: form.productCode,
            product_name: form.productName,
            manufacture_date: form.mfgDate || null,
            expiry_date: form.expiryDate,
            unit: form.unit || null,
          };
          if (match && soleBatch && form.stockQuantity !== '') Object.assign(batchFields, { quantity: Number(form.stockQuantity) });
          if (match) {
            // Same batch already on file: update its dates (quantity is otherwise managed by Batch & Expiry).
            await api(`/pharma/batches/${match.id}`, { method: 'PATCH', body: JSON.stringify(batchFields) });
            pharmaBatchNote = ' Batch updated in Batch & Expiry.';
          } else {
            await api('/pharma/batches', {
              method: 'POST',
              body: JSON.stringify({
                ...batchFields,
                quantity: form.stockQuantity === '' ? 0 : Number(form.stockQuantity),
                ...(activeIndustryTypeId ? { industry_type_id: activeIndustryTypeId } : {}),
              }),
            });
            pharmaBatchNote = ` Batch ${batchNo} added to Batch & Expiry.`;
          }
        } catch (batchError) {
          const text = batchError instanceof Error ? batchError.message : 'Unknown error';
          pharmaBatchNote = ` Batch was not saved to Batch & Expiry: ${text}`;
        }
      }
      setMessage((editing ? 'Product updated successfully.' : 'Product added successfully.') + pharmaBatchNote);
      closeModal(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setSaving(false);
      delete formEl.dataset.busy;
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
  // KPI card clicks: clear everything, then set just the status / stock / expiry filter that reproduces the card's number.
  function showProducts(next: { status?: Product['status']; stock?: StockState; expiry?: 'expiring' } = {}) {
    clearFilters();
    if (next.status) setFilterStatus(next.status);
    if (next.stock) setFilterStock(next.stock);
    if (next.expiry) setFilterExpiry(next.expiry);
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
        <div className="kpi-card" data-tone="ink" {...kpiClick(activeFilterCount === 0 && !search.trim(), () => showProducts())}><div className="kpi-icon kpi-icon-ink">▣</div><div><span>Total Products</span><strong>{kpis.total}</strong></div></div>
        <div className="kpi-card" data-tone="green" {...kpiClick(filterStatus === 'active' && filterStock === 'all' && filterExpiry === 'all', () => showProducts({ status: 'active' }))}><div className="kpi-icon kpi-icon-green">✓</div><div><span>Active Products</span><strong>{kpis.active}</strong></div></div>
        <div className="kpi-card" data-tone="amber" {...kpiClick(filterStock === 'low' && filterStatus === 'all' && filterExpiry === 'all', () => showProducts({ stock: 'low' }))}><div className="kpi-icon kpi-icon-amber">⚠</div><div><span>Low Stock</span><strong>{kpis.lowStock}</strong></div></div>
        <div className="kpi-card" data-tone="red" {...kpiClick(filterStock === 'out' && filterStatus === 'all' && filterExpiry === 'all', () => showProducts({ stock: 'out' }))}><div className="kpi-icon kpi-icon-red">⬤</div><div><span>Out of Stock</span><strong>{kpis.outOfStock}</strong></div></div>
        {showBatchUi && <div className="kpi-card" data-tone="blue" {...kpiClick(filterExpiry === 'expiring' && filterStatus === 'all' && filterStock === 'all', () => showProducts({ expiry: 'expiring' }))}><div className="kpi-icon kpi-icon-blue">◷</div><div><span>Expiring Soon</span><strong>{kpis.expiringSoon}</strong></div></div>}        <div className="kpi-card" data-tone="ink" {...kpiClick(false, () => showProducts())}><div className="kpi-icon kpi-icon-ink">▤</div><div><span>Total Stock</span><strong>{kpis.totalStock.toLocaleString('en-IN')}</strong></div></div>
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
                {showBatchUi && (
            <select value={filterExpiry} onChange={(event) => setFilterExpiry(event.target.value as typeof filterExpiry)}>
              <option value="all">All batches</option>
              <option value="expiring">Expiring soon</option>
              <option value="expired">Expired</option>
              <option value="none">No batch/expiry set</option>
            </select>
          )}
          <button type="button" className="link-button" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</button>
        </div>
      </div>

      {message && <p role="status" className={message.includes('successfully') ? 'success' : 'error'}>{message}</p>}
      {loading ? <p>Loading products…</p> : (
        <div className="data-table-wrap">
          <table>
            <thead>
<tr><th>Product</th><th>SKU / Barcode</th><th>{isTextile ? 'Fabric' : 'Brand'}</th><th>Category</th>{isTextile && <th>Length / Colours</th>}{isTrading && <th>HSN</th>}<th>{isTrading ? 'Purchase Price' : 'MRP'}</th>{activeIndustry === 'fmcg' && <th>Purchase Price</th>}<th>Selling Price</th><th>GST</th><th>Final Price</th><th>Stock</th>{showBatchUi && <th>Batch / Expiry</th>}<th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const meta = metaOf(item.id);
                const expiry = expiryStatus(meta.expiryDate);
                const stockState = stockStatus(item.stock_quantity, meta.minStockLevel);
                return (
                  <tr key={item.id}>
                                <td>
                      {isTextile && item.textile_details?.imageUrl && <img src={item.textile_details.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, float: 'left', marginRight: 8 }} />}
                      <strong>{item.product_name}</strong>
                      {isTextile && (item.textile_details?.sizes ?? []).length > 0 && <><br /><small className="text-faint-inline">Sizes: {(item.textile_details?.sizes ?? []).join(', ')}</small></>}
                      {isTrading && item.specification && <><br /><small className="text-faint-inline">{item.specification}</small></>}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{item.product_code}</span>
                      <br /><small className="text-faint-inline">{meta.barcode || 'No barcode'}</small>
                    </td>
                    <td>{isTextile ? (<>{item.textile_details?.fabricType || '—'}{textileSizeText(item.textile_details) && <><br /><small className="text-faint-inline">{textileSizeText(item.textile_details)}</small></>}</>) : (meta.brand || '—')}</td>
                    <td>{item.category ?? '—'}{meta.subCategory ? ` / ${meta.subCategory}` : ''}</td>
                    {isTextile && (
                      <td>
                        {item.textile_details?.lengthPerRoll ? `${item.textile_details.lengthPerRoll} ${item.textile_details.lengthUnit ?? 'm'} / roll` : '—'}
                        {(item.textile_details?.colors ?? []).length > 0 && (
                          <><br /><small className="text-faint-inline">{(item.textile_details?.colors ?? []).map((c) => c.name).join(', ')}</small></>
                        )}
                      </td>
                    )}
                                          {isTrading && <td>{item.hsn_code || '—'}</td>}
<td>{isTrading ? (item.cost_price == null ? '—' : formatMoney(Number(item.cost_price))) : formatMoney(Number(meta.mrp || item.selling_price))}</td>
                    {activeIndustry === 'fmcg' && <td>{item.cost_price == null ? '—' : formatMoney(Number(item.cost_price))}</td>}
                    <td>
                      {formatMoney(Number(item.selling_price))}
                      {Number(meta.discountPercent) > 0 && <><br /><small className="text-faint-inline">{meta.discountPercent}% off</small></>}
                    </td>
                                   <td>{Number(item.tax_percent || 0)}%</td>
                    <td><strong>{formatMoney(Number(item.selling_price) + (Number(item.selling_price) * Number(item.tax_percent || 0)) / 100)}</strong></td>
                                      <td>
                      {item.stock_quantity ?? '—'}{item.stock_quantity != null && meta.unit ? ` ${meta.unit}` : ''}
                      {item.stock_quantity != null && (lockedUnits[item.id] ?? 0) > 0 && <><br /><small className="text-faint-inline">{Math.max(0, item.stock_quantity - lockedUnits[item.id])} sellable · {lockedUnits[item.id]} expired/blocked</small></>}
                      {stockState === 'low'&& <><br /><span className="status-badge status-quoted">Low stock</span></>}
                      {stockState === 'out' && <><br /><span className="status-badge status-cancelled">Out of stock</span></>}
                    </td>
                                    {showBatchUi && (
                      <td>
                        {meta.batchNumber || '—'}
                        {expiry && <><br /><span className={`status-badge ${expiry.className}`}>{expiry.label}</span></>}
                      </td>
                    )}
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
                                           <label>SKU / product code (auto-suggested)<input required placeholder="Auto-generated" value={form.productCode} onChange={(event) => { codeTouchedRef.current = true; setForm({ ...form, productCode: event.target.value }); }} /></label>
                <label>{isTextile ? 'Fabric name' : 'Product name'}<input required placeholder={isTextile ? 'e.g. Premium Cotton Poplin' : undefined} value={form.productName} onChange={(event) => { const productName = event.target.value; setForm((current) => ({ ...current, productName, productCode: !editing && !codeTouchedRef.current ? generateProductCode(current.category, productName, codeSuffixRef.current) : current.productCode })); }} /></label>
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
                  <select value={form.category} onChange={(event) => { const category = event.target.value; setForm((current) => ({ ...current, category, productCode: !editing && !codeTouchedRef.current && current.productName ? generateProductCode(category, current.productName, codeSuffixRef.current) : current.productCode })); }}>
                    <option value="">No category</option>
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
                    {isTrading && <option value="mt">MT (metric tonne)</option>}
                    {isTextile && <><option value="m">Meter</option><option value="yd">Yard</option><option value="roll">Roll</option><option value="than">Than (piece)</option></>}
                    {savedUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>  
                {activeIndustry === 'pharma' && (<>
                  <label>Generic name<input placeholder="e.g. Atorvastatin" value={form.pharma.genericName} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, genericName: event.target.value } })} /></label>
                  <label>Composition<input placeholder="e.g. Atorvastatin Calcium IP 10 mg" value={form.pharma.composition} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, composition: event.target.value } })} /></label>
                  <label>Strength<input placeholder="e.g. 10 mg" value={form.pharma.strength} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, strength: event.target.value } })} /></label>
                  <label>Dosage form<select value={form.pharma.dosageForm} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, dosageForm: event.target.value } })}><option value="">Select</option>{DOSAGE_FORMS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                  <label>Manufacturer<input placeholder="Company that makes it" value={form.pharma.manufacturer} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, manufacturer: event.target.value } })} /></label>
                  <label>Drug category<select value={form.pharma.drugCategory} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, drugCategory: event.target.value as PharmaDetails['drugCategory'] } })}><option value="">Select</option><option value="OTC">OTC</option><option value="Prescription">Prescription</option><option value="Narcotic / Psychotropic">Narcotic / Psychotropic</option></select></label>
                  <label>Drug schedule<select value={form.pharma.drugSchedule} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, drugSchedule: event.target.value } })}><option value="">Select</option>{DRUG_SCHEDULES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                  <label>Storage condition<input placeholder="e.g. Store below 25°C, away from light" value={form.pharma.storageCondition} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, storageCondition: event.target.value } })} /></label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <input type="checkbox" style={{ width: 'auto', padding: 0, border: 'none', boxShadow: 'none', background: 'none' }} checked={form.pharma.coldChain} onChange={(event) => setForm({ ...form, pharma: { ...form.pharma, coldChain: event.target.checked } })} /> Cold-chain product (2–8°C)
                  </label>
                </>)}
{!isTextile && <label>Pack size<input placeholder={PACK_SIZE_PLACEHOLDERS[activeIndustry] ?? 'e.g. 10 pcs per box'} value={form.packSize} onChange={(event) => setForm({ ...form, packSize: event.target.value })} /></label>}
                {isTextile && (
                  <>
                    <label>
                      Fabric type
                      <input list="fabric-type-options" placeholder="e.g. Cotton" value={form.textile.fabricType} onChange={(event) => setTextile({ fabricType: event.target.value })} />
                      <datalist id="fabric-type-options">{FABRIC_TYPES.map((name) => <option key={name} value={name} />)}</datalist>
                    </label>
                    <label>Composition<input placeholder="e.g. 60% cotton, 40% polyester" value={form.textile.composition} onChange={(event) => setTextile({ composition: event.target.value })} /></label>
                    <label>
                      Width
                      <span style={{ display: 'flex', gap: '.5rem' }}>
                        <input min="0" type="number" step="0.01" placeholder="e.g. 44" value={form.textile.width} onChange={(event) => setTextile({ width: event.target.value })} />
                        <select style={{ maxWidth: '5.5rem' }} value={form.textile.widthUnit} onChange={(event) => setTextile({ widthUnit: event.target.value as 'in' | 'cm' })}><option value="in">inch</option><option value="cm">cm</option></select>
                      </span>
                    </label>
                    <label>GSM / weight<input min="0" type="number" step="0.01" placeholder="e.g. 120" value={form.textile.gsm} onChange={(event) => setTextile({ gsm: event.target.value })} /></label>
                    <label>
                      Length per roll / than
                      <span style={{ display: 'flex', gap: '.5rem' }}>
                        <input min="0" type="number" step="0.01" placeholder="e.g. 30" value={form.textile.lengthPerRoll} onChange={(event) => setTextile({ lengthPerRoll: event.target.value })} />
                        <select style={{ maxWidth: '5.5rem' }} value={form.textile.lengthUnit} onChange={(event) => setTextile({ lengthUnit: event.target.value as 'm' | 'yd' })}><option value="m">meter</option><option value="yd">yard</option></select>
                      </span>
                    </label>
                    <label>Pattern<input placeholder="e.g. Plain, Floral, Check" value={form.textile.pattern} onChange={(event) => setTextile({ pattern: event.target.value })} /></label>
                    <label>Design code / name<input placeholder="e.g. DSN-2026-014 or Floral Zari" value={form.textile.designCode} onChange={(event) => setTextile({ designCode: event.target.value })} /></label>
                    <label>
                      Sizes (comma separated)
                      <input list="textile-size-options" placeholder="e.g. S, M, L, XL or Free size" value={form.textile.sizes} onChange={(event) => setTextile({ sizes: event.target.value })} />
                      <datalist id="textile-size-options">{['Free size', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'By metre'].map((name) => <option key={name} value={name} />)}</datalist>
                    </label>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p className="ledger-heading" style={{ margin: '.4rem 0' }}>Design image</p>
                      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {form.textile.imageUrl && <img src={form.textile.imageUrl} alt="Design" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid #ddd' }} />}
                        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={imageBusy} onChange={(event) => { void pickTextileImage(event.target.files?.[0]); event.target.value = ''; }} />
                        {imageBusy && <small>Uploading…</small>}
                        {form.textile.imageUrl && !imageBusy && <button type="button" className="quiet-button" onClick={() => setTextile({ imageUrl: '' })}>Remove image</button>}
                      </div>
                    </div>
                    <label>HSN code<input placeholder="e.g. 5208" value={form.hsnCode} onChange={(event) => setForm({ ...form, hsnCode: event.target.value })} /></label>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <p className="ledger-heading" style={{ margin: '.4rem 0' }}>Colours &amp; stock ({form.unit === 'pcs' ? 'rolls / pieces' : form.unit})</p>
                      {form.textile.colors.map((colour, index) => (
                        <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr auto', gap: '.5rem', marginBottom: '.5rem' }}>
                          <input placeholder="Colour name (e.g. Navy Blue)" value={colour.name} onChange={(event) => setTextileColor(index, { name: event.target.value })} />
                          <input placeholder="Shade / code" value={colour.code} onChange={(event) => setTextileColor(index, { code: event.target.value })} />
                          <input min="0" type="number" step="0.01" placeholder="Qty" value={colour.quantity} onChange={(event) => setTextileColor(index, { quantity: event.target.value })} />
                          <button type="button" className="icon-action" aria-label="Remove colour" title="Remove colour" onClick={() => setTextile({ colors: form.textile.colors.filter((_, i) => i !== index) })}>×</button>
                        </div>
                      ))}
                      <button type="button" className="quiet-button" onClick={() => setTextile({ colors: [...form.textile.colors, { name: '', code: '', quantity: '' }] })}>+ Add colour</button>
                    </div>
                  </>
                )}
                {isTrading && (
                  <>
                    <label>HSN code<input placeholder="e.g. 7306" value={form.hsnCode} onChange={(event) => setForm({ ...form, hsnCode: event.target.value })} /></label>
                    <label>Specification / Grade<input placeholder="e.g. 50 mm dia, 3 mm thick, IS 1239" value={form.specification} onChange={(event) => setForm({ ...form, specification: event.target.value })} /></label>
                    <label>Origin country<input placeholder="e.g. India" value={form.originCountry} onChange={(event) => setForm({ ...form, originCountry: event.target.value })} /></label>
                    <label>
                      Preferred supplier
                      <input list="supplier-options" placeholder="Pick or type a supplier" value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} />
                      <datalist id="supplier-options">{supplierNames.map((name) => <option key={name} value={name} />)}</datalist>
                    </label>
                    <label>
                      Currency
                      <select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
                        {[...new Set([...currencyCodes, form.currency].filter(Boolean))].map((code) => <option key={code} value={code}>{code}</option>)}
                      </select>
                    </label>
                  </>
                )}
{!isTrading && (
  <>
    <label>MRP (₹)<input min="0" type="number" step="0.01" value={form.mrp} onChange={(event) => { const mrp = event.target.value; setForm((current) => ({ ...current, mrp, sellingPrice: computeSellingPrice(mrp, current.discountPercent) || current.sellingPrice })); }} /></label>
    <label>Discount (%)<input min="0" max="100" type="number" step="0.01" value={form.discountPercent} onChange={(event) => { const discountPercent = event.target.value; setForm((current) => ({ ...current, discountPercent, sellingPrice: computeSellingPrice(current.mrp, discountPercent) || current.sellingPrice })); }} /></label>
  </>
)}
<label>Purchase price (₹)<input min="0" type="number" step="0.01" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} /></label>
<label>{isTrading ? 'Selling price (₹)' : 'Selling price (₹) — auto from MRP & Discount'}<input required min="0" type="number" step="0.01" value={form.sellingPrice} readOnly={!isTrading} disabled={!isTrading && Boolean(form.mrp)} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} /></label>
                <label>Tax / GST (%)<input min="0" max="100" type="number" step="0.01" value={form.taxPercent} onChange={(event) => setForm({ ...form, taxPercent: event.target.value })} /></label>
                <label>Final price incl. GST (₹)<input readOnly disabled value={form.sellingPrice && form.taxPercent ? (Number(form.sellingPrice) + (Number(form.sellingPrice) * Number(form.taxPercent)) / 100).toFixed(2) : form.sellingPrice} /></label>
                <label>{isTextile && form.textile.colors.some((c) => c.quantity.trim() !== '') ? 'Total stock (sum of colours)' : 'Opening stock'}<input readOnly={isTextile && form.textile.colors.some((c) => c.quantity.trim() !== '')} min="0" type="number" step="1" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} /></label>
                <label>Minimum stock level<input min="0" type="number" step="1" value={form.minStockLevel} onChange={(event) => setForm({ ...form, minStockLevel: event.target.value })} /></label>
                {showBatchUi && <label>Shelf life (days)<input min="1" type="number" step="1" placeholder="e.g. 180" value={form.shelfLifeDays} onChange={(event) => setForm({ ...form, shelfLifeDays: event.target.value })} /><small className="text-faint-inline">Expiry = manufacturing date + this</small></label>}
                {activeIndustry !== 'fmcg' && !isTextile && (<>
                <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
<input type="checkbox" style={{ width: 'auto', padding: 0, border: 'none', boxShadow: 'none', background: 'none' }} checked={form.trackBatch} onChange={(event) => setForm({ ...form, trackBatch: event.target.checked })} />                  This product has batch / expiry
                </label>
                {form.trackBatch && (
                  <>
                    <label>Batch number<input placeholder="Leave blank to auto-generate" value={form.batchNumber} onChange={(event) => setForm({ ...form, batchNumber: event.target.value })} /></label>
                    <label>Manufacturing date<input type="date" value={form.mfgDate} onChange={(event) => setForm({ ...form, mfgDate: event.target.value })} /></label>
                    <label>Expiry date<input type="date" required value={form.expiryDate} onChange={(event) => { expiryTouchedRef.current = true; setForm({ ...form, expiryDate: event.target.value }); }} /></label>
                  </>
                )}
                </>)}
                <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductForm['status'] })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              </div>
              <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => closeModal()} disabled={saving}>Cancel</button><button type="submit" className="primary-action" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button></div>
            </form>
          </div>
        </div>
      )}

      {viewing && (() => {
        const meta = metaOf(viewing.id);
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
                {activeIndustry === 'pharma' && (() => {
                  const d = viewing.pharma_details;
                  return (
                    <>
                      <dt>Generic name</dt><dd>{d?.genericName || 'Not recorded'}</dd>
                      <dt>Composition</dt><dd>{[d?.composition, d?.strength].filter(Boolean).join(' · ') || 'Not recorded'}</dd>
                      <dt>Dosage form</dt><dd>{d?.dosageForm || 'Not recorded'}</dd>
                      <dt>Manufacturer</dt><dd>{d?.manufacturer || 'Not recorded'}</dd>
                      <dt>Drug category / schedule</dt><dd>{[d?.drugCategory, d?.drugSchedule].filter(Boolean).join(' · ') || 'Not recorded'}</dd>
                      <dt>Storage</dt><dd>{[d?.storageCondition, d?.coldChain ? 'Cold chain' : ''].filter(Boolean).join(' · ') || 'Not recorded'}</dd>
                    </>
                  );
                })()}
                {isTextile && (() => {
                  const t = viewing.textile_details;
                  const colors = t?.colors ?? [];
                  return (
                    <>
                      <dt>Fabric type</dt><dd>{t?.fabricType || 'Not recorded'}{t?.composition ? ` · ${t.composition}` : ''}</dd>
                      <dt>Width / GSM</dt><dd>{textileSizeText(t) || 'Not recorded'}</dd>
                      <dt>Length per roll</dt><dd>{t?.lengthPerRoll ? `${t.lengthPerRoll} ${t.lengthUnit ?? 'm'}` : 'Not recorded'}</dd>
                      <dt>Pattern</dt><dd>{t?.pattern || 'Not recorded'}</dd>
                      <dt>Design</dt><dd>{t?.designCode || 'Not recorded'}</dd>
                      <dt>Sizes</dt><dd>{(t?.sizes ?? []).length === 0 ? 'Not recorded' : (t?.sizes ?? []).join(', ')}</dd>
                      {t?.imageUrl && (<><dt>Image</dt><dd><img src={t.imageUrl} alt={viewing.product_name} style={{ maxWidth: 220, borderRadius: 8, border: '1px solid #ddd' }} /></dd></>)}
                      <dt>HSN code</dt><dd>{viewing.hsn_code || 'Not recorded'}</dd>
                      <dt>Colours</dt>
                      <dd>{colors.length === 0 ? 'Not recorded' : colors.map((c) => `${c.name}${c.code ? ` (${c.code})` : ''}${c.quantity != null ? ` — ${c.quantity}` : ''}`).join(', ')}</dd>
                    </>
                  );
                })()}
                            {isTrading && (
                  <>
                    <dt>HSN code</dt><dd>{viewing.hsn_code || 'Not recorded'}</dd>
                    <dt>Specification</dt><dd>{viewing.specification || 'Not recorded'}</dd>
                    <dt>Origin country</dt><dd>{viewing.origin_country || 'Not recorded'}</dd>
                    <dt>Preferred supplier</dt><dd>{viewing.supplier_name || 'Not recorded'}</dd>
                    <dt>Currency</dt><dd>{viewing.currency || 'INR'}</dd>
                  </>
                )}
                <dt>Unit / Pack size</dt><dd>{meta.unit}{meta.packSize ? ` · ${meta.packSize}` : ''}</dd>
             <dt>Selling price</dt><dd>{formatMoney(Number(viewing.selling_price))}</dd>
                <dt>Purchase price</dt><dd>{viewing.cost_price == null ? 'Not recorded' : formatMoney(Number(viewing.cost_price))}</dd>
                {activeIndustry === 'fmcg' && (() => {
                  const cost = viewing.cost_price == null ? null : Number(viewing.cost_price);
                  const sell = Number(viewing.selling_price);
                  if (cost == null || !Number.isFinite(cost) || !(sell > 0)) return <><dt>Profit / unit</dt><dd>Not recorded</dd></>;
                  const profit = sell - cost;
                  return <><dt>Profit / unit</dt><dd><strong style={{ color: profit < 0 ? '#b91c1c' : '#15803d' }}>{formatMoney(profit)}</strong> ({((profit / sell) * 100).toFixed(1)}% margin)</dd></>;
                })()}
                {!isTrading && <><dt>MRP</dt><dd>{meta.mrp ? formatMoney(Number(meta.mrp)) : 'Not recorded'}</dd></>}
                <dt>{isTrading ? 'Tax' : 'Discount / Tax'}</dt><dd>{isTrading ? `${viewing.tax_percent || 0}%` : `${meta.discountPercent || 0}% / ${viewing.tax_percent || 0}%`}</dd>
                <dt>Price incl. GST</dt><dd>{formatMoney(Number(viewing.selling_price) + (Number(viewing.selling_price) * Number(viewing.tax_percent || 0)) / 100)}</dd>
                <dt>Current stock</dt>
                <dd>
                  {viewing.stock_quantity ?? '—'}{meta.minStockLevel ? ` (min ${meta.minStockLevel})` : ''}
                  {stockState === 'low' && <span className="status-badge status-quoted" style={{ marginLeft: '.5rem' }}>Low stock</span>}
                  {stockState === 'out' && <span className="status-badge status-cancelled" style={{ marginLeft: '.5rem' }}>Out of stock</span>}
                </dd>
                {tracksBatch(meta) && (
                  <>
                    <dt>Batch number</dt><dd>{meta.batchNumber || 'Not recorded'}</dd>
                    <dt>Manufacturing date</dt><dd>{meta.mfgDate || 'Not recorded'}</dd>
                    <dt>Expiry date</dt><dd>{meta.expiryDate || 'Not recorded'}{expiry && <span className={`status-badge ${expiry.className}`} style={{ marginLeft: '.5rem' }}>{expiry.label}</span>}</dd>
                  </>
                )}
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