// Real, backend-shaped types for the GPS Verify & Tracking module.
// These describe what /field-visits, /field-visits/live, /clients and
// /sales-representatives actually return — no seeded/fake records live
// here anymore. See geo.ts for the shared Haversine math and the
// verification radius constant.

/** A rep's live field status, derived entirely from their visit records —
 *  this app has no separate "online/offline" presence channel. */
export type RepFieldStatus = 'at_client' | 'on_field' | 'checked_out' | 'offline';

/** Whether a check-in/check-out's coordinates fall inside the allowed
 *  radius of the client's registered location. 'no_data' means one or
 *  both coordinates are missing, not that verification failed. */
export type GpsMatchStatus = 'verified' | 'mismatch' | 'no_data';

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
}


/** One rep's day of field movement, built by grouping that rep's real
 *  visits by calendar date and connecting their actual check-in/check-out
 *  coordinates — not a simulated GPS trail. */
export interface TrackingSession {
  id: string;
  repId: string;
  repName: string;
  date: string;
  startTime: string;
  endTime: string | null;
  distanceKm: number;
  points: TrackingPoint[];
  visitsCount: number;
  verifiedCount: number;
  mismatchCount: number;
  trackingActive: boolean;
}