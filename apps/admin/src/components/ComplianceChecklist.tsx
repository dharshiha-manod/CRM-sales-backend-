// FILE: admin/src/components/ComplianceChecklist.tsx
// The ✓ / ⚠ panel the spec describes: for a shipment or deal, show the
// trade documents, customs information and import/export information that
// already exist, plus what's missing or expired — all read from the linked
// records, none of it re-entered.
//
// Shown live rather than from the stored snapshot, because a compliance
// check is only worth anything if it reflects the paperwork as it stands
// now. The stored fields on the record keep what was true at review time.
import { useEffect, useState } from 'react';
import { useIndustryScope } from '../industry/useIndustryScope';
import { buildChain, loadTradingTables } from '../lib/tradingChain';
import { buildComplianceReport, type ComplianceReport, type CheckState } from '../lib/complianceChecks';
import { GenerateDocumentButton } from './GenerateDocumentButton';
import { buildDraftFromShipment } from '../lib/tradeDocumentHandoff';

const str = (v: unknown): string => (v == null ? '' : String(v));

const MARK: Record<CheckState, string> = { pass: '✓', warn: '⚠', fail: '⚠', info: '·' };
const COLOUR: Record<CheckState, string | undefined> = {
  pass: 'var(--green)', warn: 'var(--amber, #b26a00)', fail: 'var(--red)', info: undefined,
};

const boxStyle: React.CSSProperties = { margin: '1rem 0', padding: '0.9rem 1rem', border: '1px solid var(--line)', borderRadius: 10 };

export function ComplianceChecklist({ record }: { record: Record<string, unknown> }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [shipment, setShipment] = useState<Record<string, unknown> | null>(null);
  const [loaded, setLoaded] = useState(false);

  const dealNumber = str(record.deal_number);
  const shipmentNumber = str(record.shipment_number);

  useEffect(() => {
    let cancelled = false;
    if (!dealNumber && !shipmentNumber) { setLoaded(true); return; }
    loadTradingTables(activeIndustryTypeId)
      .then((tables) => {
        if (cancelled) return;
        const chain = buildChain(tables, {
          deal_number: dealNumber || undefined,
          shipment_number: shipmentNumber || undefined,
        });
        setReport(buildComplianceReport(chain));
        setShipment(chain.shipments[0] ?? null);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [dealNumber, shipmentNumber, activeIndustryTypeId]);

  if (!dealNumber && !shipmentNumber) return null;

  return (
    <div style={boxStyle}>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '.8rem', letterSpacing: '.02em' }}>
        Compliance position for {shipmentNumber || dealNumber}
      </p>

      {!loaded ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>Reading linked records…</p>
      ) : !report ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>No linked records found for this reference.</p>
      ) : (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '.35rem', fontSize: '.84rem' }}>
            {report.checks.map((c, i) => (
              <li key={`${c.label}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '.7rem' }}>
                <span>
                  <span style={{ color: COLOUR[c.state], marginRight: 6 }}>{MARK[c.state]}</span>
                  {c.label}
                  <span style={{ opacity: 0.65 }}> — {c.detail}</span>
                </span>
                {c.state === 'fail' && c.detail === 'Missing' && shipment && (
                  <GenerateDocumentButton
                    label="Generate"
                    docTypes={[c.label]}
                    buildDraft={(documentType) => buildDraftFromShipment(shipment, documentType)}
                  />
                )}
              </li>
            ))}
          </ul>

          <p style={{ margin: '.7rem 0 0', fontSize: '.78rem', opacity: 0.7 }}>
            Documents {report.presentDocuments.length}/{report.requiredDocuments.length} · customs {report.customsStatus} ·
            shipment {report.shipmentStatus} · suggested risk {report.suggestedRisk}
          </p>
        </>
      )}
    </div>
  );
}