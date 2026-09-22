import { supabase } from './supabase';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const organizationId = process.env.EXPO_PUBLIC_ORGANIZATION_ID;
export async function api<T>(path: string, options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T> {
  if (!organizationId) throw new Error('Configure EXPO_PUBLIC_ORGANIZATION_ID first.');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in before loading the dashboard.');
  const hasBody = options?.body !== undefined;
  const response = await fetch(`${apiUrl}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      authorization: `Bearer ${data.session.access_token}`,
      'x-organization-id': organizationId,
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; code?: string; details?: unknown } } | null;
    const error = Object.assign(new Error(body?.error?.message ?? `Request failed (${response.status})`), { code: body?.error?.code, details: body?.error?.details });
    throw error;
  }
  return response.json() as Promise<T>;
}
