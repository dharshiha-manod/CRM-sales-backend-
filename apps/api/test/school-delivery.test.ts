import { beforeEach, describe, expect, it, vi } from 'vitest';

let order: Record<string, unknown> | null;
let claimRows: unknown[] = [{ id: 'o1' }]; // what the "claim the step" update returns: 0 rows = someone else already moved the order
const calls: string[] = [];
vi.mock('../src/lib/stock.js', () => ({ takeStockForOrder: vi.fn(async () => { calls.push('take'); }), releaseStockForOrder: vi.fn(async () => { calls.push('release'); }) }));
vi.mock('../src/lib/order-completion.js', () => ({ completeOrderIfSettled: vi.fn(async () => { calls.push('complete'); return false; }) }));
vi.mock('../src/lib/supabase.js', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'update']) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: claimRows, error: null });
    c.maybeSingle = async () => ({ data: order, error: null });
    c.single = async () => ({ data: { ...order, saved: true }, error: null });
    return c;
  };
  return { supabaseAdmin: { from: () => chain() } };
});

const { updateSchoolDelivery } = await import('../src/repositories/school.repository.js');
const stock = await import('../src/lib/stock.js');
const base = { id: 'o1', status: 'confirmed', dispatch_status: 'pending', clients: { industry_type_id: 'school-1' } };

describe('School delivery', () => {
  beforeEach(() => { calls.length = 0; order = { ...base }; claimRows = [{ id: 'o1' }]; });
  it('dispatch takes stock', async () => {
    await updateSchoolDelivery('org', 'school-1', 'o1', { status: 'dispatched' });
    expect(calls).toEqual(['take']);
  });
  it('delivered needs a receiver name', async () => {
    order = { ...base, dispatch_status: 'dispatched' };
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'delivered' })).rejects.toMatchObject({ code: 'RECEIVER_REQUIRED' });
    await updateSchoolDelivery('org', 'school-1', 'o1', { status: 'delivered', receivedBy: 'Principal' });
    expect(calls).toEqual(['complete']);
  });
  it('undoing a dispatch gives stock back; delivered cannot be undone; cannot skip dispatch', async () => {
    order = { ...base, dispatch_status: 'dispatched' };
    await updateSchoolDelivery('org', 'school-1', 'o1', { status: 'pending' });
    expect(calls).toEqual(['release']);
    order = { ...base, dispatch_status: 'delivered' };
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'pending' })).rejects.toMatchObject({ code: 'INVALID_DELIVERY_STEP' });
    order = { ...base };
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'delivered', receivedBy: 'x' })).rejects.toMatchObject({ code: 'INVALID_DELIVERY_STEP' });
  });
  it('a lost race changes nothing: stock is never taken twice', async () => {
    claimRows = [];
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'dispatched' })).rejects.toMatchObject({ code: 'DELIVERY_CHANGED' });
    expect(calls).toEqual([]);
  });
  it('short stock gives the claimed step back and surfaces the stock error', async () => {
    vi.mocked(stock.takeStockForOrder).mockRejectedValueOnce(Object.assign(new Error('short'), { code: 'INSUFFICIENT_STOCK' }));
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'dispatched' })).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(calls).toEqual([]);
  });
  it('refuses another industry order and unconfirmed orders', async () => {
    order = { ...base, clients: { industry_type_id: 'other' } };
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'dispatched' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    order = { ...base, status: 'pending_approval' };
    await expect(updateSchoolDelivery('org', 'school-1', 'o1', { status: 'dispatched' })).rejects.toMatchObject({ code: 'ORDER_NOT_CONFIRMED' });
    expect(calls).toEqual([]);
  });
});