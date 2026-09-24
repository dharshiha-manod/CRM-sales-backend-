import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { createInitialSettingsState, hydrateSettingsState, type SettingsState } from './types';

// Pages currently using useOrgSettings() register here so that when the
// Settings page saves, they pick up the new values immediately instead of
// waiting for their next mount/refetch.
type Listener = (settings: SettingsState) => void;
const listeners = new Set<Listener>();

export function publishOrgSettings(next: SettingsState) {
  listeners.forEach((listener) => listener(next));
}

// The frontend twin of api/api/src/lib/settings.ts on the backend — any
// page component can call this to read live Settings, with the same
// "fall back to safe defaults" behavior the Settings page itself uses.
export function useOrgSettings() {
  const [settings, setSettings] = useState<SettingsState>(createInitialSettingsState);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await api<{ data: { settings?: unknown } | null }>('/organization-settings');
        if (!active) return;
        setSettings(hydrateSettingsState(response.data?.settings));
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
    const listener: Listener = (next) => setSettings(next);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return { settings, loading };
}