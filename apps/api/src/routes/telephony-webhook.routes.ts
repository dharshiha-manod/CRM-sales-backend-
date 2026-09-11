// NEW — deliberately mounted WITHOUT `authenticate`: Twilio calls these
// endpoints directly and can't send a Supabase login token. Each request is
// instead verified via Twilio's own request signature inside the controller
// (telephonyWebhook.* -> verify() -> provider.verifyWebhookSignature).
import { Router } from 'express';
import { telephonyWebhook } from '../controllers/telephony-webhook.controller.js';

export const telephonyWebhookRouter = Router();

telephonyWebhookRouter.post('/telephony-webhook/twilio/voice/:organizationId', telephonyWebhook.voice);
telephonyWebhookRouter.post('/telephony-webhook/twilio/gather/:organizationId', telephonyWebhook.gather);
telephonyWebhookRouter.post('/telephony-webhook/twilio/status/:organizationId', telephonyWebhook.status);
telephonyWebhookRouter.post('/telephony-webhook/twilio/recording/:organizationId', telephonyWebhook.recording); 