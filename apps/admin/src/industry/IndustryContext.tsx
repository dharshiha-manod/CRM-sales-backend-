import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useCurrentMembership } from '../auth/useCurrentMembership';
import { INDUSTRY_CONFIGS } from './mockData';
import type { IndustryConfig, IndustryKey } from './types';

export const INDUSTRY_ORDER: IndustryKey[] = ['fmcg', 'school', 'textile', 'pharma', 'trading', 'vehicle'];
const STORAGE_KEY = 'fs-active-industry';

interface IndustryContextValue {
  activeIndustry: IndustryKey;
  setActiveIndustry: (key: IndustryKey) => void;
  config: IndustryConfig;
  /** True only for Admin/Super Admin — everyone else is locked and the
   *  switcher must not be rendered for them at all. */
  canSwitchIndustry: boolean;
  /** True until /auth/me has resolved. */
  resolvingScope: boolean;
}

const IndustryContext = createContext<IndustryContextValue | null>(null);

function readStored(): IndustryKey {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return (INDUSTRY_ORDER as string[]).includes(stored ?? '') ? (stored as IndustryKey) : 'fmcg';
}

export function IndustryProvider({ children }: { children: ReactNode }) {
  const { isGlobal, lockedIndustryCode, loading } = useCurrentMembership();
  const [activeIndustry, setActiveIndustryState] = useState<IndustryKey>(readStored());

  useEffect(() => {
    if (loading || isGlobal) return;
    const key = (lockedIndustryCode ?? '').toLowerCase();
    if ((INDUSTRY_ORDER as string[]).includes(key)) {
      setActiveIndustryState(key as IndustryKey);
      window.localStorage.setItem(STORAGE_KEY, key);
    }
  }, [loading, isGlobal, lockedIndustryCode]);

  const setActiveIndustry = (key: IndustryKey) => {
    if (!isGlobal) return; // locked users can't switch, enforced here and again on the server
    setActiveIndustryState(key);
    window.localStorage.setItem(STORAGE_KEY, key);
  };

  const config = INDUSTRY_CONFIGS[activeIndustry];
  return (
    <IndustryContext.Provider value={{ activeIndustry, setActiveIndustry, config, canSwitchIndustry: isGlobal, resolvingScope: loading }}>
      {children}
    </IndustryContext.Provider>
  );
}

export function useIndustry(): IndustryContextValue {
  const ctx = useContext(IndustryContext);
  if (!ctx) throw new Error('useIndustry must be used within an IndustryProvider');
  return ctx;
}