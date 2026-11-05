import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startSupplierReplyPolling } from './services/purchase-enquiry-reply-poller.service.js';
import { startOverdueFollowUpScheduler } from './services/overdue-followup-scheduler.service.js';
import { startBeatScheduler } from './services/beat-automation.service.js';
import { startPharmaScheduler } from './services/pharma-scheduler.service.js';
import { startPoReplyPolling } from './services/pharma-po-reply-poller.service.js';
import { startVehicleScheduler } from './services/vehicle-aftersales.service.js';
app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));
// No-op unless SUPPLIER_REPLY_IMAP_HOST/USER/PASS are set — see that
// service's file comment for why this stays entirely optional.
startSupplierReplyPolling();
// Daily beat plan + auto-missed visits. Set BEAT_AUTOMATION=off to disable.
startBeatScheduler();
// Auto-raises "Payment overdue" follow-ups without anyone opening the page. Set OVERDUE_FOLLOWUP_AUTOMATION=off to disable.
startOverdueFollowUpScheduler();
// Keeps Pharma batch expiry, campaign status and product stock current without anyone opening a page. Set PHARMA_AUTOMATION=off to disable.
startPharmaScheduler();
// Reads supplier replies to Purchase Orders / Purchase Returns (no-op unless the IMAP settings are set).
startPoReplyPolling();
// Vehicle after-sales: first/next service scheduling, service / insurance / warranty reminders. Set VEHICLE_AUTOMATION=off to disable.
startVehicleScheduler();