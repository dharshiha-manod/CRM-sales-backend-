import * as Location from 'expo-location';

export type GpsReading = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
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

/** Reads one fresh, high-accuracy foreground GPS position. */
export async function getCurrentLocation(): Promise<GpsReading> {
  await ensureLocationPermission();
  if (!(await Location.hasServicesEnabledAsync())) {
    throw new Error('Turn on device location (GPS) and try again.');
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
  };
}
