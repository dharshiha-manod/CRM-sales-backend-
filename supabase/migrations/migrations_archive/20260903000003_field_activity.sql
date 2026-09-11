-- 20260903000003_field_activity.sql
-- Field visit check-in/out, GPS pings, and in-visit activity notes.
-- Matches: field-activity.repository.ts, mobile-dashboard.repository.ts

create table field_visits (
  id                            uuid primary key default gen_random_uuid(),
  organization_id               uuid not null references organizations (id) on delete cascade,
  representative_id             uuid not null references sales_representatives (id) on delete cascade,
  client_id                     uuid references clients (id),
  unlisted_client_name          text,
  status                        text not null default 'checked_in' check (status in ('checked_in', 'in_progress', 'checked_out')),
  outcome                       text check (outcome in ('sale_made', 'follow_up_needed', 'no_interest', 'other')),
  notes                         text,
  check_in_time                 timestamptz not null default now(),
  check_in_lat                  double precision not null,
  check_in_lng                  double precision not null,
  check_in_accuracy_meters      double precision,
  check_in_distance_meters      double precision,
  check_in_within_geofence      boolean,
  check_out_time                timestamptz,
  check_out_lat                 double precision,
  check_out_lng                 double precision,
  check_out_accuracy_meters     double precision,
  check_out_distance_meters     double precision,
  check_out_within_geofence     boolean,
  check (client_id is not null or unlisted_client_name is not null)
);
create index idx_field_visits_org on field_visits (organization_id);
create index idx_field_visits_rep on field_visits (representative_id);
create index idx_field_visits_client on field_visits (client_id);
create index idx_field_visits_check_in_time on field_visits (check_in_time desc);
create index idx_field_visits_status on field_visits (status);

create table field_activity_pings (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  visit_id           uuid not null references field_visits (id) on delete cascade,
  representative_id  uuid not null references sales_representatives (id) on delete cascade,
  latitude           double precision not null,
  longitude          double precision not null,
  accuracy_meters    double precision,
  captured_at        timestamptz not null default now()
);
create index idx_pings_visit on field_activity_pings (visit_id);
create index idx_pings_captured_at on field_activity_pings (captured_at desc);

create table visit_activities (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  visit_id           uuid not null references field_visits (id) on delete cascade,
  representative_id  uuid not null references sales_representatives (id) on delete cascade,
  person_met         text,
  designation        text,
  purpose            text,
  requirements       text,
  expected_quantity  numeric(14, 2),
  expected_value     numeric(14, 2),
  notes              text,
  photo_url          text,
  created_at         timestamptz not null default now()
);
create index idx_visit_activities_visit on visit_activities (visit_id);