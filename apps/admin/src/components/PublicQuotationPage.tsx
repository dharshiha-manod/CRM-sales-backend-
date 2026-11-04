import { useEffect, useState } from 'react';
import './PublicQuotationPage.css';

type Line = { tax_amount?: number | null; id?: string; discount_percent?: number | null; quantity: number; unit_price: number; subtotal: number; tax_percent?: number | null; colour?: string | null; products?: { product_name?: string; unit?: string | null } | null };
type Quote = { quotation_number: string; status: string; valid_until?: string | null; total_amount: number; tax_amount?: number | null; currency_code?: string | null; company_logo_url?: string | null; clients?: { client_name?: string } | null; organizations?: { name?: string } | null; quotation_items?: Line[] };
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
const makeMoney = (code?: string | null) => (value: number) => { const c = (code || 'INR').toUpperCase(); return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: c }).format(Number(value)); };

export function PublicQuotationPage({ token }: { token: string }) {
  const [quote, setQuote] = useState<Quote | null>(null); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState(false); const [saving, setSaving] = useState(false); const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState(''); const [qty, setQty] = useState<Record<string, string>>({});
  useEffect(() => { fetch(`${baseUrl}/public/quotations/${encodeURIComponent(token)}`).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Quotation unavailable'); setQuote(body.data); setQty(Object.fromEntries(((body.data as Quote).quotation_items ?? []).map((line) => [line.id ?? '', String(line.quantity)]))); }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Quotation unavailable')); }, [token]);
  const lineQty = (line: Line) => { const n = Math.floor(Number(qty[line.id ?? ''])); return Number.isFinite(n) && n >= 1 ? n : line.quantity; };
  const changedItems = (quote?.quotation_items ?? []).filter((line) => line.id && lineQty(line) !== line.quantity).map((line) => ({ id: line.id as string, quantity: lineQty(line) }));
  const lineCalc = (line: Line) => { const q = lineQty(line); if (q === line.quantity) return { subtotal: Number(line.subtotal), tax: Number(line.tax_amount ?? 0) }; const gross = Number(line.unit_price) * q; const sub = gross - Math.round(gross * Number(line.discount_percent ?? 0)) / 100; return { subtotal: sub, tax: Math.round(sub * Number(line.tax_percent ?? 0)) / 100 }; };
  async function decide(decision: 'accepted' | 'rejected') { setSaving(true); try { const response = await fetch(`${baseUrl}/public/quotations/${encodeURIComponent(token)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, ...(decision === 'rejected' && reason.trim() ? { reason: reason.trim() } : {}), ...(decision === 'accepted' && changedItems.length > 0 ? { items: changedItems } : {}) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? 'Unable to record your response'); setQuote(body.data); setDone(true); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to record your response'); } finally { setSaving(false); } }
  const shell = (children: React.ReactNode) => <main className="pq-page"><div className="pq-card pq-state">{children}</div></main>;
  if (error) return shell(<><div className="pq-icon pq-icon-warn">!</div><h1>Quotation unavailable</h1><p>{error}</p></>);
  if (!quote) return shell(<><div className="pq-spinner" aria-hidden="true" /><p>Loading your quotation…</p></>);
  const money = makeMoney(quote.currency_code);
  if (done || quote.status !== 'sent') {
    const accepted = quote.status === 'client_accepted';
    return shell(<><div className={`pq-icon ${accepted ? 'pq-icon-ok' : 'pq-icon-info'}`}>{accepted ? '✓' : 'i'}</div><h1>{accepted ? 'Thank you — quotation accepted' : 'Response recorded'}</h1><p>{accepted ? 'Your acceptance has been sent to our team for final approval. We will confirm your order shortly.' : 'Your response has been recorded. Our team will follow up with you shortly.'}</p><p className="pq-ref">Reference: {quote.quotation_number}</p></>);
  }
  const company = quote.organizations?.name ?? 'Sales CRM';
  const items = quote.quotation_items ?? [];
  const calc = items.map(lineCalc);
  const subtotal = changedItems.length > 0 ? calc.reduce((sum, c) => sum + c.subtotal, 0) : Number(quote.total_amount || 0) - Number(quote.tax_amount || 0);
  const tax = changedItems.length > 0 ? calc.reduce((sum, c) => sum + c.tax, 0) : Number(quote.tax_amount || 0);
  const total = subtotal + tax;
  const code = (quote.currency_code || 'INR').toUpperCase();
  const daysLeft = quote.valid_until ? Math.ceil((Date.parse(quote.valid_until.slice(0, 10)) - Date.now()) / 86_400_000) : null;
  const validity = daysLeft === null ? null : daysLeft < 0 ? { text: 'Expired', cls: 'pq-chip-bad' } : daysLeft <= 3 ? { text: daysLeft === 0 ? 'Expires today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, cls: 'pq-chip-warn' } : { text: `${daysLeft} days left`, cls: 'pq-chip-ok' };
  const step = (line: Line, delta: number) => setQty((current) => ({ ...current, [line.id ?? '']: String(Math.max(1, lineQty(line) + delta)) }));
  return (
    <main className="pq-page">
      <div className="pq-card">
        <header className="pq-head">
          {quote.company_logo_url ? <img src={quote.company_logo_url} alt={`${company} logo`} /> : <span className="pq-brand">{company}</span>}
          <div className="pq-head-right"><span className="pq-tag">QUOTATION</span><span className="pq-no">{quote.quotation_number}</span></div>
        </header>
        <section className="pq-body">
          <div className="pq-title-row">
            <div><h1>Your quotation from {company}</h1><p className="pq-sub">Please review the items below and accept or decline.</p></div>
            <div className="pq-chips"><span className="pq-chip pq-chip-info">Awaiting your response</span>{validity && <span className={`pq-chip ${validity.cls}`}>{validity.text}</span>}</div>
          </div>
          <div className="pq-info">
            <div className="pq-info-box"><span className="pq-label">Prepared for</span><strong>{quote.clients?.client_name ?? 'You'}</strong></div>
            <div className="pq-info-box"><span className="pq-label">Quotation no.</span><strong>{quote.quotation_number}</strong></div>
            {quote.valid_until && <div className="pq-info-box"><span className="pq-label">Valid until</span><strong>{new Date(quote.valid_until.slice(0, 10)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</strong></div>}
            <div className="pq-info-box"><span className="pq-label">Currency</span><strong>{code}</strong></div>
          </div>
          <div className="pq-table-wrap">
            <table className="pq-table">
              <thead><tr><th className="n">#</th><th>Item</th><th className="c">Qty</th><th className="r">Unit price</th><th className="r">GST</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {items.map((line, index) => (
                  <tr key={line.id ?? index}>
                    <td className="n" data-label="#">{index + 1}</td>
                    <td className="item" data-label="Item"><span className="pq-item-name">{line.products?.product_name ?? 'Product'}</span>{(line.colour || line.products?.unit) && <small>{line.colour ? `Colour: ${line.colour}` : ''}{line.colour && line.products?.unit ? ' · ' : ''}{line.products?.unit ? `Price per ${line.products.unit}` : ''}</small>}</td>
                    <td className="c" data-label="Qty">
                      <div className="pq-stepper">
                        <button type="button" aria-label="Decrease quantity" onClick={() => step(line, -1)} disabled={lineQty(line) <= 1}>−</button>
                        <input className="pq-qty" type="number" min={1} step={1} inputMode="numeric" aria-label={`Quantity for ${line.products?.product_name ?? 'item'}`} value={qty[line.id ?? ''] ?? String(line.quantity)} onChange={(event) => setQty((current) => ({ ...current, [line.id ?? '']: event.target.value }))} onBlur={() => setQty((current) => ({ ...current, [line.id ?? '']: String(lineQty(line)) }))} />
                        <button type="button" aria-label="Increase quantity" onClick={() => step(line, 1)}>+</button>
                      </div>
                    </td>
                    <td className="r" data-label="Unit price">{money(line.unit_price)}</td>
                    <td className="r" data-label="GST">{Number(line.tax_percent ?? 0) > 0 ? `${Number(line.tax_percent)}%` : '—'}</td>
                    <td className="r strong" data-label="Amount">{money(lineCalc(line).subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pq-lower">
            <p className={`pq-hint ${changedItems.length > 0 ? 'pq-hint-on' : ''}`}>{changedItems.length > 0 ? 'You changed a quantity. Click “Accept quotation” to send the updated quantity — our team will confirm the final amount.' : 'Need a different quantity? Use the Qty column, then accept.'}</p>
            <div className="pq-totals">
              <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {tax > 0 && <div><span>Tax (GST)</span><span>{money(tax)}</span></div>}
              <div className="pq-grand"><span>Total</span><span>{money(total)}</span></div>
            </div>
          </div>
          {rejecting ? (
            <section className="pq-reject">
              <label>Reason for declining (optional)
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Tell us what did not work so we can improve our offer" />
              </label>
              <div className="pq-actions">
                <button className="pq-btn pq-danger" disabled={saving} onClick={() => void decide('rejected')}>{saving ? 'Saving…' : 'Confirm rejection'}</button>
                <button className="pq-btn pq-ghost" disabled={saving} onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            </section>
          ) : (
            <>
              <div className="pq-actions">
                <button className="pq-btn pq-primary" disabled={saving || (daysLeft !== null && daysLeft < 0)} onClick={() => void decide('accepted')}>{saving ? 'Saving…' : 'Accept quotation'}</button>
                <button className="pq-btn pq-ghost" disabled={saving} onClick={() => setRejecting(true)}>Decline</button>
                <button className="pq-btn pq-link" type="button" onClick={() => window.print()}>🖨 Print / save as PDF</button>
              </div>
              <p className="pq-note">By accepting, you confirm the items, quantities and prices above. Your acceptance is subject to final approval by {company}.</p>
            </>
          )}
        </section>
        <footer className="pq-foot"><span>Thank you for your business — {company}</span><span>Quotation {quote.quotation_number}</span></footer>
      </div>
    </main>
  );
}