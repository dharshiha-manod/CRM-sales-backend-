import type { IndustryKey } from './types';

export interface ReportTerms {
  clientLabel: string;
  clientLabelPlural: string;
  itemLabel: string;
  itemLabelPlural: string;
  insightsTitle: string;
  insightsNote: string;
}

// Labels only — no metrics or numbers live here. Actual figures always come
// from the real API data in ReportsPage.tsx; this file just controls wording
// so the same Report page reads naturally for every industry.
export const REPORT_TERMS: Record<IndustryKey, ReportTerms> = {
  fmcg: {
    clientLabel: 'Retailer',
    clientLabelPlural: 'Retailers',
    itemLabel: 'Product',
    itemLabelPlural: 'Products',
    insightsTitle: 'FMCG insights',
    insightsNote: 'Fast and slow movers, based on confirmed orders for FMCG clients.',
  },
  pharma: {
    clientLabel: 'Client',
    clientLabelPlural: 'Clients',
    itemLabel: 'Medicine',
    itemLabelPlural: 'Medicines',
    insightsTitle: 'Pharma insights',
    insightsNote: 'Medicine-wise sales based on confirmed orders. Batch/expiry tracking isn\u2019t wired to the backend yet.',
  },
  school: {
    clientLabel: 'Institution',
    clientLabelPlural: 'Institutions',
    itemLabel: 'Product / Service',
    itemLabelPlural: 'Products / Services',
    insightsTitle: 'School insights',
    insightsNote: 'Institution-wise sales based on confirmed orders.',
  },
  textile: {
    clientLabel: 'Client',
    clientLabelPlural: 'Clients',
    itemLabel: 'Product',
    itemLabelPlural: 'Products',
    insightsTitle: 'Textile insights',
    insightsNote: 'Product-wise sales based on confirmed orders for textile clients.',
  },
  trading: {
    clientLabel: 'Client',
    clientLabelPlural: 'Clients',
    itemLabel: 'Product',
    itemLabelPlural: 'Products',
    insightsTitle: 'Trading insights',
    insightsNote: 'Product-wise sales based on confirmed orders for trading clients.',
  },
  vehicle: {
    clientLabel: 'Client',
    clientLabelPlural: 'Clients',
    itemLabel: 'Vehicle / Product',
    itemLabelPlural: 'Vehicles / Products',
    insightsTitle: 'Vehicle insights',
    insightsNote: 'Product-wise sales based on confirmed orders for vehicle clients.',
  },
};