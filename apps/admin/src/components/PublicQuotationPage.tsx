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
  if (error) return <main className="public-quotation"><h1>Quotation unavailable</h1><p>{error}</p></main>;
  if (!quote) return <main className="public-quotation"><p>Loading quotation…</p></main>;
  const money = makeMoney(quote.currency_code);
  if (done || quote.status !== 'sent') return <main className="pq-page"><div className="pq-card pq-thanks"><div className="pq-check">✓</div><h1>Thank you</h1><p>{quote.status === 'client_accepted' ? 'Your acceptance has been sent for manager approval.' : 'Your response has been recorded — our team will follow up shortly.'}</p></div></main>;
  const company = quote.organizations?.name ?? 'Sales CRM';
  const calc = (quote.quotation_items ?? []).map(lineCalc);
  const subtotal = changedItems.length > 0 ? calc.reduce((sum, c) => sum + c.subtotal, 0) : Number(quote.total_amount || 0) - Number(quote.tax_amount || 0);
  const tax = changedItems.length > 0 ? calc.reduce((sum, c) => sum + c.tax, 0) : Number(quote.tax_amount || 0);
  const total = subtotal + tax;
  const code = (quote.currency_code || 'INR').toUpperCase();
  return (
    <main className="pq-page">
      <div className="pq-card">
        <header className="pq-head">
          {quote.company_logo_url ? <img src={quote.company_logo_url} alt={`${company} logo`} /> : <span className="pq-brand">{company}</span>}
          <span className="pq-tag">QUOTATION</span>
        </header>
        <section className="pq-body">
          <h1>{quote.quotation_number}</h1>
          <dl className="pq-meta">
            <div><dt>Prepared for</dt><dd>{quote.clients?.client_name ?? 'you'}</dd></div>
            {quote.valid_until && <div><dt>Valid until</dt><dd>{quote.valid_until}</dd></div>}
            <div><dt>Currency</dt><dd>{code}</dd></div>
          </dl>
          <div className="pq-table-wrap">
            <table className="pq-table">
              <thead><tr><th>Item</th><th className="c">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {quote.quotation_items?.map((line, index) => (
                  <tr key={index}>
                    <td>{line.products?.product_name ?? 'Product'}{line.colour && <><br /><small>Colour: {line.colour}{line.products?.unit ? ` · price per ${line.products.unit}` : ''}</small></>}</td>
                    <td className="c">
                      <input className="pq-qty" type="number" min={1} step={1} inputMode="numeric" aria-label={`Quantity for ${line.products?.product_name ?? 'item'}`} value={qty[line.id ?? ''] ?? String(line.quantity)} onChange={(event) => setQty((current) => ({ ...current, [line.id ?? '']: event.target.value }))} onBlur={() => setQty((current) => ({ ...current, [line.id ?? '']: String(lineQty(line)) }))} />
                    </td>
                    <td className="r">{money(line.unit_price)}</td>
                    <td className="r strong">{money(lineCalc(line).subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pq-hint">{changedItems.length > 0 ? 'You changed the quantity. Click “Accept Quotation” to send your updated quantity to us — our team will confirm the final amount.' : 'Need a different quantity? Change it in the Qty column, then accept.'}</p>
          <div className="pq-totals">
            <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
            {tax > 0 && <div><span>Tax (GST)</span><span>{money(tax)}</span></div>}
            <div className="pq-grand"><span>Total</span><span>{money(total)}</span></div>
          </div>
          {rejecting ? (
            <section className="pq-reject">
              <label>Reason for declining (optional)
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Tell us what did not work" />
              </label>
              <div className="pq-actions">
                <button className="pq-btn pq-danger" disabled={saving} onClick={() => void decide('rejected')}>Confirm rejection</button>
                <button className="pq-btn pq-ghost" disabled={saving} onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            </section>
          ) : (
            <div className="pq-actions">
              <button className="pq-btn pq-primary" disabled={saving} onClick={() => void decide('accepted')}>Accept Quotation</button>
              <button className="pq-btn pq-ghost" disabled={saving} onClick={() => setRejecting(true)}>Reject Quotation</button>
            </div>
          )}
        </section>
        <footer className="pq-foot">Thank you for your business — {company}</footer>
      </div>
    </main>
  );
}