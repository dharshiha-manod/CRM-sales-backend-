import { describe, expect, it } from 'vitest';
import { daysLeft, expiryStatus, isBatchBlocked, isSellable } from '../src/lib/pharma-rules.js';

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