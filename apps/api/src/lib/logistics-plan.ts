// Logistics plan rules for Trading.
//
// One owner for each thing:
//   Shipment  = WHAT is shipped (goods, quantity, customer, documents, overall status).
//   Logistics = HOW it moves (carrier, route, dates, tracking, freight).
//
// Every shipment gets a Logistics plan the moment it exists (status "Planned"), a shipment cannot
// start moving until that plan has a carrier, an origin, a destination and a planned pickup or
// departure date, and the two records keep their statuses in step so nobody enters it twice.
//
// Nothing here throws except assertPlanReady() - creating / syncing a plan must never block a save.
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { logger } from './logger.js';

type Row = Record<string, unknown>;

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const today = () => new Date().toISOString().slice(0, 10);

/** Shipment statuses that mean the goods have left (or arrived). Moving INTO one needs a complete plan.
 *  'Delivered' is included so a Planned shipment cannot skip the plan by jumping straight to Delivered. */
export const MOVING_SHIPMENT_STATUSES = new Set(['Dispatched', 'In Transit', 'At Destination', 'Delivered']);
/** Shipment statuses after which the "may it start?" question no longer applies. */
export const STARTED_SHIPMENT_STATUSES = new Set(['Dispatched', 'In Transit', 'At Destination', 'Delivered', 'Delayed', 'Cancelled']);
/** Logistics statuses that mean the goods are on the move. */
const IN_MOTION_LOGISTICS = ['Picked Up', 'Dispatched', 'In Transit', 'At Destination', 'Out for Delivery'];
export const MOVING_LOGISTICS_STATUSES = new Set([...IN_MOTION_LOGISTICS, 'Delivered']);
export const STARTED_LOGISTICS_STATUSES = new Set([...IN_MOTION_LOGISTICS, 'Delivered', 'Delayed', 'Cancelled', 'Customs Hold']);

const SHIPMENT_RANK: Record<string, number> = { Planned: 0, 'Ready to Ship': 1, Dispatched: 2, 'In Transit': 3, 'At Destination': 4, Delivered: 5 };
const LOGISTICS_RANK: Record<string, number> = { Planned: 0, 'Pickup Scheduled': 1, 'Picked Up': 2, Dispatched: 3, 'In Transit': 4, 'At Destination': 5, 'Out for Delivery': 6, Delivered: 7 };

const SHIPMENT_TO_LOGISTICS: Record<string, string> = {
  Dispatched: 'Dispatched', 'In Transit': 'In Transit', 'At Destination': 'At Destination', Delivered: 'Delivered', Delayed: 'Delayed',
};
const LOGISTICS_TO_SHIPMENT: Record<string, string> = {
  'Picked Up': 'Dispatched', Dispatched: 'Dispatched', 'In Transit': 'In Transit', 'At Destination': 'At Destination',
  'Out for Delivery': 'At Destination', Delivered: 'Delivered', Delayed: 'Delayed',
};

/** Forward-only: a status never goes backwards, a finished / cancelled / held record is left alone. */
function forwardOnly(current: string, target: string | undefined, rank: Record<string, number>, frozen: string[]): string | null {
  if (!target || current === target || frozen.includes(current)) return null;
  if (target === 'Delayed') return 'Delayed';
  if (current === 'Delayed') return target;
  return (rank[target] ?? -1) > (rank[current] ?? -1) ? target : null;
}
export const nextLogisticsStatus = (current: string, shipmentStatus: string) =>
  forwardOnly(current, SHIPMENT_TO_LOGISTICS[shipmentStatus], LOGISTICS_RANK, ['Delivered', 'Cancelled', 'Customs Hold']);
export const nextShipmentStatus = (current: string, logisticsStatus: string) =>
  forwardOnly(current, LOGISTICS_TO_SHIPMENT[logisticsStatus], SHIPMENT_RANK, ['Delivered', 'Cancelled']);

/** What a logistics plan still needs before goods may move. Empty array = ready. */
export function missingPlanFields(plan: Row | null): string[] {
  const missing: string[] = [];
  if (!plan || isBlank(plan.carrier)) missing.push('Carrier / transport provider');
  if (!plan || isBlank(plan.origin)) missing.push('Origin');
  if (!plan || isBlank(plan.destination)) missing.push('Destination');
  if (!plan || (isBlank(plan.pickup_date) && isBlank(plan.estimated_departure_date))) missing.push('Pickup date or Estimated departure');
  return missing;
}

export function assertPlanReady(plan: Row | null, shipmentNumber: string): void {
  const missing = missingPlanFields(plan);
  if (missing.length === 0) return;
  throw new AppError(
    422,
    'LOGISTICS_PLAN_INCOMPLETE',
    `Shipment ${shipmentNumber} cannot start moving yet. Complete its Logistics plan first - missing: ${missing.join(', ')}.`,
  );
}

// Shipment column -> Logistics column, for values the plan should start with. Filled only where the plan is blank,
// so anything typed on the Logistics page is never overwritten.
const COPY_FROM_SHIPMENT: Array<[string, string]> = [
  ['deal_number', 'deal_number'], ['customer_name', 'customer_name'], ['supplier_name', 'supplier_name'],
  ['product_name', 'product_name'], ['quantity', 'quantity'], ['unit', 'unit'],
  ['origin', 'origin'], ['destination', 'destination'], ['transporter', 'carrier'], ['shipping_mode', 'shipping_mode'],
  ['tracking_number', 'tracking_number'], ['vehicle_container_number', 'vehicle_container_number'],
  ['expected_delivery_date', 'estimated_arrival_date'], ['freight_cost', 'freight_cost'],
];

function copiedFromShipment(shipment: Row): Row {
  const out: Row = {};
  for (const [from, to] of COPY_FROM_SHIPMENT) if (!isBlank(shipment[from])) out[to] = shipment[from];
  return out;
}

async function findPlan(org: string, shipmentNumber: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin
    .from('trading_logistics').select('*')
    .eq('organization_id', org).eq('shipment_number', shipmentNumber).limit(1).maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

/**
 * Makes sure the shipment has a Logistics plan. Creates one (status "Planned") when missing; when it already
 * exists, only its blank fields are filled from the shipment. Never throws - returns null if it could not.
 */
export async function ensureLogisticsPlan(org: string, shipment: Row): Promise<Row | null> {
  try {
    const shipmentNumber = text(shipment.shipment_number);
    if (!shipmentNumber) return null;
    const existing = await findPlan(org, shipmentNumber);
    const copied = copiedFromShipment(shipment);
    if (existing) {
      const blanks = Object.fromEntries(Object.entries(copied).filter(([key]) => isBlank(existing[key])));
      if (Object.keys(blanks).length === 0) return existing;
      const { data, error } = await supabaseAdmin
        .from('trading_logistics').update(blanks).eq('organization_id', org).eq('id', existing.id as string).select().maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? existing;
    }
    const { error } = await supabaseAdmin.from('trading_logistics').insert({
      organization_id: org,
      industry_type_id: shipment.industry_type_id ?? null,
      logistics_number: `LOG-${shipmentNumber.replace(/^SHP-/, '')}`,
      shipment_number: shipmentNumber,
      ...copied,
      status: 'Planned',
      notes: `Plan created automatically for shipment ${shipmentNumber}. Fill in the carrier, route and dates before it ships.`,
    });
    if (error && error.code !== '23505') throw error;
    return await findPlan(org, shipmentNumber);
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Ensuring the logistics plan failed');
    return null;
  }
}

/**
 * Called after a shipment is saved: makes sure a plan exists and moves the plan's status/dates forward to match.
 * Runs for every shipment save, so older shipments that never had a plan get one the next time they are touched.
 */
export async function syncLogisticsFromShipment(org: string, shipment: Row): Promise<void> {
  try {
    const plan = await ensureLogisticsPlan(org, shipment);
    if (!plan) return;
    const status = text(shipment.status);
    const patch: Row = {};
    const next = nextLogisticsStatus(text(plan.status), status);
    if (next) patch.status = next;
    if (['Dispatched', 'In Transit', 'At Destination', 'Delivered'].includes(status) && isBlank(plan.actual_departure_date)) patch.actual_departure_date = today();
    if (status === 'Delivered' && isBlank(plan.actual_delivery_date)) patch.actual_delivery_date = shipment.actual_delivery_date ?? today();
    if (Object.keys(patch).length === 0) return;
    const { error } = await supabaseAdmin.from('trading_logistics').update(patch).eq('organization_id', org).eq('id', plan.id as string);
    if (error) throw error;
  } catch (error) {
    logger.error({ err: error, shipmentNumber: shipment.shipment_number }, 'Syncing logistics from the shipment failed');
  }
}