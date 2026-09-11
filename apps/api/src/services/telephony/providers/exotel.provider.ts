// Exotel implementation of the TelephonyProvider contract.
// Docs: https://developer.exotel.com/api/
// Auth: HTTP Basic (API Key : API Token) against https://<subdomain>/v1/Accounts/<sid>/...
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

function mustSid(): string {
  if (!env.EXOTEL_SID) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'EXOTEL_SID is not set.');
  return env.EXOTEL_SID;
}

function mustApiKey(): string {
  if (!env.EXOTEL_API_KEY) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'EXOTEL_API_KEY is not set.');
  return env.EXOTEL_API_KEY;
}

function mustApiToken(): string {
  if (!env.EXOTEL_API_TOKEN) throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'EXOTEL_API_TOKEN is not set.');
  return env.EXOTEL_API_TOKEN;
}

function subdomain(): string {
  return env.EXOTEL_SUBDOMAIN ?? 'api.exotel.com';
}

function basicAuthHeader(): string {
  const token = Buffer.from(`${mustApiKey()}:${mustApiToken()}`).toString('base64');
  return `Basic ${token}`;
}

export const exotelProvider: TelephonyProvider = {
  name: 'exotel',

  async placeOutboundCall(input: PlaceOutboundCallInput): Promise<PlaceOutboundCallResult> {
    const sid = mustSid();
    const url = `https://${subdomain()}/v1/Accounts/${sid}/Calls/connect.json`;
    const body = new URLSearchParams({
      From: input.from,
      To: input.to,
      CallerId: input.from,
      StatusCallback: input.statusCallbackUrl,
      StatusCallbackEvents: 'terminal,answered',
    });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AppError(502, 'TELEPHONY_PROVIDER_ERROR', `Exotel call failed: ${response.status} ${text}`);
    }
    const data = (await response.json()) as { Call?: { Sid?: string } };
    const providerCallId = data.Call?.Sid;
    if (!providerCallId) throw new AppError(502, 'TELEPHONY_PROVIDER_ERROR', 'Exotel did not return a Call Sid.');
    return { providerCallId };
  },

  verifyWebhookSignature(_input: VerifyWebhookSignatureInput): void {
    // Exotel does not sign webhooks the way Twilio does. Instead, protect
    // these endpoints by keeping the webhook URL secret (it already embeds
    // the organizationId) and, optionally, by allow-listing Exotel's
    // outbound IP ranges at the network/firewall level. No-op here by design.
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
    const fromNumber = str(body, 'From') ?? str(body, 'CallFrom') ?? null;
    const toNumber = str(body, 'To') ?? str(body, 'CallTo') ?? null;
    const customerNumber = direction === 'inbound' ? fromNumber : toNumber;
    const durationRaw = str(body, 'DialCallDuration') ?? str(body, 'CallDuration');

    return {
      providerCallId: str(body, 'CallSid') ?? '',
      direction,
      status: mapStatus(str(body, 'Status') ?? str(body, 'DialCallStatus')),
      customerNumber,
      fromNumber,
      toNumber,
      durationSeconds: durationRaw ? Number(durationRaw) : null,
      recordingUrl: str(body, 'RecordingUrl') ?? null,
      ivrDigits: str(body, 'digits') ?? str(body, 'Digits') ?? null,
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