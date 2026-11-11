// FILE: admin/src/components/TextileAutomationPage.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// Textile Automation Center: what needs doing today, with one-click actions.
//   - Needs-attention strip + KPI cards grouped by Inventory / Purchasing / Returns & refunds
//   - Goods to receive: open purchase orders -> Receive goods (opens the GRN pre-filled)
//   - Waiting for QC: new GRN rolls in Quarantine -> Pass / Fail right here (uses the normal inspection save, so the roll updates itself)
//   - Reorder: products below minimum stock (after metres already on order) -> Draft purchase orders per supplier
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';

type Row = Record<string, any>;
type Tone = 'red' | 'amber' | 'green' | 'neutral';
const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const go = (module: string) => { window.location.hash = `#industry:textile:${module}`; };
const m = (v: number) => `${Math.round(Number(v || 0) * 100) / 100} m`;
const today = () => new Date().toISOString().slice(0, 10);
const money = (v: unknown) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v ?? 0));

const MUTED = 'var(--text-muted, #6b6b6b)';
const BORDER = 'var(--border, #e5e2dc)';
const TONE: Record<Tone, { fg: string; bg: string; bar: string }> = {
  red: { fg: '#b3261e', bg: 'rgba(179,38,30,.09)', bar: '#b3261e' },
  amber: { fg: '#b26a00', bg: 'rgba(178,106,0,.10)', bar: '#d9890b' },
  green: { fg: '#1f6f4a', bg: 'rgba(31,111,74,.10)', bar: '#1f6f4a' },
  neutral: { fg: '#3b3b3b', bg: 'rgba(0,0,0,.05)', bar: '#c9c5bb' },
};

const card: React.CSSProperties = { background: 'var(--surface, #fff)', border: `1px solid ${BORDER}`, borderRadius: 14, padding: 0, marginTop: 18, overflow: 'hidden' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', padding: '10px 14px', color: MUTED, background: 'rgba(0,0,0,.025)', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '11px 14px', fontSize: 14, borderBottom: '1px solid var(--border, #f0eee9)', verticalAlign: 'middle' };
const btn: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: `1px solid var(--border, #d6d2c9)`, background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 500 };
const btnMain: React.CSSProperties = { ...btn, background: 'var(--accent, #1f6f4a)', borderColor: 'var(--accent, #1f6f4a)', color: '#fff', fontWeight: 600 };
const btnBad: React.CSSProperties = { ...btn, borderColor: '#b3261e', color: '#b3261e' };
const input: React.CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border, #d6d2c9)', fontSize: 13, background: 'var(--surface, #fff)' };

const CSS = `
.ac-stat{transition:box-shadow .15s ease,transform .15s ease,border-color .15s ease}
.ac-click{cursor:pointer}
.ac-click:hover{box-shadow:0 6px 18px rgba(0,0,0,.08);transform:translateY(-1px);border-color:#cfcabd}
.ac-click:focus-visible{outline:2px solid var(--accent,#1f6f4a);outline-offset:2px}
.ac-tbl tbody tr:hover{background:rgba(0,0,0,.02)}
.ac-tbl tbody tr:last-child td{border-bottom:none}
@keyframes ac-pulse{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}
.ac-loading{animation:ac-pulse 1.2s ease-in-out infinite}
`;

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: t.fg, background: t.bg, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Stat({ label, value, sub, tone = 'neutral', onClick, loading }: { label: string; value: string | number; sub?: string; tone?: Tone; onClick?: () => void; loading?: boolean }) {
  const t = TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ac-stat${onClick ? ' ac-click' : ''}`}
      style={{ position: 'relative', textAlign: 'left', font: 'inherit', color: 'inherit', background: 'var(--surface, #fff)', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 16px 14px 20px', minWidth: 0, cursor: onClick ? 'pointer' : 'default', overflow: 'hidden' }}
    >
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: t.bar }} />
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.6, color: MUTED, textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{label}</span>{onClick && <span aria-hidden style={{ color: '#aaa' }}>→</span>}
      </div>
      <div className={loading ? 'ac-loading' : undefined} style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.25, marginTop: 4, color: tone === 'neutral' ? 'inherit' : t.fg }}>{loading ? '—' : value}</div>
      <div style={{ fontSize: 12, color: MUTED, minHeight: 16 }}>{sub ?? ''}</div>
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: MUTED }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: BORDER }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>{children}</div>
    </div>
  );
}

function Section({ title, subtitle, count, tone = 'neutral', children }: { title: string; subtitle: string; count?: number; tone?: Tone; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ padding: '16px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: MUTED, maxWidth: 760 }}>{subtitle}</p>
        </div>
        {count !== undefined && <Pill tone={count > 0 ? tone : 'green'}>{count > 0 ? `${count} pending` : 'All clear'}</Pill>}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '26px 18px', display: 'flex', alignItems: 'center', gap: 12, color: MUTED }}>
      <span aria-hidden style={{ width: 28, height: 28, borderRadius: 999, background: TONE.green.bg, color: TONE.green.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>✓</span>
      <span style={{ fontSize: 14 }}>{text}</span>
    </div>
  );
}

export function TextileAutomationPage() {
  const { activeIndustryTypeId: it } = useIndustryScope();
  const [summary, setSummary] = useState<Row | null>(null);
  const [qc, setQc] = useState<Row[]>([]);
  const [reorder, setReorder] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [pos, setPos] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Record<string, { on: boolean; qty: string; supplier: string }>>({});
  const [grade, setGrade] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [updated, setUpdated] = useState('');

  const load = useCallback(async () => {
    if (!it) return;
    const q = `industryTypeId=${encodeURIComponent(it)}`;
    try {
      const [s, c, r, sp, po] = await Promise.all([
        api<{ data: Row }>(`/textile/automation/summary?${q}`),
        api<{ data: Row[] }>(`/textile/qc-queue?${q}`),
        api<{ data: Row[] }>(`/textile/reorder-suggestions?${q}`),
        api<{ data: Row[] }>(`/textile/suppliers?${q}`),
        api<{ data: Row[] }>(`/textile/purchase-orders?${q}`),
      ]);
      setPos((po.data ?? []).filter((x) => x.status === 'Ordered' || x.status === 'Partially Received'));
      setSummary(s.data); setQc(c.data ?? []); setReorder(r.data ?? []); setSuppliers((sp.data ?? []).filter((x) => x.status === 'active'));
      setPicked((prev) => {
        const next: Record<string, { on: boolean; qty: string; supplier: string }> = {};
        for (const x of r.data ?? []) {
          const old = prev[x.product_code];
          next[x.product_code] = old ?? { on: !!x.supplier_id, qty: String(x.suggested_quantity), supplier: x.supplier_id ?? '' };
        }
        return next;
      });
      setUpdated(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
      setErr('');
    } catch (e) { setErr(msgOf(e)); }
  }, [it]);
  useEffect(() => { void load(); }, [load]);

  async function inspect(roll: Row, result: 'Pass' | 'Fail') {
    setBusy(roll.roll_number); setErr(''); setMsg('');
    try {
      await api('/textile/quality-inspections', {
        method: 'POST',
        body: JSON.stringify({
          inspection_code: `QC-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase().slice(-6)}`,
          roll_number: roll.roll_number, inspection_date: today(), status: result,
          grade: result === 'Pass' ? (grade[roll.roll_number] || 'A') : undefined, industry_type_id: it,
        }),
      });
      setMsg(`${roll.roll_number}: ${result}${result === 'Pass' ? ' - roll is now In stock' : ' - roll marked Damaged'}.`);
      await load();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
  }

  async function createPos() {
    const items = reorder.filter((r) => picked[r.product_code]?.on).map((r) => ({ product_code: r.product_code, quantity: Number(picked[r.product_code].qty), supplier_id: picked[r.product_code].supplier }));
    if (!items.length) { setErr('Tick at least one product.'); return; }
    setBusy('po'); setErr(''); setMsg('');
    try {
      const res = await api<{ data: Row[] }>('/textile/reorder-suggestions/create-po', { method: 'POST', body: JSON.stringify({ industryTypeId: it, items }) });
      setMsg(`Created ${res.data.length} draft purchase order${res.data.length === 1 ? '' : 's'}: ${res.data.map((p) => p.po_number).join(', ')}. Open Purchase Orders to review and place them.`);
      await load();
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(''); }
  }

  const s = summary ?? {};
  const loading = summary === null && !err;
  const selectedCount = reorder.filter((r) => picked[r.product_code]?.on).length;

  const attention: Array<{ label: string; n: number; tone: Tone; to?: string }> = [
    { label: 'rolls waiting for QC', n: Number(s.qc_waiting ?? 0), tone: 'amber' },
    { label: 'products below minimum stock', n: Number(s.reorder_count ?? 0), tone: 'red' },
    { label: 'overdue purchase orders', n: Number(s.overdue_pos ?? 0), tone: 'red', to: 'purchase-orders' },
    { label: 'overdue samples', n: Number(s.samples_overdue ?? 0), tone: 'red', to: 'textile-sample' },
    { label: 'returns without a credit note', n: Number(s.credit_notes_pending ?? 0), tone: 'amber', to: 'credit-notes' },
    { label: 'rolls to send back', n: Number(s.rolls_to_send_back ?? 0), tone: 'amber', to: 'returns-refunds' },
    { label: 'customer refunds due', n: Number(s.customer_refunds_due ?? 0), tone: 'red', to: 'returns-refunds' },
  ].filter((x) => x.n > 0);

  return (
    <section className="page-panel master-page">
      <style>{CSS}</style>

      <div className="page-panel-heading">
        <div>
          <p className="eyebrow">TEXTILE · AUTOMATION CENTER</p>
          <h2>Automation center</h2>
          <p>What needs your attention today, with one-click actions.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {updated && <span style={{ fontSize: 12, color: MUTED }}>Updated {updated}</span>}
          <button type="button" style={btn} onClick={() => void load()}>↻ Refresh</button>
        </div>
      </div>

      {err && <p className="error-message">{err}</p>}
      {msg && <p className="success-message">{msg}</p>}

      {!loading && (
        attention.length === 0 ? (
          <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: TONE.green.bg, color: TONE.green.fg, fontSize: 14, fontWeight: 600 }}>✓ All clear. Nothing needs your attention right now.</div>
        ) : (
          <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: 'rgba(178,106,0,.08)', border: '1px solid rgba(178,106,0,.25)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8a5200', marginBottom: 8 }}>Needs your attention</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {attention.map((a) => (
                <button key={a.label} type="button" onClick={a.to ? () => go(a.to as string) : undefined} style={{ font: 'inherit', fontSize: 13, padding: '4px 12px', borderRadius: 999, border: 'none', background: TONE[a.tone].bg, color: TONE[a.tone].fg, fontWeight: 600, cursor: a.to ? 'pointer' : 'default' }}>
                  {a.n} {a.label}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      <Group title="Inventory">
        <Stat loading={loading} label="Fabric in stock" value={m(s.metres_in_stock)} sub={`${s.rolls_in_stock ?? 0} rolls`} onClick={() => go('fabric-roll')} />
        <Stat loading={loading} label="Waiting for QC" value={s.qc_waiting ?? 0} tone={s.qc_waiting ? 'amber' : 'green'} sub="new rolls not yet inspected" />
        <Stat loading={loading} label="Below minimum stock" value={s.reorder_count ?? 0} tone={s.reorder_count ? 'red' : 'green'} sub="after metres already on order" />
        <Stat loading={loading} label="Damaged rolls" value={s.damaged_rolls ?? 0} tone={s.damaged_rolls ? 'amber' : 'green'} sub="marked damaged after QC" onClick={() => go('fabric-roll')} />
      </Group>

      <Group title="Purchasing & payables">
        <Stat loading={loading} label="Open purchase orders" value={s.open_pos ?? 0} tone={s.overdue_pos ? 'red' : 'neutral'} sub={`${s.overdue_pos ?? 0} overdue · ${s.draft_pos ?? 0} draft`} onClick={() => go('purchase-orders')} />
        <Stat loading={loading} label="Samples awaiting reply" value={s.samples_pending ?? 0} tone={s.samples_overdue ? 'red' : 'neutral'} sub={`${s.samples_overdue ?? 0} overdue · ${s.samples_approved ?? 0} approved`} onClick={() => go('textile-sample')} />
        <Stat loading={loading} label="You owe suppliers" value={money(s.supplier_outstanding)} tone={s.supplier_overdue ? 'red' : 'neutral'} sub={`${money(s.supplier_overdue)} overdue`} onClick={() => go('supplier-payments')} />
      </Group>

      <Group title="Returns & refunds">
        <Stat loading={loading} label="Credit notes to issue" value={s.credit_notes_pending ?? 0} tone={s.credit_notes_pending ? 'amber' : 'green'} sub="returns without a GST credit note" onClick={() => go('credit-notes')} />
        <Stat loading={loading} label="Rolls to send back" value={s.rolls_to_send_back ?? 0} tone={s.rolls_to_send_back ? 'amber' : 'green'} sub={`${m(s.metres_to_send_back)} damaged / rejected`} onClick={() => go('returns-refunds')} />
        <Stat loading={loading} label="Refunds to customers" value={money(s.customer_refunds_amount)} tone={s.customer_refunds_due ? 'red' : 'green'} sub={`${s.customer_refunds_due ?? 0} orders overpaid after returns`} onClick={() => go('returns-refunds')} />
        <Stat loading={loading} label="Mills owe you" value={money(s.supplier_credit)} tone={s.supplier_credit ? 'amber' : 'green'} sub="refund to collect after debit notes" onClick={() => go('returns-refunds')} />
      </Group>

      <Section title="Goods to receive" count={pos.length} tone="amber" subtitle="Orders placed with suppliers that are still waiting for fabric. Receive goods opens the Goods Receipt with the order and its pending metres already filled in.">
        {pos.length === 0 ? <Empty text="No orders waiting for goods." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ac-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Purchase order</th><th style={th}>Supplier</th><th style={th}>Expected</th><th style={th}>Ordered</th><th style={th}>Pending</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {pos.map((p) => {
                  const lines = (p.lines ?? []) as Row[];
                  const ordered = lines.reduce((t, l) => t + Number(l.quantity || 0), 0);
                  const pending = lines.reduce((t, l) => t + Math.max(0, Number(l.quantity || 0) - Number(l.received_quantity || 0)), 0);
                  const late = !!p.expected_date && String(p.expected_date) < today();
                  return (
                    <tr key={p.id}>
                      <td style={td}><strong>{p.po_number}</strong></td>
                      <td style={td}>{p.textile_suppliers?.supplier_name ?? '-'}</td>
                      <td style={td}>{p.expected_date ?? '-'}</td>
                      <td style={td}>{m(ordered)}</td>
                      <td style={td}><strong>{m(pending)}</strong></td>
                      <td style={td}>{late ? <Pill tone="red">Overdue</Pill> : <Pill tone={p.status === 'Partially Received' ? 'amber' : 'neutral'}>{p.status}</Pill>}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button type="button" style={btnMain} onClick={() => { sessionStorage.setItem('textile.grn.prefillPo', String(p.id)); go('goods-receipt'); }}>Receive goods</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Waiting for quality check" count={qc.length} tone="amber" subtitle="Pass puts the roll In stock with the grade you pick. Fail marks it Damaged. Only passed rolls can be cut or allocated to orders.">
        {qc.length === 0 ? <Empty text="No rolls waiting for inspection." /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ac-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Roll</th><th style={th}>Product</th><th style={th}>Colour</th><th style={th}>Length</th><th style={th}>Supplier</th><th style={th}>Waiting</th><th style={th}>Grade</th><th style={th} /></tr></thead>
              <tbody>
                {qc.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><strong>{r.roll_number}</strong></td>
                    <td style={td}>{r.product_code}</td>
                    <td style={td}>{r.colour || '-'}</td>
                    <td style={td}>{m(r.length_meters)}</td>
                    <td style={td}>{r.supplier_name || '-'}</td>
                    <td style={td}><Pill tone={Number(r.days_waiting) > 3 ? 'red' : 'neutral'}>{r.days_waiting} d</Pill></td>
                    <td style={td}>
                      <select style={input} value={grade[r.roll_number] ?? 'A'} onChange={(e) => setGrade((g) => ({ ...g, [r.roll_number]: e.target.value }))}>
                        <option>A</option><option>B</option><option>C</option>
                      </select>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" style={btnMain} disabled={busy === r.roll_number} onClick={() => void inspect(r, 'Pass')}>Pass</button>{' '}
                      <button type="button" style={btnBad} disabled={busy === r.roll_number} onClick={() => void inspect(r, 'Fail')}>Fail</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Reorder suggestions" count={reorder.length} tone="red" subtitle="Products whose stock plus metres already on order is below the product's minimum stock level. Supplier is the one used on the last purchase order. Set the minimum stock level on each product in Products.">
        {reorder.length === 0 ? <Empty text="Nothing to reorder. All products are above their minimum stock." /> : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="ac-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th} /><th style={th}>Product</th><th style={th}>Stock</th><th style={th}>Minimum</th><th style={th}>On order</th><th style={th}>Order (m)</th><th style={th}>Supplier / mill</th></tr></thead>
                <tbody>
                  {reorder.map((r) => {
                    const p = picked[r.product_code] ?? { on: false, qty: String(r.suggested_quantity), supplier: r.supplier_id ?? '' };
                    const set = (patch: Partial<typeof p>) => setPicked((x) => ({ ...x, [r.product_code]: { ...p, ...patch } }));
                    return (
                      <tr key={r.product_code}>
                        <td style={td}><input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} /></td>
                        <td style={td}><strong>{r.product_name}</strong><div style={{ fontSize: 12, color: MUTED }}>{r.product_code}</div></td>
                        <td style={td}>{m(r.stock)}</td>
                        <td style={td}>{m(r.min_stock_level)}</td>
                        <td style={td}>{m(r.on_order)}</td>
                        <td style={td}><input type="number" min={1} value={p.qty} onChange={(e) => set({ qty: e.target.value })} style={{ ...input, width: 90 }} /></td>
                        <td style={td}>
                          <select style={input} value={p.supplier} onChange={(e) => set({ supplier: e.target.value })}>
                            <option value="">Pick supplier</option>
                            {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.supplier_name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 18px', borderTop: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: MUTED }}>{selectedCount} of {reorder.length} selected</span>
              <button type="button" style={btnMain} disabled={busy === 'po' || selectedCount === 0} onClick={() => void createPos()}>{busy === 'po' ? 'Creating…' : `Create draft purchase orders${selectedCount ? ` (${selectedCount})` : ''}`}</button>
            </div>
          </>
        )}
      </Section>
    </section>
  );
}