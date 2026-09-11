import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const organizationId = import.meta.env.VITE_ORGANIZATION_ID;

export type CurrentMembership = {
  organization_id: string;
  status: string;
  industry_type_id: string | null;
  roles?: { code: string; name: string } | null;
  industry_types?: { id: string; code: string; name: string } | null;
};

type MeResponse = { data: { organization_memberships?: CurrentMembership[] } };

/**
 * The single source of truth for "who am I in this org": role + locked
 * industry, read from /auth/me. Everything that used to guess a rep's
 * industry from client assignments, or let anyone flip an unrestricted
 * localStorage switcher, reads it from here instead.
 */
export function useCurrentMembership() {
  const [membership, setMembership] = useState<CurrentMembership | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<MeResponse>('/auth/me')
      .then((res) => {
        if (cancelled) return;
        const mine = (res.data.organization_memberships ?? []).find((m) => m.organization_id === organizationId && m.status === 'active');
        setMembership(mine ?? null);
      })
      .catch(() => { if (!cancelled) setMembership(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const role = membership?.roles?.code ?? null;
  const isGlobal = role === 'super_admin' || role === 'admin';
  const lockedIndustryTypeId = membership?.industry_type_id ?? null;
  const lockedIndustryCode = membership?.industry_types?.code ?? null;

  return { membership, role, isGlobal, lockedIndustryTypeId, lockedIndustryCode, loading };
}