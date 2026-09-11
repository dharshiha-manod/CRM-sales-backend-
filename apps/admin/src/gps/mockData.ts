// GPS Verify & Tracking module constants. All fake/seeded rep, client and
// visit data has been removed — real data now comes from /field-visits,
// /field-visits/live, /clients and /sales-representatives (see gps/types.ts
// for the shapes those endpoints return, and geo.ts for the shared
// Haversine math this module uses).

export const DEFAULT_VERIFICATION_RADIUS_METERS = 100;