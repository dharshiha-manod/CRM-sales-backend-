import { AppError } from '../errors/app-error.js';

export type TelephonyCallEvent = {
  provider: string;
  providerCallId: string;
  status: 'queued' | 'ringing' | 'answered' | 'completed' | 'failed' | 'missed';
  direction: 'outbound' | 'inbound';
  phoneNumber: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  payload?: Record<string, unknown>;
};

// Every real IVR provider must implement this contract. No provider is enabled by default.
export interface TelephonyProvider {
  readonly name: string;
  verifyWebhook(signature: string | undefined, payload: unknown): Promise<void>;
  normalizeWebhook(payload: unknown): TelephonyCallEvent;
}

export const telephonyService = {
  assertProviderConfigured(): never {
    throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'IVR is not configured yet. Connect an approved telephony provider before placing or receiving calls.');
  },
};
