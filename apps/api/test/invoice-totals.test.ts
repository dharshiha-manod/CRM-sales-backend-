import { describe, expect, it } from 'vitest';
import { computeInvoiceTotals } from '../src/lib/invoice-totals.js';

describe('computeInvoiceTotals', () => {
  it('adds tax and leaves the full total as balance when nothing is paid', () => {
    expect(computeInvoiceTotals({ subtotal: 95000, tax_percent: 10, paid_amount: 0, status: 'Sent', due_date: '2099-01-01' }, '2026-10-13'))
      .toEqual({ tax_amount: 9500, total_amount: 104500, balance_amount: 104500, status: 'Sent' });
  });
  it('marks Partially Paid and then Paid', () => {
    expect(computeInvoiceTotals({ subtotal: 1000, paid_amount: 400, status: 'Sent', due_date: '2099-01-01' }, '2026-10-13').status).toBe('Partially Paid');
    expect(computeInvoiceTotals({ subtotal: 1000, paid_amount: 1000, status: 'Sent' }, '2026-10-13').status).toBe('Paid');
  });
  it('marks Overdue after the due date while money is still owed', () => {
    expect(computeInvoiceTotals({ subtotal: 1000, paid_amount: 0, status: 'Sent', due_date: '2026-10-01' }, '2026-10-13').status).toBe('Overdue');
  });
  it('never overwrites Draft or Cancelled', () => {
    expect(computeInvoiceTotals({ subtotal: 1000, paid_amount: 1000, status: 'Draft' }, '2026-10-13').status).toBe('Draft');
    expect(computeInvoiceTotals({ subtotal: 1000, status: 'Cancelled' }, '2026-10-13').status).toBe('Cancelled');
  });
});
