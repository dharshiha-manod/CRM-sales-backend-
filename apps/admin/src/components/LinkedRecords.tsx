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

  const rowsOf = (l: LinkSpec) => (results?.[l.title] ?? []);
  const linked = results ? active.filter((l) => rowsOf(l).length > 0) : [];
  const notLinked = results ? active.filter((l) => rowsOf(l).length === 0) : [];

  return (
    <section className="lr-card">
      <div className="lr-head">
        <h4>{heading ?? 'Linked records'}</h4>
        {results !== null && <span className="lr-count">{linked.length} of {active.length} linked</span>}
      </div>
      {results === null ? (
        <p className="lr-loading">Checking linked records…</p>
      ) : (
        <>
          {linked.map((l) => {
            const rows = rowsOf(l);
            return (
              <div className="lr-group" key={l.title}>
                <p className="lr-group-title">{l.title}<span>{rows.length}</span></p>
                <ul className="lr-list">
                  {rows.map((r) => {
                    const code = String(r[l.codeField] ?? r.id);
                    const sub = l.subField && r[l.subField] ? String(r[l.subField]) : '';
                    const focus: RecordFocus = { resource: l.resource, field: l.codeField, value: code };
                    return (
                      <li className="lr-row" key={r.id}>
                        <div className="lr-row-main">
                          <strong>{code}</strong>
                          {sub && <span className="lr-pill">{sub}</span>}
                        </div>
                        <button type="button" className="quiet-button lr-open" onClick={() => openRecord(l.hash, focus)}>
                          Open →
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {notLinked.length > 0 && (
            <div className="lr-group lr-group-empty">
              <p className="lr-group-title">{linked.length === 0 ? 'Nothing linked yet' : 'Not created yet'}</p>
              <div className="lr-chips">
                {notLinked.map((l) => (
                  <span className="lr-chip" key={l.title} title={l.emptyLabel ?? `No ${l.title.toLowerCase()} linked to this record yet.`}>{l.title}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}