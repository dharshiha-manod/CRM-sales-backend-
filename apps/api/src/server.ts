import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startSupplierReplyPolling } from './services/purchase-enquiry-reply-poller.service.js';
app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'API listening'));
// No-op unless SUPPLIER_REPLY_IMAP_HOST/USER/PASS are set — see that
// service's file comment for why this stays entirely optional.
startSupplierReplyPolling();