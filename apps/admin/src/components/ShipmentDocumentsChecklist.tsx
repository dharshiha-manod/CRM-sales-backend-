// FILE: admin/src/components/ShipmentDocumentsChecklist.tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { buildDraftFromShipment } from '../lib/tradeDocumentHandoff';

const REQUIRED_SHIPMENT_DOCS = ['Commercial Invoice', 'Packing List', 'Delivery Note', 'Bill of Lading', 'Certificate of Origin'];

type DocRow = { document_type?: string; shipment_number?: string; status?: string };

export function ShipmentDocumentsChecklist({ shipment }: { shipment: Record<string, unknown> }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const shipmentNumber = String(shipment.shipment_number ?? '');

  useEffect(() => {
    let cancelled = false;
    const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
    api<{ data: DocRow[] }>(`/trading/documents${query}`)
      .then((res) => { if (!cancelled) setDocs(res.data ?? []); })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, [activeIndustryTypeId, shipmentNumber]);

  if (!shipmentNumber) return null;
  const present = new Set(
    (docs ?? [])
      .filter((d) => d.shipment_number === shipmentNumber && d.status !== 'Rejected')
      .map((d) => d.document_type),
  );

  return (
    <div style={{ margin: '1rem 0', padding: '0.9rem 1rem', border: '1px solid var(--line)', borderRadius: 10 }}>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '.8rem', letterSpacing: '.02em' }}>
        Required documents for {shipmentNumber}
      </p>
      {docs === null ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>Checking linked documents…</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.4rem' }}>
          {REQUIRED_SHIPMENT_DOCS.map((docType) => {
            const has = present.has(docType);
            return (
              <li key={docType} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                <span>
                  <span style={{ color: has ? 'var(--green)' : 'var(--red)', marginRight: 6 }}>{has ? '✓' : '⚠'}</span>
                  {docType}
                  {!has && <span style={{ opacity: 0.65 }}> — missing</span>}
                </span>
                {!has && (
                  <GenerateDocumentButton
                    label="Generate"
                    docTypes={[docType]}
                    buildDraft={(documentType) => buildDraftFromShipment(shipment, documentType)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}