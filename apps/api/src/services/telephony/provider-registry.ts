import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { twilioProvider } from './providers/twilio.provider.js';
import { exotelProvider } from './providers/exotel.provider.js';
import type { TelephonyProvider } from './telephony-provider.types.js';

export function isTelephonyConfigured(): boolean {
  if (env.TELEPHONY_PROVIDER === 'twilio') {
    return Boolean(env.TWILIO_ACCOUNT_SID) && Boolean(env.TWILIO_AUTH_TOKEN) && Boolean(env.TWILIO_PHONE_NUMBER);
  }
  if (env.TELEPHONY_PROVIDER === 'exotel') {
    return Boolean(env.EXOTEL_SID) && Boolean(env.EXOTEL_API_KEY) && Boolean(env.EXOTEL_API_TOKEN) && Boolean(env.EXOTEL_PHONE_NUMBER);
  }
  return false;
}

export function getTelephonyProvider(): TelephonyProvider {
  if (!isTelephonyConfigured()) {
    throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'IVR is not configured yet. Connect an approved telephony provider before placing or receiving calls.');
  }
  switch (env.TELEPHONY_PROVIDER) {
    case 'twilio':
      return twilioProvider;
    case 'exotel':
      return exotelProvider;
    default:
      throw new AppError(503, 'TELEPHONY_NOT_CONFIGURED', 'No supported telephony provider is configured.');
  }
}