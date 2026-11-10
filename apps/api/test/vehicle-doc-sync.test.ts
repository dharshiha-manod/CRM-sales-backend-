import { describe, expect, it } from 'vitest';
import { autoTickChecklist, INSURANCE_DOC, LOAN_DOC } from '../src/lib/vehicle-doc-sync.js';
import type { DeliveryDoc } from '../src/lib/vehicle-documents.js';

const doc = (name: string, status: DeliveryDoc['status'] = 'Pending'): DeliveryDoc => ({ name, status, received_date: null, remarks: null });

describe('autoTickChecklist', () => {
  it('ticks insurance and loan papers that the system already holds', () => {
    const r = autoTickChecklist([doc('Tax invoice'), doc(INSURANCE_DOC), doc(LOAN_DOC)], { insurancePolicy: 'INS-2026-0001', loanApplication: 'FIN-2026-0002' }, '2026-11-10');
    expect(r.changed).toBe(true);
    expect(r.docs.map((d) => d.status)).toEqual(['Pending', 'Received', 'Received']);
    expect(r.docs[1]!.received_date).toBe('2026-11-10');
    expect(r.docs[1]!.remarks).toContain('INS-2026-0001');
  });
  it('never changes a paper the user already set (Not Applicable / Received)', () => {
    const r = autoTickChecklist([doc(INSURANCE_DOC, 'Not Applicable'), doc(LOAN_DOC, 'Received')], { insurancePolicy: 'INS-1', loanApplication: 'FIN-1' }, '2026-11-10');
    expect(r.changed).toBe(false);
    expect(r.docs.map((d) => d.status)).toEqual(['Not Applicable', 'Received']);
  });
  it('does nothing without a policy / approved loan', () => {
    expect(autoTickChecklist([doc(INSURANCE_DOC), doc(LOAN_DOC)], { insurancePolicy: null, loanApplication: null }, '2026-11-10').changed).toBe(false);
  });
});