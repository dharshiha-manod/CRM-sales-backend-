/** "42 m" for short distances, "4.8 km" beyond 1000 m. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type AccuracyLevel = 'good' | 'acceptable' | 'low';

/** Good <=15m, acceptable <=50m, low beyond that. */
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
