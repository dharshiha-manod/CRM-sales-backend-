// NEW — rewritten from the read-only placeholder to a real webhook-ingestion
// + auto-lead-creation service. The original file only had
// `assertProviderConfigured()`; that behaviour is preserved below as
// `assertProviderConfigured` so nothing that already imports it breaks.
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import * as leadsRepository from '../repositories/leads.repository.js';
import * as telephonyRepository from '../repositories/telephony.repository.js';
import { getTelephonySettings, resolveIndustryForIvrPath } from '../repositories/telephony-settings.repository.js';
import { getTelephonyProvider, isTelephonyConfigured } from './telephony/provider-registry.js';
import type { NormalizedCallEvent } from './telephony/telephony-provider.types.js';

export const telephonyService = {
  assertProviderConfigured(): never {
    throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'IVR is not configured yet. Connect an approved telephony provider before placing or receiving calls.');
  },

  isConfigured: isTelephonyConfigured,

  // Called by telephony-webhook.controller.ts for every event Twilio sends
  // (ringing, answered, completed, ...). This is the heart of the feature:
  //  1. Save/update the call row so the Calls page updates live.
  //  2. Try to match the caller's number to an existing Client, then Lead.
  //  3. Only on a COMPLETED call, if still unmatched, auto-create a Lead —
  //     but only when we can resolve an industry (and, ideally, a
  //     representative) with confidence. If we can't, we leave the call
  //     unmatched rather than guessing.
  async ingestWebhookEvent(organizationId: string, event: NormalizedCallEvent) {
    const client = event.customerNumber ? await telephonyRepository.findClientByPhone(organizationId, event.customerNumber) : null;
    let lead = !client && event.customerNumber ? await telephonyRepository.findLeadByPhone(organizationId, event.customerNumber) : null;

    const settings = await getTelephonySettings(organizationId);

    // Auto-create a Lead only once the call is actually completed (so we
    // know it was a real, connected call) and only if nothing matched yet.
    if (event.status === 'completed' && !client && !lead && settings?.auto_create_lead) {
      lead = await tryAutoCreateLead(organizationId, event, settings);
    }

    const saved = await telephonyRepository.upsertCallByProviderId(organizationId, {
      provider: activeProviderName(),
      providerCallId: event.providerCallId,
      direction: event.direction,
      status: event.status,
      phoneNumber: event.customerNumber,
      fromNumber: event.fromNumber,
      toNumber: event.toNumber,
      durationSeconds: event.durationSeconds,
      recordingUrl: event.recordingUrl,
      ivrMenuPath: event.ivrDigits,
      startedAt: event.startedAt,
      clientId: client?.id ?? null,
      leadId: lead?.id ?? null,
      representativeId: (lead as { representative_id?: string | null } | null)?.representative_id ?? settings?.default_representative_id ?? null,
      rawEvent: { status: event.status, raw: event.raw },
    });
    return saved;
  },

  async initiateCall(organizationId: string, input: { toNumber: string; representativeId?: string | null }) {
    const provider = getTelephonyProvider();
    const settings = await getTelephonySettings(organizationId);
    if (!settings?.is_enabled) telephonyService.assertProviderConfigured();
    const baseUrl = mustPublicBaseUrl();
    const { providerCallId } = await provider.placeOutboundCall({
      to: input.toNumber,
      from: mustFromNumber(),
      statusCallbackUrl: `${baseUrl}/telephony-webhook/twilio/status/${organizationId}`,
    });
    return telephonyRepository.upsertCallByProviderId(organizationId, {
      provider: activeProviderName(),
      providerCallId,
      direction: 'outbound',
      status: 'queued',
      phoneNumber: input.toNumber,
      fromNumber: mustFromNumber(),
      toNumber: input.toNumber,
      startedAt: new Date().toISOString(),
      representativeId: input.representativeId ?? null,
      rawEvent: { initiatedBy: 'click_to_call' },
    });
  },
};

async function tryAutoCreateLead(organizationId: string, event: NormalizedCallEvent, settings: Awaited<ReturnType<typeof getTelephonySettings>>) {
  if (!settings) return null;
  const industryTypeId = resolveIndustryForIvrPath(settings, event.ivrDigits);
  if (!industryTypeId) return null; // Can't guess an industry — leave unmatched.

  const representativeId = settings.default_representative_id ?? null;
  // Leads need a `createdBy` user id. We use the assigned representative's
  // own linked user account — the same person who'll actually work the
  // lead — falling back to any active admin/super_admin in the org so this
  // never silently fails just because no default rep is configured.
  const createdBy = await resolveSystemCreatedBy(organizationId, representativeId);
  if (!createdBy) return null;

  try {
    return await leadsRepository.createLead(organizationId, createdBy, {
      industryTypeId,
      representativeId,
      companyName: `Inbound call ${event.customerNumber}`,
      contactName: null,
      phone: event.customerNumber,
      email: null,
      city: null,
      state: null,
      source: 'ivr',
      priority: 'normal',
      notes: 'Automatically created from an inbound IVR call.',
      leadCode: undefined,
      score: undefined,
      nextAction: null,
      nextActionDueAt: null,
    });
  } catch (error) {
    // A 409 DUPLICATE_LEAD here just means another call/webhook retry beat
    // us to it a moment earlier — not a real failure, so don't crash the
    // whole webhook because of it.
    if (error instanceof AppError && error.statusCode === 409) return await telephonyRepository.findLeadByPhone(organizationId, event.customerNumber);
    throw error;
  }
}

async function resolveSystemCreatedBy(organizationId: string, representativeId: string | null): Promise<string | null> {
  if (representativeId) {
    const { data } = await supabaseAdmin.from('sales_representatives').select('user_id').eq('organization_id', organizationId).eq('id', representativeId).maybeSingle();
    if (data?.user_id) return data.user_id as string;
  }
  const { data } = await supabaseAdmin
    .from('organization_memberships')
    .select('user_id, roles!inner(code)')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .in('roles.code', ['super_admin', 'admin'])
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

function mustPublicBaseUrl(): string {
  if (!env.TELEPHONY_PUBLIC_BASE_URL) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'TELEPHONY_PUBLIC_BASE_URL is not set.');
  return env.TELEPHONY_PUBLIC_BASE_URL;
}

// Which provider is actually active right now (mirrors provider-registry's
// own check, so this throws the same error getTelephonyProvider() would).
function activeProviderName(): 'twilio' | 'exotel' {
  if (env.TELEPHONY_PROVIDER === 'twilio' || env.TELEPHONY_PROVIDER === 'exotel') return env.TELEPHONY_PROVIDER;
  throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'No supported telephony provider is configured.');
}

// BUGFIX: this used to always read TWILIO_PHONE_NUMBER, so outbound calls
// failed with "TWILIO_PHONE_NUMBER is not set" even when Exotel was fully
// configured. It now reads the number for whichever provider is active.
function mustFromNumber(): string {
  const provider = activeProviderName();
  if (provider === 'exotel') {
    if (!env.EXOTEL_PHONE_NUMBER) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'EXOTEL_PHONE_NUMBER is not set.');
    return env.EXOTEL_PHONE_NUMBER;
  }
  if (!env.TWILIO_PHONE_NUMBER) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'TWILIO_PHONE_NUMBER is not set.');
  return env.TWILIO_PHONE_NUMBER;
}