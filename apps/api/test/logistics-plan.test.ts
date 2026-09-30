import { describe, expect, it } from 'vitest';
import { MOVING_SHIPMENT_STATUSES, MOVING_LOGISTICS_STATUSES, STARTED_SHIPMENT_STATUSES, missingPlanFields, nextLogisticsStatus, nextShipmentStatus, assertPlanReady } from '../src/lib/logistics-plan.js';

describe('logistics plan readiness', () => {
  it('blocks an empty plan and lists what is missing', () => {
    expect(missingPlanFields({})).toEqual(['Carrier / transport provider', 'Origin', 'Destination', 'Pickup date or Estimated departure']);
    expect(() => assertPlanReady(null, 'SHP-1')).toThrow(/missing: Carrier/);
  });
  it('accepts a complete plan (pickup or estimated departure date)', () => {
    const plan = { carrier: 'VRL', origin: 'Nagercoil', destination: 'Chennai' };
    expect(missingPlanFields({ ...plan, pickup_date: '2026-10-01' })).toEqual([]);
    expect(missingPlanFields({ ...plan, estimated_departure_date: '2026-10-01' })).toEqual([]);
    expect(missingPlanFields(plan)).toEqual(['Pickup date or Estimated departure']);
    expect(missingPlanFields({ ...plan, carrier: '  ', pickup_date: '2026-10-01' })).toEqual(['Carrier / transport provider']);
  });
});
describe('status sync is forward-only', () => {
  it('shipment -> logistics', () => {
    expect(nextLogisticsStatus('Planned', 'Dispatched')).toBe('Dispatched');
    expect(nextLogisticsStatus('Pickup Scheduled', 'In Transit')).toBe('In Transit');
    expect(nextLogisticsStatus('In Transit', 'Dispatched')).toBeNull();      // never backwards
    expect(nextLogisticsStatus('Delivered', 'In Transit')).toBeNull();       // finished stays finished
    expect(nextLogisticsStatus('Cancelled', 'Delivered')).toBeNull();
    expect(nextLogisticsStatus('Customs Hold', 'Delivered')).toBeNull();     // manual hold is respected
    expect(nextLogisticsStatus('In Transit', 'Delayed')).toBe('Delayed');
    expect(nextLogisticsStatus('Delayed', 'Delivered')).toBe('Delivered');
    expect(nextLogisticsStatus('Planned', 'Ready to Ship')).toBeNull();      // not a movement yet
  });
  it('logistics -> shipment', () => {
    expect(nextShipmentStatus('Ready to Ship', 'Picked Up')).toBe('Dispatched');
    expect(nextShipmentStatus('Planned', 'Dispatched')).toBe('Dispatched');
    expect(nextShipmentStatus('Dispatched', 'Out for Delivery')).toBe('At Destination');
    expect(nextShipmentStatus('At Destination', 'Delivered')).toBe('Delivered');
    expect(nextShipmentStatus('In Transit', 'Picked Up')).toBeNull();
    expect(nextShipmentStatus('Delivered', 'In Transit')).toBeNull();
    expect(nextShipmentStatus('Ready to Ship', 'Pickup Scheduled')).toBeNull();
    expect(nextShipmentStatus('Ready to Ship', 'Planned')).toBeNull();
  });
});
describe('the plan check covers Delivered too', () => {
  it('gates a jump straight to Delivered, but not a shipment that already started', () => {
    expect(MOVING_SHIPMENT_STATUSES.has('Delivered')).toBe(true);
    expect(MOVING_LOGISTICS_STATUSES.has('Delivered')).toBe(true);
    // Planned / Ready to Ship have not started, so moving them to Delivered is checked.
    expect(STARTED_SHIPMENT_STATUSES.has('Planned')).toBe(false);
    expect(STARTED_SHIPMENT_STATUSES.has('Ready to Ship')).toBe(false);
    // Dispatched -> Delivered is a normal finish and is not checked again.
    expect(STARTED_SHIPMENT_STATUSES.has('Dispatched')).toBe(true);
  });
});