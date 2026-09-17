import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { buildDraftFromQuotation } from '../lib/tradeDocumentHandoff';

const QUOTATION_DOC_TYPES = ['Proforma Invoice', 'Commercial Invoice', 'Other'];
import { QuotationPipelineStepper } from './QuotationPipelineStepper';
import './MasterDataPages.css';

type QuotationItem = {
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  subtotal: number;
  products?: { product_code?: string; product_name?: string } | null;
};
type Quotation = {
  id: string;
  quotation_number: string;
  status: 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  valid_until?: string | null;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  clients?: { client_code?: string; client_name?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  quotation_items?: QuotationItem[];
};

type OpenRequirementItem = { product_id?: string | null; quantity: number; products?: { product_name?: string; product_code?: string } | null };
type OpenRequirement = {
  id: string;
  title: string;
  representative_id: string;
  clients?: { client_name?: string; client_code?: string } | null;
  sales_representatives?: { employee_code?: string; user_profiles?: { display_name?: string | null } | null } | null;
  requirement_items?: OpenRequirementItem[];
};
type QuoteLine = { productId: string; productName: string; quantity: string; discountPercent: string };

const PENDING_QUOTATION_REQUIREMENT_KEY = 'fs-pending-quotation-requirement';

const currency = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function QuotationsPage() {
  const { clientMatchesActiveIndustry, activeIndustry } = useIndustryScope();
  const [items, setItems] = useState<Quotation[]>([]);
  const [selected, setSelected] = useState<Quotation | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [repFilter, setRepFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [requirementOptions, setRequirementOptions] = useState<OpenRequirement[]>([]);
  const [requirementId, setRequirementId] = useState('');

  const [requirementSearch, setRequirementSearch] = useState('');
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [skippedItemCount, setSkippedItemCount] = useState(0);
   const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');

  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);
  const [convertMessageIsError, setConvertMessageIsError] = useState(false);

  async function convertToOrder(quotation: Quotation) {
    setConvertingId(quotation.id);
    setConvertMessage(null);
    try {
 await api(`/quotations/${quotation.id}/convert`, { method: 'POST', body: JSON.stringify({}) });
      setConvertMessage(`${quotation.quotation_number} converted to a sales order. Find it on the Sales orders page.`);
      setConvertMessageIsError(false);
      setSelected(null);
      await load();
    } catch (caught) {
      setConvertMessage(caught instanceof Error ? caught.message : 'Unable to convert this quotation to an order.');
      setConvertMessageIsError(true);
    } finally {
      setConvertingId(null);
    }
  }
 async function openCreate(preselectRequirementId?: string) {
    setRequirementId('');
    setRequirementSearch('');
    setLines([]);
    setSkippedItemCount(0);
    setValidUntil('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
    setOptionsLoading(true);
    try {
      const res = await api<{ data: OpenRequirement[] }>('/requirements?status=open');
      const scoped = (res.data ?? []).filter((r) => clientMatchesActiveIndustry(r.clients?.client_code));
      setRequirementOptions(scoped);
      if (preselectRequirementId && scoped.some((r) => r.id === preselectRequirementId)) {
        selectRequirement(preselectRequirementId);
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to load open requirements.');
    } finally {
      setOptionsLoading(false);
    }
  }

  // Picks up the "Create Quotation →" handoff from the Requirements page —
  // the requirement is already known, so we jump straight to it instead of
  // making the rep search for it again in the dropdown.
  useEffect(() => {
    const pendingRequirementId = sessionStorage.getItem(PENDING_QUOTATION_REQUIREMENT_KEY);
    if (!pendingRequirementId) return;
    sessionStorage.removeItem(PENDING_QUOTATION_REQUIREMENT_KEY);
    void openCreate(pendingRequirementId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The client accepting (or rejecting) a quotation is a genuine real-world
  // event only a human can report — but the moment "accepted" is recorded,
  // conversion to a Sales Order happens immediately, automatically. No
  // separate "Convert to Order" click.
  async function markStatus(quotation: Quotation, nextStatus: 'sent' | 'accepted' | 'rejected') {
    setStatusUpdatingId(quotation.id);
    setConvertMessage(null);
    try {
      await api(`/quotations/${quotation.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      if (nextStatus === 'accepted') {
        await api(`/quotations/${quotation.id}/convert`, { method: 'POST', body: JSON.stringify({}) });
        setConvertMessage(`${quotation.quotation_number} accepted — sales order created automatically. Find it on the Sales orders page.`);
      }
      setConvertMessageIsError(false);
      setSelected(null);
      await load();
    } catch (caught) {
      setConvertMessage(caught instanceof Error ? caught.message : 'Unable to update this quotation.');
      setConvertMessageIsError(true);
    } finally {
      setStatusUpdatingId(null);
    }
  }

  function closeModal(force = false) {
    if (saving && !force) return;
    setModalOpen(false);
  }

  function selectRequirement(id: string) {
    setRequirementId(id);
    setFormError(null);
    const requirement = requirementOptions.find((item) => item.id === id);
    const items = requirement?.requirement_items ?? [];
    const priceable = items.filter((item) => item.product_id);
    setSkippedItemCount(items.length - priceable.length);
    setLines(
      priceable.map((item) => ({
        productId: item.product_id as string,
        productName: item.products?.product_name ?? item.products?.product_code ?? 'Product',
        quantity: String(item.quantity),
        discountPercent: '0',
      })),
    );
  }

  function updateLine(index: number, patch: Partial<QuoteLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submitQuotation(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const requirement = requirementOptions.find((item) => item.id === requirementId);
    if (!requirement) return setFormError('Select a requirement.');
    if (!lines.length) return setFormError('This requirement has no items linked to a product to quote. Add product-linked items to the requirement first.');
    for (const line of lines) {
      if (!line.quantity || Number(line.quantity) <= 0) return setFormError('Each line needs a quantity greater than zero.');
    }

    setSaving(true);
    try {
      await api(`/requirements/${requirementId}/quotations`, {
        method: 'POST',
        body: JSON.stringify({
          representativeId: requirement.representative_id,
          items: lines.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            discountPercent: Number(line.discountPercent || 0),
          })),
          validUntil: validUntil || null,
          notes: notes.trim() || null,
        }),
      });
      closeModal(true);
      await load();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'Unable to create quotation.');
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems((await api<{ data: Quotation[] }>('/quotations')).data ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load quotations.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const scopedItems = useMemo(
    () => items.filter((quote) => clientMatchesActiveIndustry(quote.clients?.client_code)),
    [items, clientMatchesActiveIndustry],
  );
  const shown = useMemo(
    () =>
      scopedItems.filter((quote) => {
        const repLabel = quote.sales_representatives?.user_profiles?.display_name ?? quote.sales_representatives?.employee_code ?? '';
        const text = `${quote.quotation_number} ${quote.clients?.client_name ?? ''} ${repLabel}`.toLowerCase();
        const created = quote.created_at?.slice(0, 10);
        return (
          (!search || text.includes(search.toLowerCase())) &&
          (!status || quote.status === status) &&
          (!clientFilter || quote.clients?.client_name === clientFilter) &&
          (!repFilter || repLabel === repFilter) &&
          (!dateFrom || (created ?? '') >= dateFrom) &&
          (!dateTo || (created ?? '') <= dateTo)
        );
      }),
    [scopedItems, search, status, clientFilter, repFilter, dateFrom, dateTo],
  );
  const total = useMemo(() => shown.reduce((sum, quote) => sum + Number(quote.total_amount || 0), 0), [shown]);
  const clientOptions = useMemo(() => [...new Set(scopedItems.map((q) => q.clients?.client_name).filter(Boolean))] as string[], [scopedItems]);
  const repOptions = useMemo(() => [...new Set(scopedItems.map((q) => q.sales_representatives?.user_profiles?.display_name ?? q.sales_representatives?.employee_code).filter(Boolean))] as string[], [scopedItems]);
  const totalCount = scopedItems.length;
  const sentCount = scopedItems.filter((q) => q.status === 'sent').length;
  const acceptedCount = scopedItems.filter((q) => q.status === 'accepted').length;
  const rejectedCount = scopedItems.filter((q) => q.status === 'rejected').length;
  const totalQuotedValue = useMemo(() => scopedItems.reduce((sum, q) => sum + Number(q.total_amount || 0), 0), [scopedItems]);
  function clearFilters() {
    setStatus(''); setClientFilter(''); setRepFilter(''); setDateFrom(''); setDateTo('');
  }

  return (
    <section className="page-panel master-page">
      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">SALES PIPELINE</p>
          <h2>Quotations</h2>
          <p>Create, track and manage customer quotations.</p>
        </div>
           <button className="primary-action" type="button" onClick={() => void openCreate()}>
          + Create Manual Quotation
        </button>
      </div>

<div className="kpi-grid quote-kpi-grid">
        <div className="kpi-card" data-tone="ink"><div className="kpi-icon">◧</div><div><span>Total Quotations</span><strong>{totalCount}</strong></div></div>
        <div className="kpi-card" data-tone="blue"><div className="kpi-icon">●</div><div><span>Sent</span><strong>{sentCount}</strong></div></div>
        <div className="kpi-card" data-tone="green"><div className="kpi-icon">✓</div><div><span>Accepted</span><strong>{acceptedCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">⊘</div><div><span>Rejected</span><strong>{rejectedCount}</strong></div></div>
        <div className="kpi-card" data-tone="red"><div className="kpi-icon">₹</div><div><span>Total Quoted Value</span><strong>{currency(totalQuotedValue)}</strong></div></div>
      </div>

      <div className="quotation-workflow-strip">
        <span>Workflow</span>
        <strong>Requirement → Quotation → Order</strong>
      </div>

      <div className="master-toolbar">
        <div className="master-search">
          <input value={search} placeholder="Search quotation or client" onChange={(e) => setSearch(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
            <option value="converted">Converted</option>
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="">All representatives</option>
            {repOptions.map((rep) => <option key={rep} value={rep}>{rep}</option>)}
          </select>
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
            <option value="">All clients</option>
            {clientOptions.map((client) => <option key={client} value={client}>{client}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
          <button type="button" className="link-button" disabled={!status && !clientFilter && !repFilter && !dateFrom && !dateTo} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </div>
      {error && <p className="error-message">{error}</p>}
          {convertMessage && <p className={convertMessageIsError ? 'error-message' : 'success-message'}>{convertMessage}</p>}
      {loading ? (
        <p>Loading quotations…</p>
      ) : (
        <div className="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quotation</th>
                <th>Client</th>
                <th>Representative</th>
                <th>Created</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((quote) => (
                <tr key={quote.id}>
                  <td>
                    <strong>{quote.quotation_number}</strong>
                  </td>
                  <td>
                    {quote.clients?.client_name ?? '—'}
                    <small>{quote.clients?.client_code}</small>
                  </td>
                  <td>{quote.sales_representatives?.user_profiles?.display_name ?? quote.sales_representatives?.employee_code ?? '—'}</td>
                  <td>{dateLabel(quote.created_at)}</td>
                  <td>{currency(quote.total_amount)}</td>
                                             <td>
                    <span className={`status-badge status-${quote.status}`}>{quote.status}</span>
                  </td>
                              <td className="master-actions">
                    <button type="button" className="icon-action" title="View quotation" aria-label="View quotation" onClick={() => setSelected(quote)}>
                      ◉
                    </button>
               {quote.status === 'sent' && (
                      <>
                        <button type="button" className="quiet-button" disabled={statusUpdatingId === quote.id} onClick={() => void markStatus(quote, 'accepted')}>
                          {statusUpdatingId === quote.id ? 'Saving…' : 'Mark Accepted'}
                        </button>
                        <button type="button" className="quiet-button" disabled={statusUpdatingId === quote.id} onClick={() => void markStatus(quote, 'rejected')}>
                          Mark Rejected
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
                         {shown.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-state-icon">◇</div>
                      <p>
                        <strong>No quotations yet</strong>
                        <br />
                        Create a quotation from a customer requirement to start your sales workflow.
                      </p>
                                      <button type="button" className="primary-action" onClick={() => void openCreate()}>
                        + Create Manual Quotation
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="master-modal order-detail" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">QUOTATION DETAILS</p>
                <h3>{selected.quotation_number}</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
                     <QuotationPipelineStepper status={selected.status} />
            <p>
              <strong>{selected.clients?.client_name ?? 'Client'}</strong> · {dateLabel(selected.created_at)}
              {selected.valid_until ? ` · Valid until ${selected.valid_until}` : ''}
            </p>
            <p className="text-faint-inline">Representative: {selected.sales_representatives?.user_profiles?.display_name ?? selected.sales_representatives?.employee_code ?? '—'}</p>
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Unit price</th>
                    <th>Discount</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.quotation_items?.map((line, index) => (
                    <tr key={index}>
                      <td>{line.products?.product_name ?? 'Product'}</td>
                      <td>{line.quantity}</td>
                      <td>{currency(line.unit_price)}</td>
                      <td>
                        {currency(line.discount_amount)} ({line.discount_percent}%)
                      </td>
                      <td>{currency(line.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
                       <div className="order-total">
              Quotation total <strong>{currency(selected.total_amount)}</strong>
            </div>
            {selected.notes && <p>{selected.notes}</p>}
            {activeIndustry === 'trading' && (
              <div className="modal-actions">
                <GenerateDocumentButton
                  label="Generate Trade Document"
                  docTypes={QUOTATION_DOC_TYPES}
                  buildDraft={(documentType) => buildDraftFromQuotation(selected, documentType)}
                />
              </div>
            )}
         {selected.status === 'sent' && (
              <div className="modal-actions">
                <button type="button" className="quiet-button" disabled={statusUpdatingId === selected.id} onClick={() => void markStatus(selected, 'rejected')}>
                  Mark Rejected
                </button>
                <button type="button" className="primary-action" disabled={statusUpdatingId === selected.id} onClick={() => void markStatus(selected, 'accepted')}>
                  {statusUpdatingId === selected.id ? 'Saving…' : 'Mark Accepted — creates the sales order automatically'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => closeModal()}>
          <div className="master-modal" role="dialog" aria-modal="true" aria-labelledby="quotation-modal-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">SALES PIPELINE</p>
                       <h3 id="quotation-modal-title">Create Manual Quotation</h3>
              </div>
              <button type="button" className="icon-action" aria-label="Close" title="Close" onClick={() => closeModal()}>
                ×
              </button>
            </div>
            {optionsLoading ? (
              <p>Loading open requirements…</p>
            ) : (
              <form onSubmit={submitQuotation} className="master-modal-form">
                {formError && (
                  <p className="error-message" style={{ gridColumn: '1 / -1' }}>
                    {formError}
                  </p>
                )}
                              <label style={{ gridColumn: '1 / -1' }}>
                  Requirement
                  <input
                    type="text"
                    placeholder="Search by client, title or representative…"
                    value={requirementSearch}
                    onChange={(e) => setRequirementSearch(e.target.value)}
                    style={{ marginBottom: '0.5rem' }}
                  />
                  <select required value={requirementId} onChange={(e) => selectRequirement(e.target.value)}>
                    <option value="">Select an open requirement</option>
                    {requirementOptions
                      .filter((requirement) => {
                        const repLabel =
                          requirement.sales_representatives?.user_profiles?.display_name ??
                          requirement.sales_representatives?.employee_code ??
                          '';
                        const text = `${requirement.clients?.client_name ?? ''} ${requirement.title} ${repLabel}`.toLowerCase();
                        return !requirementSearch || text.includes(requirementSearch.toLowerCase());
                      })
                      .map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>
                          {requirement.clients?.client_name ?? 'Client'} — {requirement.title} (
                          {requirement.sales_representatives?.user_profiles?.display_name ?? requirement.sales_representatives?.employee_code ?? 'Rep'})
                        </option>
                      ))}
                  </select>
                  {!requirementOptions.length && <small>No open requirements found. Create one from the Requirements page first.</small>}
                </label>

                {requirementId && (
                  <>
                    <p className="eyebrow" style={{ marginTop: '1rem', gridColumn: '1 / -1' }}>
                      ITEMS TO QUOTE
                    </p>
                    {skippedItemCount > 0 && (
                      <p className="error-message" style={{ gridColumn: '1 / -1' }}>
                        {skippedItemCount} free-text item(s) on this requirement have no linked product and can't be priced automatically — they're excluded here.
                      </p>
                    )}
                    {lines.map((line, index) => (
                      <div key={index} className="master-filter-bar" style={{ marginBottom: '0.5rem', gridColumn: '1 / -1' }}>
                        <label>
                          Product
                          <input value={line.productName} disabled />
                        </label>
                        <label>
                          Quantity
                          <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                        </label>
                        <label>
                          Discount %
                          <input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(e) => updateLine(index, { discountPercent: e.target.value })} />
                        </label>
                      </div>
                    ))}
                    <label>
                      Valid until
                      <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                    </label>
                    <label>
                      Notes
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </label>
                  </>
                )}

                <div className="modal-actions">
                  <button type="button" className="quiet-button" onClick={() => closeModal()} disabled={saving}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-action" disabled={saving || !requirementId || !lines.length}>
                    {saving ? 'Saving…' : 'Create quotation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}