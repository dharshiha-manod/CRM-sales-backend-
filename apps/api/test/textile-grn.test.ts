import { describe, expect, it } from 'vitest';
import { overReceivedLines, poStatusFromReceipts, rpcError } from '../src/lib/textile-grn.js';

const line = (quantity: number, received: number) => ({ quantity, received_quantity: received });

describe('textile purchase order status', () => {
  it('is Ordered when nothing is received', () => expect(poStatusFromReceipts([line(100, 0)], 0)).toBe('Ordered'));
  it('is Partially Received when a line is short', () => expect(poStatusFromReceipts([line(100, 40), line(50, 50)], 0)).toBe('Partially Received'));
  it('is Received when every line is complete', () => expect(poStatusFromReceipts([line(100, 100), line(50, 50)], 0)).toBe('Received'));
  it('counts a line within the short-delivery tolerance as complete', () => expect(poStatusFromReceipts([line(100, 96)], 5)).toBe('Received'));
  it('does not count a line outside the tolerance as complete', () => expect(poStatusFromReceipts([line(100, 90)], 5)).toBe('Partially Received'));
});

describe('textile over-receipt check', () => {
  it('allows receiving up to the ordered quantity', () => expect(overReceivedLines([line(100, 60)], new Map([[0, 40]]), 0)).toEqual([]));
  it('blocks receiving more than ordered', () => expect(overReceivedLines([line(100, 60)], new Map([[0, 41]]), 0)).toEqual([0]));
  it('allows the extra metres the tolerance permits', () => expect(overReceivedLines([line(100, 100)], new Map([[0, 5]]), 5)).toEqual([]));
  it('flags a line that does not exist', () => expect(overReceivedLines([line(100, 0)], new Map([[3, 1]]), 0)).toEqual([3]));
});

describe('database error mapping', () => {
  it('maps over-receipt to 400', () => expect(rpcError({ message: 'OVER_RECEIPT: too much' }).statusCode).toBe(400));
  it('maps a unique violation to 409', () => expect(rpcError({ code: '23505', message: 'dup' }).statusCode).toBe(409));
  it('maps an unknown error to 500', () => expect(rpcError({ message: 'boom' }).statusCode).toBe(500));
});