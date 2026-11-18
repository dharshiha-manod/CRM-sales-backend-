// One-time backfill: creates the Import/Export transaction for existing cross-border shipments.
// Safe to re-run: shipments that already have a transaction are skipped.
//
// Run from the api folder with:
//   npx tsx src/scripts/backfill-shipment-transactions.ts

import { backfillShipmentTransactions } from '../repositories/trading.repository.js';

backfillShipmentTransactions()
  .then(({ checked, created }) => {
    console.log(`Done. Checked ${checked} shipment(s), created ${created} transaction(s).`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill crashed:', error);
    process.exit(1);
  });