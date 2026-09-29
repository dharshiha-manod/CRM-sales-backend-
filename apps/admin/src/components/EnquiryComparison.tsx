// Supplier comparison for Purchase Enquiry.
//
// Enquiries for the same product (one per supplier) are grouped and shown side by
// side. The CRM does the arithmetic (net rate per unit after discount and tax) and
// marks the lowest one; a person still types the quoted rates in, because free-form
// supplier emails are not read for prices. "Select this supplier" approves the chosen
// enquiry and rejects the others in the same group.
import { ReactNode, useMemo, useState } from 'react';
import { api } from '../lib/api';

type Row = Record<string, unknown>;

const text = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const productKey = (r: Row): string => text(r.product_name).toLowerCase();

/** Net rate per unit after the supplier's discount and tax — same maths as the list's "Net purchase amount". */
function unitNet(r: Row): number {
  const rate = num(r.requested_rate);
  if (!rate) return 0;
  return rate * (1 - num(r.discount_percent) / 100) * (1 + num(r.tax_percent) / 100);
}

const money = (currency: string, n: number): string =>
  `${currency ? `${currency} ` : '₹'}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

interface Group { key: string; name: string; items: Row[] }

function buildGroups(rows: Row[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const status = text(r.status);
    if (status === 'Closed' || status === 'Converted to Deal') continue; // finished — not part of a live comparison
    const key = productKey(r);
    if (!key) continue;
    const group = map.get(key) ?? { key, name: text(r.product_name), items: [] };
    group.items.push(r);
    map.set(key, group);
  }
  return Array.from(map.values())
    .filter((g) => g.items.length >= 2)
    .map((g) => ({
      ...g,
      // quoted suppliers first, cheapest first; suppliers still to reply go last
      items: [...g.items].sort((a, b) => {
        const ua = unitNet(a); const ub = unitNet(b);
        if (ua && ub) return ua - ub;
        if (ua) return -1;
        if (ub) return 1;
        return text(a.enquiry_number).localeCompare(text(b.enquiry_number));
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const cellStyle = { padding: '10px 12px', borderBottom: '1px solid var(--line, #e2e8f0)', textAlign: 'left' as const, verticalAlign: 'middle' as const, fontSize: 13 };

// Only sideways scrolling: the label column (Quantity, Quoted rate...) stays pinned on the left
// so with many suppliers you never lose track of which row is which. No vertical scroll box.
const stickyHead = { zIndex: 2 };
const stickyLabel = { position: 'sticky' as const, left: 0, zIndex: 1, background: '#fff' };
const stickyCorner = { position: 'sticky' as const, left: 0, zIndex: 3, background: '#f8fafc' };

export function CompareSuppliersBar({ rows, onChanged }: { rows: Row[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const groups = useMemo(() => buildGroups(rows), [rows]);
  if (groups.length === 0 && !open) return null;

  const active = groups.find((g) => g.key === selectedKey) ?? groups[0];
  const items = active?.items ?? [];
  const rated = items.filter((r) => unitNet(r) > 0);
  const warnings: string[] = [];
  if (new Set(rated.map((r) => text(r.currency).toUpperCase())).size > 1) warnings.push('Suppliers quoted in different currencies. Amounts are not converted, so no best price is marked.');
  if (new Set(rated.map((r) => text(r.unit).toLowerCase())).size > 1) warnings.push('Suppliers quoted in different units, so no best price is marked.');
  const best = rated.length >= 2 && warnings.length === 0 ? rated[0] : null;

  const selectSupplier = async (winner: Row) => {
    const others = items.filter((r) => r.id !== winner.id && text(r.status) !== 'Rejected');
    const summary = `Approve ${text(winner.supplier_name)} (${text(winner.enquiry_number)})` +
      (others.length ? ` and mark ${others.length} other enquiry(ies) as Rejected?\n\n${others.map((r) => `${text(r.enquiry_number)} → ${text(r.supplier_name)}`).join('\n')}` : '?');
    if (!window.confirm(summary)) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/trading/purchase-enquiries/${String(winner.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved' }) });
      for (const r of others) {
        await api(`/trading/purchase-enquiries/${String(r.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'Rejected' }) });
      }
      setMessage({ text: `${text(winner.supplier_name)} approved.${others.length ? ` ${others.length} other enquiry(ies) marked Rejected.` : ''}`, error: false });
      onChanged();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Could not update the enquiries.', error: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const lines: Array<{ label: string; strong?: boolean; cell: (r: Row) => ReactNode }> = [
    { label: 'Status', cell: (r) => text(r.status) || 'Draft' },
    { label: 'Quantity', cell: (r) => (text(r.quantity) ? `${text(r.quantity)} ${text(r.unit)}`.trim() : '—') },
    { label: 'Quoted rate', cell: (r) => (num(r.requested_rate) ? money(text(r.currency), num(r.requested_rate)) : 'Waiting for quote') },
    { label: 'Discount (%)', cell: (r) => (text(r.discount_percent) || '—') },
    { label: 'Tax (%)', cell: (r) => (text(r.tax_percent) || '—') },
    { label: 'Net rate per unit', strong: true, cell: (r) => (unitNet(r) > 0 ? money(text(r.currency), unitNet(r)) : '—') },
    { label: 'Net amount', strong: true, cell: (r) => (unitNet(r) > 0 && num(r.quantity) > 0 ? money(text(r.currency), unitNet(r) * num(r.quantity)) : '—') },
    { label: 'Delivery terms', cell: (r) => (text(r.delivery_terms) || '—') },
    { label: 'Payment terms', cell: (r) => (text(r.payment_terms) || '—') },
    { label: 'Delivery location', cell: (r) => (text(r.delivery_location) || '—') },
  ];

  return (
    <>
      {groups.length > 0 && (
        <div style={{ margin: '12px 0', padding: '10px 14px', border: '1px solid var(--line, #e2e8f0)', borderRadius: 10, background: 'var(--paper, #f8fafc)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13 }}>{groups.length} product(s) enquired with several suppliers</span>
          <button type="button" className="primary-action" onClick={() => { setMessage(null); setOpen(true); }}>⚖ Compare suppliers</button>
        </div>
      )}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onMouseDown={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Compare suppliers"
            style={{ background: '#fff', borderRadius: 14, width: 'min(1100px, 96vw)', maxHeight: '90vh', overflow: 'auto', padding: '20px 22px', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>TRADING · PURCHASE ENQUIRY</p>
                <h3 style={{ margin: '4px 0 0' }}>Compare suppliers</h3>
              </div>
              <button className="icon-action" type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)}>×</button>
            </div>

            {!active ? (
              <p style={{ marginTop: 16, fontSize: 14 }}>Nothing to compare yet. Send the same product to two or more suppliers first.</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 10px', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor="compare-product">Product</label>
                  <select id="compare-product" value={active.key} onChange={(e) => setSelectedKey(e.target.value)} style={{ minWidth: 220 }}>
                    {groups.map((g) => <option key={g.key} value={g.key}>{g.name} — {g.items.length} suppliers</option>)}
                  </select>
                </div>

                {warnings.map((w) => <p key={w} style={{ margin: '6px 0', fontSize: 13, color: '#b45309' }}>{w}</p>)}
                {rated.length < 2 && <p style={{ margin: '6px 0', fontSize: 13, color: '#64748b' }}>Enter the quoted rate in at least two enquiries to see the best price.</p>}
                {message && <p style={{ margin: '6px 0', fontSize: 13, color: message.error ? '#b91c1c' : '#15803d' }}>{message.text}</p>}

                <div style={{ overflowX: 'auto', marginTop: 8, border: '1px solid var(--line, #e2e8f0)', borderRadius: 10 }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 170 + items.length * 190 }}>
                    <thead>
                      <tr>
                        <th style={{ ...cellStyle, ...stickyCorner, width: 170, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.03em', color: '#64748b' }}>Supplier</th>
                        {items.map((r) => {
                          const isBest = best?.id === r.id;
                          return (
                            <th key={String(r.id)} style={{ ...cellStyle, ...stickyHead, background: isBest ? '#ecfdf5' : '#f8fafc' }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{text(r.supplier_name) || '—'}</div>
                              <div style={{ fontWeight: 400, fontSize: 12, color: '#64748b', fontFamily: 'var(--font-mono, monospace)' }}>{text(r.enquiry_number)}</div>
                              {isBest && <span style={{ display: 'inline-block', marginTop: 4, padding: '2px 8px', borderRadius: 999, background: '#16a34a', color: '#fff', fontSize: 11, fontWeight: 600 }}>Best price</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.label}>
                          <td style={{ ...cellStyle, ...stickyLabel, color: '#64748b', fontWeight: 600 }}>{line.label}</td>
                          {items.map((r) => (
                            <td key={String(r.id)} style={{ ...cellStyle, fontWeight: line.strong ? 700 : 400, background: best?.id === r.id ? '#ecfdf5' : undefined }}>{line.cell(r)}</td>
                          ))}
                        </tr>
                      ))}
                      <tr>
                        <td style={{ ...cellStyle, ...stickyLabel }} />
                        {items.map((r) => {
                          const approved = text(r.status) === 'Approved';
                          return (
                            <td key={String(r.id)} style={{ ...cellStyle, background: best?.id === r.id ? '#ecfdf5' : undefined }}>
                              {approved ? (
                                <span style={{ color: '#15803d', fontWeight: 600, fontSize: 13 }}>✓ Selected</span>
                              ) : (
                                <button type="button" className="quiet-button" disabled={busy || !unitNet(r)} title={unitNet(r) ? '' : 'Enter this supplier’s quoted rate first'} onClick={() => void selectSupplier(r)}>
                                  Select this supplier
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>Enquiries are grouped by product name. Selecting a supplier sets it to Approved and the others in this comparison to Rejected.</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}