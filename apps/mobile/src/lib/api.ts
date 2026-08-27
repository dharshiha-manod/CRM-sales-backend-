import { supabase } from './supabase';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const organizationId = process.env.EXPO_PUBLIC_ORGANIZATION_ID;
export async function api<T>(path: string): Promise<T> {
  if (!organizationId) throw new Error('Configure EXPO_PUBLIC_ORGANIZATION_ID first.');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in before loading the dashboard.');
  const response = await fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${data.session.access_token}`, 'x-organization-id': organizationId } });
  if (!response.ok) { const body = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(body?.error?.message ?? `Request failed (${response.status})`); }
  return response.json() as Promise<T>;
}
