import { supabaseAdmin } from '../lib/supabase.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function registerPushToken(organizationId: string, representativeId: string, token: string, platform?: string | null) {
  const { error } = await supabaseAdmin.from('rep_push_tokens').upsert(
    { organization_id: organizationId, representative_id: representativeId, token, platform: platform ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  );
  if (error) throw error;
}

/** Never throws: a failed push must not break the caller. */
export async function sendPushToRep(organizationId: string, representativeId: string, title: string, body: string, data?: Record<string, unknown>): Promise<number> {
  try {
    const { data: rows, error } = await supabaseAdmin.from('rep_push_tokens').select('token').eq('organization_id', organizationId).eq('representative_id', representativeId);
    if (error) throw error;
    const tokens = (rows ?? []).map((row) => row.token as string).filter((token) => token.startsWith('ExponentPushToken'));
    if (tokens.length === 0) return 0;
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default', data: data ?? {} }))),
    });
    if (!response.ok) throw new Error(`Expo push responded ${response.status}`);
    return tokens.length;
  } catch (error) {
    console.error('Push notification failed', error);
    return 0;
  }
}