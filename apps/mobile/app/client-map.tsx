import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Button, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { distanceMeters, formatDistance } from '../src/lib/geo';
import { getCurrentLocation, type GpsReading } from '../src/lib/location';

export default function ClientMapScreen() {
  const { clientName, latitude: latitudeParam, longitude: longitudeParam } = useLocalSearchParams<{ clientName?: string; latitude?: string; longitude?: string }>();
  const latitude = Number(latitudeParam);
  const longitude = Number(longitudeParam);
  const hasClientLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const [repLocation, setRepLocation] = useState<GpsReading | null>(null);
  const [locationError, setLocationError] = useState('');
  const [loadingLocation, setLoadingLocation] = useState(hasClientLocation);
  const map = useRef<MapView>(null);

  useEffect(() => {
    if (!hasClientLocation) return;
    let cancelled = false;
    async function loadRepLocation() {
      try {
        const location = await getCurrentLocation();
        if (!cancelled) setRepLocation(location);
      } catch (cause) {
        if (!cancelled) setLocationError(cause instanceof Error ? cause.message : 'Could not get your current location.');
      } finally {
        if (!cancelled) setLoadingLocation(false);
      }
    }
    void loadRepLocation();
    return () => { cancelled = true; };
  }, [hasClientLocation]);

  useEffect(() => {
    if (!repLocation) return;
    map.current?.fitToCoordinates([
      { latitude, longitude },
      { latitude: repLocation.latitude, longitude: repLocation.longitude },
    ], { edgePadding: { top: 80, right: 48, bottom: 80, left: 48 }, animated: true });
  }, [latitude, longitude, repLocation]);

  async function openDirections() {
    if (!hasClientLocation) return;
    const url = Platform.select({
      ios: `maps://app?daddr=${latitude},${longitude}`,
      android: `geo:0,0?q=${latitude},${longitude}`,
    });
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      setLocationError('Could not open your device maps app.');
    }
  }

  if (!hasClientLocation) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}><Button title="Back" onPress={() => router.back()} /><Text style={styles.title}>Client location</Text></View>
        <Text style={styles.error}>This client does not have a registered GPS location.</Text>
      </SafeAreaView>
    );
  }

  const clientLocation = { latitude, longitude };
  const distance = repLocation ? distanceMeters(repLocation, clientLocation) : null;
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Button title="Back" onPress={() => router.back()} />
        <View style={styles.headingText}><Text style={styles.title} numberOfLines={1}>{clientName ?? 'Client location'}</Text><Text style={styles.subtitle}>Check your distance before checking in</Text></View>
      </View>
      <MapView ref={map} style={styles.map} initialRegion={{ ...clientLocation, latitudeDelta: 0.015, longitudeDelta: 0.015 }}>
        <Marker coordinate={clientLocation} title={clientName ?? 'Client'} description="Registered client location" pinColor="#dc2626" />
        {repLocation ? <Marker coordinate={repLocation} title="Your location" description="Current device location" pinColor="#2563eb" /> : null}
      </MapView>
      <View style={styles.details}>
        {loadingLocation ? <View style={styles.loadingRow}><ActivityIndicator /><Text>Getting your current location…</Text></View> : null}
        {distance != null ? <Text style={styles.distance}>You are {formatDistance(distance)} from this client.</Text> : null}
        {locationError ? <Text style={styles.error}>{locationError}</Text> : null}
        <Button title="Get Directions" onPress={() => void openDirections()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  headingText: { flex: 1 },
  title: { fontSize: 19, fontWeight: '700' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: 2 },
  map: { flex: 1, minHeight: 320 },
  details: { backgroundColor: '#fff', padding: 16, gap: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distance: { color: '#0f172a', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c', padding: 16 },
});
