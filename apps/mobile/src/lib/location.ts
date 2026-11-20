import * as Location from 'expo-location';

export type GpsReading = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  mocked?: boolean;
};

/** Requests foreground permission when it has not already been granted. */
export async function ensureLocationPermission(): Promise<void> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.status === 'granted') return;

  const requested = await Location.requestForegroundPermissionsAsync();
  if (requested.status !== 'granted') {
    throw new Error('Location permission is required to check in. Enable it in your device settings and try again.');
  }
}

/**
 * Waits for a good GPS fix (up to maxWaitMs) and returns the most accurate one.
 * Stops early as soon as the accuracy is better than targetAccuracyMeters.
 */
export async function getCurrentLocation(options?: { targetAccuracyMeters?: number; maxWaitMs?: number; onProgress?: (accuracyMeters: number | null) => void }): Promise<GpsReading> {
  await ensureLocationPermission();
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Turn on device location (GPS) and try again.');
  }
  const target = options?.targetAccuracyMeters ?? 25;
  const maxWait = options?.maxWaitMs ?? 20000;

  return new Promise<GpsReading>((resolve, reject) => {
    let best: Location.LocationObject | null = null;
    let done = false;
    let subscription: Location.LocationSubscription | null = null;
    const accuracyOf = (p: Location.LocationObject) => p.coords.accuracy ?? Number.POSITIVE_INFINITY;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription?.remove();
      if (best) {
        resolve({
          latitude: best.coords.latitude,
          longitude: best.coords.longitude,
          accuracyMeters: best.coords.accuracy,
          mocked: (best as { mocked?: boolean }).mocked === true,
        });
      } else {
        reject(new Error('Could not get a GPS fix. Move to open sky and try again.'));
      }
    };
    const timer = setTimeout(finish, maxWait);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (position) => {
        if (!best || accuracyOf(position) < accuracyOf(best)) best = position;
        options?.onProgress?.(position.coords.accuracy ?? null);
        if (accuracyOf(position) <= target) finish();
      },
    ).then((sub) => {
      subscription = sub;
      if (done) sub.remove();
    }).catch((cause) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(cause);
    });
  });
}