-- Field-truth verification: retain GPS distance and geofence result for every check-in.
alter table public.field_visits
  add column check_in_distance_meters numeric(12,2),
  add column check_in_within_geofence boolean,
  add column check_out_distance_meters numeric(12,2),
  add column check_out_within_geofence boolean;

create index field_visits_geofence_idx on public.field_visits(organization_id, check_in_within_geofence, check_in_time desc);
