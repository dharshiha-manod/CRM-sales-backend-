import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from './supabase.js';
import { collectionBase, orderBase } from './fmcg-market.js';

export type ClientCredit = {
  clientName: string;
  /** null = no limit set for this client */
  creditLimit: number | null;
  creditDays: number | null;
  /** Unpaid balance today: all non-cancelled orders minus everything the client has paid. */
  outstanding: number;
};

const rupees = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/**
 * Same outstanding figure the Clients page shows (orders that are not cancelled, minus the
 * client's collections), calculated on the server so every order path uses one number.
 */
export async function getClientCredit(organizationId: string, clientId: string): Promise<ClientCredit | null> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('client_name, credit_limit, credit_days')
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!client) return null;

  const [{ data: orders, error: ordersError }, { data: collections, error: collectionsError }, returnsRes] = await Promise.all([
    supabaseAdmin.from('sale_orders').select('total_amount, base_total').eq('organization_id', organizationId).eq('client_id', clientId).neq('status', 'cancelled'),
    supabaseAdmin.from('sales_collections').select('amount, sale_orders(exchange_rate)').eq('organization_id', organizationId).eq('client_id', clientId),
    supabaseAdmin.from('sales_returns').select('base_credit, sale_orders!inner(status)').eq('organization_id', organizationId).eq('client_id', clientId).eq('status', 'approved').neq('sale_orders.status', 'cancelled'),
  ]);
  if (ordersError) throw ordersError;
  if (collectionsError) throw collectionsError;

  // Approved returns / damage are credit notes: they lower what the client owes. (Before the returns table exists this is simply 0.)
  const credited = returnsRes.error ? 0 : (returnsRes.data ?? []).reduce((sum, row) => sum + Number((row as { base_credit?: unknown }).base_credit ?? 0), 0);
  const sales = (orders ?? []).reduce((sum, row) => sum + orderBase(row), 0);
  const paid = (collections ?? []).reduce((sum, row) => sum + collectionBase(row), 0);
  return {
    clientName: String(client.client_name ?? 'This client'),
    creditLimit: client.credit_limit == null ? null : Number(client.credit_limit),
    creditDays: client.credit_days == null ? null : Number(client.credit_days),
    outstanding: Math.max(0, sales - paid - credited),
  };
}

/**
 * Blocks a new order (or an increase to an existing one) when it would push the client's unpaid
 * balance above their Credit limit. A client without a credit limit is never blocked.
 * `additionalAmount` is only the NEW exposure: the full total for a new order, the increase for an edit.
 */
export async function assertWithinCreditLimit(organizationId: string, clientId: string | null | undefined, additionalAmount: number) {
  if (!clientId || !(additionalAmount > 0)) return;
  const credit = await getClientCredit(organizationId, clientId);
  if (!credit || credit.creditLimit == null) return;
  const after = credit.outstanding + additionalAmount;
  if (after > credit.creditLimit + 0.005) {
    const available = Math.max(0, credit.creditLimit - credit.outstanding);
    throw new AppError(
      422,
      'CREDIT_LIMIT_EXCEEDED',
      `Credit limit exceeded for ${credit.clientName}: limit ${rupees(credit.creditLimit)}, already unpaid ${rupees(credit.outstanding)}, this order ${rupees(additionalAmount)} (available credit ${rupees(available)}). Collect a payment or raise the client's credit limit first.`,
    );
  }
} 