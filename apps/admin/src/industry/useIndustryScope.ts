import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from './IndustryContext';

type IndustryTypeRecord = { id: string; code: string; name: string; status: string };
type ClientScopeRecord = { client_code: string; industry_type_id?: string | null };

/**
 * Central place for "which records belong to the currently active Industry
 * Type" — reused by every Core Module so switching Industry Type behaves
 * identically everywhere instead of each page reinventing it.
 *
 * Fetches /industry-types once to resolve the active industry's row id, and
 * /clients once to build a client_code -> industry_type_id map — the same
 * two calls ClientsPage already makes, just shared instead of duplicated.
 */
export function useIndustryScope() {
  const { activeIndustry } = useIndustry();
  const [industryTypes, setIndustryTypes] = useState<IndustryTypeRecord[]>([]);
  const [clientScope, setClientScope] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    api<{ data: IndustryTypeRecord[] }>('/industry-types?status=active')
      .then((res) => { if (!cancelled) setIndustryTypes(res.data ?? []); })
      .catch(() => { /* non-fatal: scoping simply won't narrow anything down */ });
    return () => { cancelled = true; };
    // Refetch whenever the active industry changes too — not just on mount —
    // so a freshly-created industry_types row (or a stale first fetch that
    // predates it) doesn't leave activeIndustryTypeId stuck at null until a
    // full page reload.
  }, [activeIndustry]);

  useEffect(() => {
    let cancelled = false;
    api<{ data: ClientScopeRecord[] }>('/clients')
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const c of res.data ?? []) {
          if (c.client_code && c.industry_type_id) map.set(c.client_code, c.industry_type_id);
        }
        setClientScope(map);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, []);

  const activeIndustryTypeId = useMemo(
    // Case-insensitive match: the database has a mix of casings today
    // (e.g. 'fmcg' vs 'TRADING'), and a future row created with different
    // casing shouldn't silently break "Add lead" the way Trading/Vehicle did.
    () => industryTypes.find((it) => it.code.toUpperCase() === activeIndustry.toUpperCase())?.id ?? null,
    [industryTypes, activeIndustry],
  );

 
  /** True if a record's own industry_type_id (or embedded industry_types.id) matches the active industry.
   *  Unscoped/unresolved records are hidden, not shown — an unlabeled record has no business
   *  leaking into every industry's view. */
  function matchesActiveIndustry(industryTypeId?: string | null): boolean {
    if (!activeIndustryTypeId) return false; // industry types not loaded yet — don't show anything until we know
    if (!industryTypeId) return false; // record has no industry link at all — can't prove it belongs here
    return industryTypeId === activeIndustryTypeId;
  }

  /** True if a record's client_code (via its embedded `clients` relation) belongs to the active industry. */
  function clientMatchesActiveIndustry(clientCode?: string | null): boolean {
    if (!activeIndustryTypeId) return false;
    if (!clientCode) return false;
    const industryTypeId = clientScope.get(clientCode);
    if (!industryTypeId) return false; // unscoped client — can't prove it belongs here
    return industryTypeId === activeIndustryTypeId;
  }

  return { activeIndustry, activeIndustryTypeId, matchesActiveIndustry, clientMatchesActiveIndustry };
} 