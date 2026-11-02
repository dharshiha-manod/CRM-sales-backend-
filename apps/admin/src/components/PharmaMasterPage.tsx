/**
 * Pharma's 6 modules reuse the config-driven engine in TextileMasterPage (nothing textile-specific in it).
 * This wrapper only switches OFF the demo rows: Pharma shows real database records, never fake samples.
 * Textile itself is untouched.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { TextileMasterPage } from './TextileMasterPage';
import type { TextileModuleConfig } from './TextileMasterPage';

type RepRow = { employee_code?: string | null; user_profiles?: { display_name?: string | null } | null };

export function PharmaMasterPage({ config }: { config: TextileModuleConfig }) {
  const [repNames, setRepNames] = useState<Record<string, string>>({});
  const hasRepField = config.fields.some((f) => f.lookupResource === '/sales-representatives');

  useEffect(() => {
    if (!hasRepField) return;
    api<{ data: RepRow[] }>('/sales-representatives')
      .then((res) => {
        const map: Record<string, string> = {};
        (res.data ?? []).forEach((r) => {
          if (r.employee_code && r.user_profiles?.display_name) map[r.employee_code] = r.user_profiles.display_name;
        });
        setRepNames(map);
      })
      .catch(() => { /* names unavailable: the code keeps showing */ });
  }, [hasRepField]);

  const fields = useMemo(() => config.fields.map((f) => {
    if (f.lookupResource !== '/sales-representatives') return f;
    const show = (v: unknown) => { const s = v == null ? '' : String(v); return s ? (repNames[s] ?? s) : '—'; };
    return { ...f, render: (v: unknown) => show(v), format: (v: unknown) => show(v) };
  }), [config.fields, repNames]);

  return <TextileMasterPage config={{ ...config, fields, sampleRecords: undefined }} />;
}
export type {
  TextileModuleConfig as PharmaModuleConfig,
  TextileRecord as PharmaRecord,
  FieldDef,
  KpiDef,
  FieldType,
} from './TextileMasterPage';