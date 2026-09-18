-- Step 8 of the Trading connectivity plan: persist the two-way link created
-- when a confirmed Sales Order automatically becomes a Shipment.
-- Keep these stored columns aligned with api/src/lib/trading-resources.ts.

alter table public.trading_sales_orders
  add column if not exists shipment_number text;

alter table public.trading_shipments
  add column if not exists order_number text;

create index if not exists trading_sales_orders_shipment_number_idx
  on public.trading_sales_orders (organization_id, shipment_number);

create index if not exists trading_shipments_order_number_idx
  on public.trading_shipments (organization_id, order_number);
