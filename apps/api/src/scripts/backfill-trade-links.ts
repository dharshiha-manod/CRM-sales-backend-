// One-time catch-up script.
//
// Why this exists: Import/Export, Customs and Compliance now update each other automatically
// (see runTradeLinks in trading.repository.ts). Records saved BEFORE that change - for example
// TXN-2026-0001 and CUS-2026-0001 - never got their links, so Compliance shows 0 records and the
// customs status is blank.
//
// What it does, for every Import/Export transaction and Customs record:
//   - a blank customs status becomes "Not Started"
//   - a transaction with no customs record gets one
//   - a transaction with no compliance check gets one
//   - transaction statuses catch up with their shipment and customs (forward only)
//
// Safe to re-run: it never creates a second customs record / compliance check for the same
// transaction and never moves a status backwards.
//
// Run with (from the api folder):
//   npx tsx src/scripts/backfill-trade-links.ts

import { backfillTradeLinks } from '../repositories/trading.repository.js';

backfillTradeLinks()
  .then((result) => {
    console.log(`Done. Checked ${result.transactions} transaction(s) and ${result.customs} customs record(s).`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });