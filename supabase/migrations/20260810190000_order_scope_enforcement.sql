-- Enforce that field sales orders and collections cannot cross organization, visit, client, or representative boundaries.
create or replace function public.enforce_sale_order_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.organization_id = new.organization_id) then raise exception 'Order client must belong to the same organization'; end if;
  if not exists (select 1 from public.sales_representatives r where r.id = new.representative_id and r.organization_id = new.organization_id) then raise exception 'Order representative must belong to the same organization'; end if;
  if new.visit_id is not null and not exists (select 1 from public.field_visits v where v.id = new.visit_id and v.organization_id = new.organization_id and v.client_id = new.client_id and v.representative_id = new.representative_id) then raise exception 'Order visit must belong to the same client and representative'; end if;
  return new;
end;
$$;

create trigger sale_orders_scope before insert or update on public.sale_orders for each row execute function public.enforce_sale_order_scope();

create or replace function public.enforce_sale_order_item_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.sale_orders o join public.products p on p.id = new.product_id where o.id = new.order_id and p.organization_id = o.organization_id) then raise exception 'Order item product must belong to the same organization'; end if;
  return new;
end;
$$;

create trigger sale_order_items_scope before insert or update on public.sale_order_items for each row execute function public.enforce_sale_order_item_scope();
