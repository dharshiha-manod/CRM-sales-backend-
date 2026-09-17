// FILE: admin/src/components/LinkedRecords.tsx
// Generalised from DealLinkedRecords.tsx, which only worked for Deals and
// only knew about three target modules. Traceability along the Trading
// chain needs to work from every link in it, in both directions:
//
//   Deal <-> Order <-> Shipment <-> Logistics <-> Import/Export
//        <-> Customs <-> Trade Documents,  and  Order/Shipment <-> Claim
//
// so this takes a list of related-record queries instead of hard-coding
// them, and each module's config declares the ones that make sense for it.
// Fetch-and-render shape is unchanged from the original, so it looks and
// behaves like the panels already in the app.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useIndustryScope } from '../industry/useIndustryScope';
import { openRecord, type RecordFocus } from '../lib/recordFocus';

export interface LinkSpec {
  /** Section heading, e.g. 'Customs' */
  title: string;
  /** API resource to search, e.g. '/trading/customs' */
  resource: string;
  /** field on the RELATED record that points back at this one, e.g. 'shipment_number' */
  matchField: string;
  /** value to match — usually this record's own code. Falsy = section skipped. */
  matchValue: string;
  /** module hash route to open, from TRADING_HASH */
  hash: string;
  /** field on the related record holding its own code, e.g. 'customs_reference' */
  codeField: string;
  /** optional secondary field shown after the code, e.g. 'clearance_status' */
  subField?: string;
  /** shown when nothing matches */
  emptyLabel?: string;
}

type Row = Record<string, unknown> & { id: string };

export function LinkedRecords({ links, heading }: { links: LinkSpec[]; heading?: string }) {
  const { activeIndustryTypeId } = useIndustryScope();
  const [results, setResults] = useState<Record<string, Row[]> | null>(null);

  // Only query links that actually have something to match on.
  const active = links.filter((l) => l.matchValue);
  const signature = active.map((l) => `${l.resource}:${l.matchField}:${l.matchValue}`).join('|');

  useEffect(() => {
    if (active.length === 0) {
      setResults({});
      return;
    }
    let cancelled = false;
    const query = activeIndustryTypeId ? `?industryTypeId=${activeIndustryTypeId}` : '';
    Promise.all(
      active.map((l) =>
        api<{ data: Row[] }>(`${l.resource}${query}`)
          .then((res) => (res.data ?? []).filter((r) => String(r[l.matchField] ?? '') === l.matchValue))
          // One failing module shouldn't blank the whole panel.
          .catch(() => [] as Row[]),
      ),
    ).then((sets) => {
      if (cancelled) return;
      const out: Record<string, Row[]> = {};
      active.forEach((l, i) => { out[l.title] = sets[i]; });
      setResults(out);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeIndustryTypeId]);

  if (active.length === 0) return null;

  return (
    <div style={{ margin: '1rem 0', padding: '0.9rem 1rem', border: '1px solid var(--line)', borderRadius: 10 }}>
      <p style={{ margin: '0 0 0.6rem', fontWeight: 700, fontSize: '.8rem', letterSpacing: '.02em' }}>
        {heading ?? 'Linked records'}
      </p>
      {results === null ? (
        <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.7 }}>Checking linked records…</p>
      ) : (
        <div style={{ display: 'grid', gap: '0.9rem' }}>
          {active.map((l) => {
            const rows = results[l.title] ?? [];
            return (
              <div key={l.title}>
                <p style={{ margin: '0 0 0.4rem', fontSize: '.75rem', fontWeight: 600, opacity: 0.75 }}>
                  {l.title} ({rows.length})
                </p>
                {rows.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '.85rem', opacity: 0.65 }}>
                    {l.emptyLabel ?? `No ${l.title.toLowerCase()} linked to this record yet.`}
                  </p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.35rem' }}>
                    {rows.map((r) => {
                      const code = String(r[l.codeField] ?? r.id);
                      const focus: RecordFocus = { resource: l.resource, field: l.codeField, value: code };
                      return (
                        <li key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem' }}>
                          <span>
                            {code}
                            {l.subField && r[l.subField] ? <span style={{ opacity: 0.75 }}> — {String(r[l.subField])}</span> : null}
                          </span>
                          <button type="button" className="quiet-button" onClick={() => openRecord(l.hash, focus)}>
                            Open →
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}