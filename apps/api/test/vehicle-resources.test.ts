import { describe, expect, it } from 'vitest';
import { VEHICLE_RESOURCES } from '../src/lib/vehicle-resources.js';

describe('vehicle resources', () => {
  it('has unique paths, tables and prefixes', () => {
    for (const k of ['path', 'table', 'prefix'] as const) {
      const v = VEHICLE_RESOURCES.map((r) => r[k]);
      expect(new Set(v).size).toBe(v.length);
    }
  });
  it('keeps code field, required fields and non-negative fields inside the column list', () => {
    for (const r of VEHICLE_RESOURCES) {
      expect(r.columns, r.path).toContain(r.codeField);
      for (const k of [...r.requiredFields, ...r.nonNegative]) expect(r.columns, `${r.path}.${k}`).toContain(k);
      expect(r.columns, r.path).toContain('industry_type_id');
      expect(r.statuses.length, r.path).toBeGreaterThan(0);
    }
  });
  it('links every record that names a customer to the Client (client_id)', () => {
    for (const r of VEHICLE_RESOURCES) {
      if (r.columns.includes('client_name')) expect(r.columns, r.path).toContain('client_id');
    }
  });
  it('lets a booking and delivery carry the Core order link', () => {
    for (const p of ['bookings', 'deliveries', 'finance-applications', 'exchanges', 'returns']) {
      expect(VEHICLE_RESOURCES.find((r) => r.path === p)!.columns, p).toContain('order_id');
    }
  });
});
