import { describe, expect, it } from 'vitest';
import { customsProblems, dispatchBlockMessage, documentProblems, paymentProblems } from '../src/lib/dispatch-gates.js';

describe('document gate', () => {
  it('blocks missing and Draft documents, passes Verified ones', () => {
    expect(documentProblems([])).toEqual(['Commercial Invoice is missing', 'Packing List is missing']);
    const draft = [{ document_type: 'Commercial Invoice', document_number: 'CI-1', status: 'Draft' }, { document_type: 'Packing List', document_number: 'PL-1', status: 'Verified' }];
    expect(documentProblems(draft)).toHaveLength(1);
    expect(documentProblems(draft)[0]).toMatch(/Commercial Invoice CI-1 must be Verified/);
    expect(documentProblems([{ document_type: 'Commercial Invoice', status: 'Verified' }, { document_type: 'Packing List', verification_status: 'Verified' }])).toEqual([]);
  });
  it('does not count a Rejected document', () => {
    expect(documentProblems([{ document_type: 'Commercial Invoice', status: 'Rejected', verification_status: 'Rejected' }, { document_type: 'Packing List', status: 'Verified' }])).toEqual(['Commercial Invoice is missing']);
  });
});

describe('customs gate', () => {
  it('needs Cleared', () => {
    expect(customsProblems([{ customs_reference: 'CUS-1', clearance_status: 'Not Started' }])[0]).toMatch(/"Not Started"/);
    expect(customsProblems([{ customs_reference: 'CUS-1', clearance_status: 'Duty Paid' }])).toHaveLength(1);
    expect(customsProblems([{ customs_reference: 'CUS-1', clearance_status: 'Cleared' }])).toEqual([]);
    expect(customsProblems([])).toEqual([]);
  });
});

describe('payment gate', () => {
  it('waits for the LC to be issued', () => {
    expect(paymentProblems([{ instrument_type: 'Letter of Credit', lc_number: 'LC-9', status: 'Requested' }])).toHaveLength(1);
    expect(paymentProblems([{ instrument_type: 'Letter of Credit', status: 'Issued' }])).toEqual([]);
  });
  it('waits for the advance', () => {
    const base = { instrument_type: 'Advance Payment', finance_reference: 'TF-1', transaction_value: 1000, advance_percent: 30 };
    expect(paymentProblems([{ ...base, collected_amount: 100 }])).toHaveLength(1);
    expect(paymentProblems([{ ...base, collected_amount: 300 }])).toEqual([]);
    expect(paymentProblems([{ ...base, advance_percent: undefined, transaction_value: undefined, collected_amount: 0 }])).toHaveLength(1);
  });
  it('ignores cancelled arrangements and other instruments', () => {
    expect(paymentProblems([{ instrument_type: 'Letter of Credit', status: 'Cancelled' }, { instrument_type: 'Open Account' }])).toEqual([]);
  });
});

describe('message', () => {
  it('lists every problem', () => {
    expect(dispatchBlockMessage('SHP-1', ['a', 'b'])).toBe('Shipment SHP-1 cannot be dispatched yet. 1) a. 2) b.');
  });
});