// NEW — these endpoints are deliberately NOT behind the `authenticate`
// middleware: Twilio calls them directly and cannot send a Supabase login
// token. Instead every request is verified using Twilio's own request
// signature (see providers/twilio.provider.ts -> verifyWebhookSignature).
import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { getTelephonyProvider } from '../services/telephony/provider-registry.js';
import { telephonyService } from '../services/telephony.service.js';
import { getTelephonySettings } from '../repositories/telephony-settings.repository.js';

// Twilio webhooks are per-ORGANIZATION: each org's Twilio phone number is
// configured (in the Twilio console) to call a URL that includes the
// organization id, e.g. https://yourapi.com/api/telephony-webhook/twilio/voice/<organizationId>
function requestUrl(req: Parameters<RequestHandler>[0]): string {
  const protocol = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
  return `${protocol}://${req.get('host')}${req.originalUrl}`;
}

function orgId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) throw new AppError(400, 'VALIDATION_ERROR', 'organizationId is required in the webhook URL.');
  return raw;
}

function verify(req: Parameters<RequestHandler>[0]) {
  const provider = getTelephonyProvider();
  provider.verifyWebhookSignature({ signature: req.header('X-Twilio-Signature'), url: requestUrl(req), params: req.body as Record<string, unknown> });
  return provider;
}

function sendTwiml(res: Parameters<RequestHandler>[1], xml: string) {
  res.status(200).type('text/xml').send(xml);
}

export const telephonyWebhook: Record<string, RequestHandler> = {
  // First hit when a call comes in: play the IVR menu.
  voice: async (req, res, next) => {
    try {
      const provider = verify(req);
      const organizationId = orgId(req.params.organizationId);
      const settings = await getTelephonySettings(organizationId);
      const menuOptions = Object.keys(settings?.ivr_menu_industry_map ?? {}).map((digit) => ({ digit, label: `option ${digit}` }));
      const xml = provider.buildIvrMenuResponse({
        greeting: 'Thank you for calling. Please listen to the following options.',
        menuOptions: menuOptions.length ? menuOptions : [{ digit: '1', label: 'sales' }],
        gatherActionUrl: `${req.baseUrl}/twilio/gather/${organizationId}`,
      });
      sendTwiml(res, xml);
    } catch (error) {
      next(error);
    }
  },

  // Twilio posts here with whichever digit the caller pressed.
  gather: async (req, res, next) => {
    try {
      const provider = verify(req);
      const organizationId = orgId(req.params.organizationId);
      const digits = typeof req.body?.Digits === 'string' ? req.body.Digits : undefined;
      const event = provider.normalizeWebhookEvent({ ...req.body, Digits: digits });
      await telephonyService.ingestWebhookEvent(organizationId, event);
      sendTwiml(res, provider.buildSimpleSayResponse('Thank you. A member of our sales team will assist you shortly.'));
    } catch (error) {
      next(error);
    }
  },

  // Fires repeatedly through the call's life: ringing, in-progress, completed, etc.
  status: async (req, res, next) => {
    try {
      const provider = verify(req);
      const organizationId = orgId(req.params.organizationId);
      const event = provider.normalizeWebhookEvent(req.body as Record<string, unknown>);
      await telephonyService.ingestWebhookEvent(organizationId, event);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },

  // Fires once a call recording is ready.
  recording: async (req, res, next) => {
    try {
      const provider = verify(req);
      const organizationId = orgId(req.params.organizationId);
      const event = provider.normalizeWebhookEvent(req.body as Record<string, unknown>);
      await telephonyService.ingestWebhookEvent(organizationId, event);
      res.status(204).send();
    } catch (error) {
      next(error instanceof AppError ? error : new AppError(500, 'TELEPHONY_WEBHOOK_FAILED', 'Failed to process the recording webhook.'));
    }
  },
};
