// FILE: admin/src/components/TradeDocumentInsights.tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import type { TextileRecord } from './TextileMasterPage';

type ShipmentRow = { shipment_number?: string; status?: string };

function daysUntil(dateStr: unknown): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const days = (new Date(dateStr).getTime() - Date.now()) / 86400000;
  return Number.isFinite(days) ? Math.ceil(days) : null;
}

export function TradeDocumentInsights({ rows }: { rows: TextileRecord[] }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [shipments, setShipments] = useState<ShipmentRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
    api<{ data: ShipmentRow[] }>(`/trading/shipments${query}`)
      .then((res) => { if (!cancelled) setShipments(res.data ?? []); })
      .catch(() => { if (!cancelled) setShipments([]); });
    return () => { cancelled = true; };
  }, [activeIndustryTypeId]);

  const byType = new Map<string, number>();
  for (const r of rows) {
    const t = String(r.document_type ?? 'Other');
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }

  const awaitingVerification = rows.filter((r) => r.verification_status === 'Pending Verification');
  const recentlyGenerated = [...rows]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, 5);
  const expiringSoon = rows.filter((r) => {
    const d = daysUntil(r.expiry_date);
    return d != null && d >= 0 && d <= 30;
  });

  const activeShipments = (shipments ?? []).filter((s) => !['Delivered', 'Cancelled'].includes(String(s.status)));
  const linkedActiveShipments = activeShipments.filter((s) => rows.some((d) => d.shipment_number === s.shipment_number));

  const REQUIRED = ['Commercial Invoice', 'Packing List', 'Delivery Note', 'Bill of Lading', 'Certificate of Origin'];
  const shipmentsMissingDocs = activeShipments.filter((s) => {
    const docsForShipment = rows.filter((d) => d.shipment_number === s.shipment_number).map((d) => d.document_type);
    return REQUIRED.some((t) => !docsForShipment.includes(t));
  });

  const panelStyle: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 10, padding: '0.9rem 1rem' };
  const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.9rem', margin: '0 0 1.25rem' };

  return (
    <div style={gridStyle}>
      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Documents by type</p>
        {[...byType.entries()].length === 0 && <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>No documents yet.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem' }}>
          {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <li key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.15rem 0' }}>
              <span>{type}</span><strong>{count}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Awaiting verification ({awaitingVerification.length})</p>
        {awaitingVerification.length === 0 && <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>Nothing pending.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem' }}>
          {awaitingVerification.slice(0, 5).map((d) => (
            <li key={String(d.id)} style={{ padding: '0.15rem 0' }}>{String(d.document_number ?? d.document_id)}</li>
          ))}
        </ul>
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Linked to active shipments</p>
        <p style={{ margin: 0, fontSize: '1.1rem', fontFamily: 'var(--font-mono)' }}>
          {shipments === null ? '—' : `${linkedActiveShipments.length} / ${activeShipments.length}`}
        </p>
        <p style={{ margin: '0.2rem 0 0', fontSize: '.78rem', opacity: 0.65 }}>active shipments with at least one document</p>
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Recently generated</p>
        {recentlyGenerated.length === 0 && <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>No documents yet.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem' }}>
          {recentlyGenerated.map((d) => (
            <li key={String(d.id)} style={{ padding: '0.15rem 0' }}>{String(d.document_number ?? d.document_id)} — {String(d.document_type ?? '—')}</li>
          ))}
        </ul>
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Expiring soon ({expiringSoon.length})</p>
        {expiringSoon.length === 0 && <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>None in the next 30 days.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem' }}>
          {expiringSoon.slice(0, 5).map((d) => (
            <li key={String(d.id)} style={{ padding: '0.15rem 0' }}>{String(d.document_number ?? d.document_id)} — {daysUntil(d.expiry_date)}d</li>
          ))}
        </ul>
      </div>

      <div style={panelStyle}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 700, fontSize: '.78rem' }}>Missing required documents</p>
        {shipments === null ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>Checking shipments…</p>
        ) : shipmentsMissingDocs.length === 0 ? (
          <p style={{ margin: 0, fontSize: '.82rem', opacity: 0.65 }}>All active shipments are covered.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '.82rem' }}>
            {shipmentsMissingDocs.slice(0, 5).map((s) => (
              <li key={s.shipment_number} style={{ padding: '0.15rem 0' }}>{s.shipment_number}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}