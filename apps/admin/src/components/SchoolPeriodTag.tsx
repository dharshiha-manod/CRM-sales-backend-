import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Year = { id: string; label: string; terms: { id: string; name: string }[] };
let cache: Promise<Year[]> | null = null;
const loadYears = () => (cache ??= api<{ data: Year[] }>('/school/academic-years').then((r) => r.data ?? []).catch(() => { cache = null; return []; }));

/** School only: "2026-27 · Term 1" under an order / quotation date. Renders nothing for rows without an academic year (every other industry). */
export function SchoolPeriodTag({ yearId, termId }: { yearId?: string | null; termId?: string | null }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!yearId) return;
    let live = true;
    void loadYears().then((years) => {
      const year = years.find((y) => y.id === yearId);
      if (!live || !year) return;
      const term = termId ? year.terms.find((t) => t.id === termId) : null;
      setText(term ? `${year.label} · ${term.name}` : year.label);
    });
    return () => { live = false; };
  }, [yearId, termId]);
  return yearId && text ? <small style={{ display: 'block', fontSize: '.74rem', color: 'var(--text-faint)' }}>{text}</small> : null;
}
