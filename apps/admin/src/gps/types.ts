// Types for the GPS Verify & Tracking page (GpsTrackingPage.tsx).
// NOTE: this file used to hold a stray copy of settings/types.ts, which is why these types were missing.

export type GpsMatchStatus = 'verified' | 'mismatch' | 'no_data';
export type RepFieldStatus = 'at_client' | 'on_field' | 'checked_out' | 'offline';

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface TrackingSession {
  id: string;
  repId: string;
  repName: string;
  /** YYYY-MM-DD in the business timezone */
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
