import { supabase } from './supabase';
const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
const organizationId = import.meta.env.VITE_ORGANIZATION_ID;
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!supabase || !organizationId) throw new Error('Configure Supabase and VITE_ORGANIZATION_ID first.');
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in with Supabase before using master data.');

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.session.access_token}`,
        'x-organization-id': organizationId,
        ...options.headers,
      },
    });
  } catch {
    // The browser's raw "Failed to fetch" means the request never reached a
    // server — API is down, wrong VITE_API_URL, or blocked by CORS/network.
    throw new Error(`Can't reach the API at ${baseUrl}. Check that the backend is running and VITE_API_URL is correct.`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; details?: unknown } } | null;
    const error = Object.assign(new Error(body?.error?.message ?? `Request failed (${response.status})`), { details: body?.error?.details });
    throw error;
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}