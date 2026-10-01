import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useIndustry } from '../industry/IndustryContext';
import { hydrateSettingsForIndustry, type SettingsState } from './types';

// Pages currently using useOrgSettings() register here so that when the
// Settings page saves, they pick up the new values immediately instead of
// waiting for their next mount/refetch. What gets published is the settings
// exactly as stored (org-wide base + every industry's overrides); each hook
// then resolves the view for ITS active industry.
type Listener = (stored: unknown) => void;
const listeners = new Set<Listener>();

export function publishOrgSettings(stored: unknown) {
  listeners.forEach((listener) => listener(stored));
}

// The frontend twin of api/api/src/lib/settings.ts on the backend — any
// page component can call this to read live Settings, with the same
// "fall back to safe defaults" behavior the Settings page itself uses.
// Settings are per industry: this returns the values for the ACTIVE industry
// type, so what one industry configures never shows up in another.
export function useOrgSettings() {
  const { activeIndustry } = useIndustry();
  const [stored, setStored] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api<{ data: { settings?: unknown } | null }>('/organization-settings');
        if (!active) return;
        setStored(response.data?.settings ?? null);
      } catch {
        // First-time org, or a network hiccup — keep the safe defaults
        // instead of breaking whichever page called this hook.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const listener: Listener = (next) => setStored(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const settings = useMemo<SettingsState>(() => hydrateSettingsForIndustry(stored, activeIndustry), [stored, activeIndustry]);

  return { settings, loading };
}
