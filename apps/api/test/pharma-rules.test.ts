import { describe, expect, it } from 'vitest';
import { daysLeft, expiryStatus, isBatchBlocked, isSellable, licenseProblem, statusMoveProblem } from '../src/lib/pharma-rules.js';

const T = '2026-10-28';
describe('pharma expiry status', () => {
  it('classifies by days left', () => {
    expect(expiryStatus('2026-10-27', T)).toBe('Expired');
    expect(expiryStatus('2026-10-28', T)).toBe('Critical Expiry');
    expect(expiryStatus('2026-11-27', T)).toBe('Critical Expiry'); // 30 days
    expect(expiryStatus('2026-11-28', T)).toBe('Expiring Soon');   // 31 days
    expect(expiryStatus('2027-01-26', T)).toBe('Expiring Soon');   // 90 days
    expect(expiryStatus('2027-01-27', T)).toBe('Valid');           // 91 days
    expect(expiryStatus(null, T)).toBe('Valid');
  });
  it('counts days', () => { expect(daysLeft('2026-11-02', T)).toBe(5); expect(daysLeft('', T)).toBeNull(); });
});
describe('pharma batch blocking', () => {
  it('blocks expired, recalled and quarantined batches', () => {
    expect(isBatchBlocked({ status: 'Recalled', expiry_date: '2030-01-01' }, T)).toBe(true);
    expect(isBatchBlocked({ status: 'Quarantined', expiry_date: '2030-01-01' }, T)).toBe(true);
    expect(isBatchBlocked({ status: 'Valid', expiry_date: '2026-10-01' }, T)).toBe(true);
    expect(isBatchBlocked({ status: 'Valid', expiry_date: '2030-01-01' }, T)).toBe(false);
  });
  it('honours the minimum days before expiry', () => {
    expect(isSellable({ status: 'Critical Expiry', expiry_date: '2026-11-10' }, T, 0)).toBe(true);
    expect(isSellable({ status: 'Critical Expiry', expiry_date: '2026-11-10' }, T, 30)).toBe(false);
    expect(isSellable({ status: 'Recalled', expiry_date: '2030-01-01' }, T, 0)).toBe(false);
  });
});
describe('pharma customer drug licence', () => {
  it('flags an expired licence', () => {
    expect(licenseProblem({ drugLicenseNumber: 'DL-123', licenseValidTill: '2026-10-27' }, T)).toContain('expired on 2026-10-27');
  });
  it('allows a valid licence, one expiring today, or no validity date recorded', () => {
    expect(licenseProblem({ licenseValidTill: '2026-10-28' }, T)).toBeNull();
    expect(licenseProblem({ licenseValidTill: '2027-01-01' }, T)).toBeNull();
    expect(licenseProblem({ drugLicenseNumber: 'DL-123' }, T)).toBeNull();
    expect(licenseProblem(null, T)).toBeNull();
  });
});
describe('pharma status locks', () => {
  it('does not let closed work be re-opened', () => {
    expect(statusMoveProblem('pharma_recalls', 'Closed', 'Created')).not.toBeNull();
    expect(statusMoveProblem('pharma_medicine_returns', 'Rejected', 'Approved')).not.toBeNull();
    expect(statusMoveProblem('pharma_promotions', 'Cancelled', 'Active')).not.toBeNull();
  });
  it('allows normal moves, same-status saves and calendar-completed campaigns to be edited', () => {
    expect(statusMoveProblem('pharma_recalls', 'Created', 'Closed')).toBeNull();
    expect(statusMoveProblem('pharma_recalls', 'Closed', 'Closed')).toBeNull();
    expect(statusMoveProblem('pharma_recalls', 'Closed', undefined)).toBeNull();
    expect(statusMoveProblem('pharma_promotions', 'Completed', 'Active')).toBeNull();
  });
});

import { licenseDaysLeft } from '../src/lib/pharma-rules.js';
describe('licenseDaysLeft', () => {
  it('counts days to the licence expiry and is negative once expired', () => {
    expect(licenseDaysLeft({ licenseValidTill: '2026-11-09' }, '2026-10-30')).toBe(10);
    expect(licenseDaysLeft({ licenseValidTill: '2026-10-20' }, '2026-10-30')).toBe(-10);
  });
  it('returns null when no validity date is recorded', () => {
    expect(licenseDaysLeft({}, '2026-10-30')).toBeNull();
    expect(licenseDaysLeft(null, '2026-10-30')).toBeNull();
  });
});
