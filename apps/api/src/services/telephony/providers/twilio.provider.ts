// Twilio implementation of the TelephonyProvider contract.
// Docs: https://www.twilio.com/docs/voice/api
// Auth: Account SID + Auth Token against the Twilio REST API.
import twilio from 'twilio';
import { env } from '../../../config/env.js';
import { AppError } from '../../../errors/app-error.js';
import type {
  BuildIvrMenuInput,
  CallDirection,
  CallStatus,
  NormalizedCallEvent,
  PlaceOutboundCallInput,
  PlaceOutboundCallResult,
  TelephonyProvider,
  VerifyWebhookSignatureInput,
} from '../telephony-provider.types.js';

const STATUS_MAP: Record<string, CallStatus> = {
  'queued': 'queued',
  'in-progress': 'in-progress',
  'ringing': 'ringing',
  'completed': 'completed',
  'busy': 'busy',
  'failed': 'failed',
  'no-answer': 'no-answer',
  'canceled': 'canceled',
};

function mapStatus(raw: unknown): CallStatus {
  const key = typeof raw === 'string' ? raw.toLowerCase() : '';
  return STATUS_MAP[key] ?? 'failed';
}

function str(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mustAccountSid(): string {
  if (!env.TWILIO_ACCOUNT_SID) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'TWILIO_ACCOUNT_SID is not set.');
  return env.TWILIO_ACCOUNT_SID;
}

function mustAuthToken(): string {
  if (!env.TWILIO_AUTH_TOKEN) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'TWILIO_AUTH_TOKEN is not set.');
  return env.TWILIO_AUTH_TOKEN;
}

function client() {
  return twilio(mustAccountSid(), mustAuthToken());
}

export const twilioProvider: TelephonyProvider = {
  name: 'twilio',

  async placeOutboundCall(input: PlaceOutboundCallInput): Promise<PlaceOutboundCallResult> {
    try {
      const call = await client().calls.create({
        to: input.to,
        from: input.from,
        url: input.statusCallbackUrl.replace('/status/', '/voice/'),
        statusCallback: input.statusCallbackUrl,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });
      if (!call.sid) throw new AppError(502, 'TELEPHONY_PROVIDER_ERROR', 'Twilio did not return a Call Sid.');
      return { providerCallId: call.sid };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new AppError(502, 'TELEPHONY_PROVIDER_ERROR', `Twilio call failed: ${message}`);
    }
  },

  verifyWebhookSignature({ signature, url, params }: VerifyWebhookSignatureInput): void {
    if (!signature) throw new AppError(401, 'TELEPHONY_WEBHOOK_UNAUTHORIZED', 'Missing X-Twilio-Signature header.');
    const valid = twilio.validateRequest(mustAuthToken(), signature, url, params as Record<string, string>);
    if (!valid) throw new AppError(401, 'TELEPHONY_WEBHOOK_UNAUTHORIZED', 'Invalid Twilio request signature.');
  },

  buildIvrMenuResponse({ greeting, menuOptions, gatherActionUrl }: BuildIvrMenuInput): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather action="${gatherActionUrl}" method="POST" numDigits="1">
    <Say>${escapeXml(greeting)}</Say>
${menuOptions.map((option) => `    <Say>Press ${option.digit} for ${escapeXml(option.label)}.</Say>`).join('\n')}
  </Gather>
  <Redirect method="POST">${gatherActionUrl}</Redirect>
</Response>`;
  },

  buildSimpleSayResponse(text: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(text)}</Say>
</Response>`;
  },

  normalizeWebhookEvent(body: Record<string, unknown>): NormalizedCallEvent {
    const direction: CallDirection = str(body, 'Direction')?.toLowerCase().startsWith('inbound') ? 'inbound' : 'outbound';
    const fromNumber = str(body, 'From') ?? null;
    const toNumber = str(body, 'To') ?? null;
    const customerNumber = direction === 'inbound' ? fromNumber : toNumber;
    const durationRaw = str(body, 'DialCallDuration') ?? str(body, 'CallDuration');

    return {
      providerCallId: str(body, 'CallSid') ?? '',
      direction,
      status: mapStatus(str(body, 'CallStatus') ?? str(body, 'DialCallStatus')),
      customerNumber,
      fromNumber,
      toNumber,
      durationSeconds: durationRaw ? Number(durationRaw) : null,
      recordingUrl: str(body, 'RecordingUrl') ?? null,
      ivrDigits: str(body, 'Digits') ?? null,
      startedAt: new Date().toISOString(),
      raw: body,
    };
  },
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}