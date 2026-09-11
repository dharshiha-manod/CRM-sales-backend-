// Shared geographic calculations for the GPS Verify & Tracking module.
// Kept separate from UI components so the same math backs check-in
// verification, the map view, and tracking-history distance totals.

const EARTH_RADIUS_METERS = 6371000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points using the Haversine
 * formula. Never use simple coordinate subtraction — degrees of longitude
 * shrink toward the poles, so a naive diff misrepresents real distance.
 * Returns meters.
 */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/** Sum of Haversine distances across a route's consecutive points, in meters. */
export function routeDistanceMeters(points: Coordinates[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/** "42 m" for short distances, "4.8 km" beyond 1000 m. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export type AccuracyLevel = 'good' | 'acceptable' | 'low';

/** Good ≤15m, Acceptable ≤50m, Low beyond that — used to gate verification. */
export function accuracyLevel(accuracyMeters: number): AccuracyLevel {
  if (accuracyMeters <= 15) return 'good';
  if (accuracyMeters <= 50) return 'acceptable';
  return 'low';
}

export function accuracyLabel(accuracyMeters: number): string {
  const level = accuracyLevel(accuracyMeters);
  if (level === 'good') return 'Good';
  if (level === 'acceptable') return 'Acceptable';
  return 'Low accuracy';
}

/** A check-in/check-out within this many meters of the client's registered
 *  location counts as GPS-verified. Mirrors the default shown in
 *  Settings > Field Operations > GPS & Location (radiusMeters). */
export const DEFAULT_VERIFICATION_RADIUS_METERS = 100;