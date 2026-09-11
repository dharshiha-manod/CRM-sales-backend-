// Shared contract that every telephony provider (Twilio, Exotel, ...) must
// implement, plus the normalized shapes the rest of the app works with.
// NOTE: this file only holds TYPES. Provider selection logic
// (isTelephonyConfigured / getTelephonyProvider) lives in
// ./provider-registry.ts — keep them out of here to avoid the import cycle
// this file previously had with itself.

export type CallDirection = 'inbound' | 'outbound';

export type CallStatus =
  | 'queued'
  | 'in-progress'
  | 'ringing'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

export interface PlaceOutboundCallInput {
  to: string;
  from: string;
  statusCallbackUrl: string;
}

export interface PlaceOutboundCallResult {
  providerCallId: string;
}

export interface VerifyWebhookSignatureInput {
  signature: string | undefined;
  url: string;
  params: Record<string, unknown>;
}

export interface BuildIvrMenuInput {
  greeting: string;
  menuOptions: Array<{ digit: string; label: string }>;
  gatherActionUrl: string;
}

export interface NormalizedCallEvent {
  providerCallId: string;
  direction: CallDirection;
  status: CallStatus;
  customerNumber: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  ivrDigits: string | null;
  startedAt: string;
  raw: Record<string, unknown>;
}

export interface TelephonyProvider {
  name: 'twilio' | 'exotel';
  placeOutboundCall(input: PlaceOutboundCallInput): Promise<PlaceOutboundCallResult>;
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): void;
  buildIvrMenuResponse(input: BuildIvrMenuInput): string;
  buildSimpleSayResponse(text: string): string;
  normalizeWebhookEvent(body: Record<string, unknown>): NormalizedCallEvent;
}