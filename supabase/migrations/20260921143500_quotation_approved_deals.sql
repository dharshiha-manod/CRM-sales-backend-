-- An approved quotation is the source of exactly one Trading Deal. These
-- references make the automation traceable and prevent duplicate deals when
-- an approval request is retried.
alter table public.trading_deals
  add column if not exists industry_type_id uuid references public.industry_types(id) on delete restrict,
  add column if not exists customer_id uuid references public.clients(id) on delete set null,
  add column if not exists requirement_id uuid references public.requirements(id) on delete set null,
  add column if not exists quotation_id uuid references public.quotations(id) on delete set null;

create index if not exists trading_deals_industry_type_idx on public.trading_deals (industry_type_id);
create unique index if not exists trading_deals_quotation_unique_idx
  on public.trading_deals (organization_id, quotation_id)
  where quotation_id is not null;

-- Bring already-approved/converted quotations into the same workflow. The
-- partial unique index above makes this safe to run once during deployment or
-- again if a migration is retried.
insert into public.trading_deals (
  organization_id, industry_type_id, quotation_id, requirement_id,
  deal_number, deal_name, customer_id, customer_name,
  product_name, product_category, quantity, purchase_rate, selling_rate,
  currency, deal_date, priority, status, notes
)
select
  q.organization_id,
  c.industry_type_id,
  q.id,
  q.requirement_id,
  'DEAL-' || regexp_replace(q.quotation_number, '^QT-', ''),
  'Deal — ' || q.quotation_number,
  q.client_id,
  coalesce(c.client_name, 'Customer'),
  item.product_name,
  item.category,
  item.quantity,
  item.cost_price,
  item.unit_price,
  'INR',
  current_date,
  'Medium',
  'Confirmed',
  'Automatically created from approved quotation ' || q.quotation_number || '.'
from public.quotations q
join public.clients c on c.id = q.client_id
left join lateral (
  select qi.quantity, qi.unit_price, p.product_name, p.category, p.cost_price
  from public.quotation_items qi
  join public.products p on p.id = qi.product_id
  where qi.quotation_id = q.id
  order by qi.created_at, qi.id
  limit 1
) item on true
where q.status in ('accepted', 'converted')
on conflict (organization_id, quotation_id) where quotation_id is not null do nothing;
