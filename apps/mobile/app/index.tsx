import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { FieldVisitPanel } from '../src/components/FieldVisitPanel';
import { StockRequestPanel } from '../src/components/StockRequestPanel';
import { WorkDayPanel } from '../src/components/WorkDayPanel';
import { AppButton } from '../src/components/AppButton';
import { SignInScreen } from '../src/components/SignInScreen';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { colors, radius, shadow } from '../src/lib/theme';

type Client = {
  id: string;
  client_code: string;
  client_name: string;
  client_type: string;
  phone?: string | null;
  city?: string | null;
  priority: string;
  latitude?: number | null;
  longitude?: number | null;
};
type Dashboard = {
  representative: { employee_code: string; user_profiles?: { display_name?: string | null } | null };
  summary: { assignedClients: number; scheduledVisits: number; pendingCollections: number; upcomingFollowUps: number };
  clients: Client[];
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const response = await api<{ data: Dashboard }>('/mobile/dashboard');
      setDashboard(response.data);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setLoading(false);
    if (data.session) await refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void refresh();
      else setDashboard(null);
    });
    return () => listener.subscription.unsubscribe();
  }, [refresh, refreshSession]);

  // Pull-to-refresh reloads the dashboard AND the visit / stock panels (they watch refreshKey).
  const pullToRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
    void refresh();
  }, [refresh]);

  function openClientMap(client: Client) {
    if (client.latitude == null || client.longitude == null) return;
    router.push({
      pathname: '/client-map',
      params: {
        clientName: client.client_name,
        latitude: String(client.latitude),
        longitude: String(client.longitude),
      },
    } as never);
  }

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!session) return <SignInScreen onSignedIn={refreshSession} />;

  const summary = dashboard?.summary;
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <FlatList
        data={dashboard?.clients ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        ListHeaderComponent={(
          <>
            <View style={styles.header}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(dashboard?.representative.user_profiles?.display_name ?? 'R').trim().charAt(0).toUpperCase()}</Text></View>
              <View style={styles.headerText}>
                <Text style={styles.greeting}>{greeting()}</Text>
                <Text style={styles.title} numberOfLines={1}>{dashboard?.representative.user_profiles?.display_name ?? 'Representative'}</Text>
                <Text style={styles.subtitle}>{dashboard?.representative.employee_code}</Text>
              </View>
              <Pressable style={styles.signOut} onPress={() => void supabase.auth.signOut()} hitSlop={10} accessibilityLabel="Sign out">
                <Ionicons name="log-out-outline" size={22} color={colors.ink} />
              </Pressable>
            </View>
            <View style={styles.cards}>
              <Metric icon="people-outline" tone={colors.brand} soft={colors.brandSoft} label="Assigned clients" value={summary?.assignedClients ?? 0} />
              <Metric icon="calendar-outline" tone={colors.success} soft={colors.successSoft} label="Visits today" value={summary?.scheduledVisits ?? 0} />
              <Metric icon="wallet-outline" tone={colors.warn} soft={colors.warnSoft} label="Collections" value={summary?.pendingCollections ?? 0} />
              <Metric icon="notifications-outline" tone="#7c3aed" soft="#f5f3ff" label="Follow-ups" value={summary?.upcomingFollowUps ?? 0} />
            </View>
            <WorkDayPanel refreshKey={refreshKey} />
            <FieldVisitPanel clients={dashboard?.clients ?? []} refreshKey={refreshKey} onChanged={() => void refresh()} />
            <StockRequestPanel refreshKey={refreshKey} />
            <Text style={styles.sectionTitle}>Assigned clients</Text>
            {error ? <View style={styles.errorBox}><Ionicons name="cloud-offline-outline" size={18} color={colors.danger} /><Text style={styles.error}>{error}</Text></View> : null}
          </>
        )}
        renderItem={({ item }) => (
          <View style={styles.client}>
            <View style={styles.clientHeading}>
              <View style={styles.clientInitial}><Text style={styles.clientInitialText}>{item.client_name.trim().charAt(0).toUpperCase()}</Text></View>
              <View style={styles.clientInfo}>
                <Text style={styles.clientName} numberOfLines={1}>{item.client_name}</Text>
                <Text style={styles.clientMeta}>{item.client_type} · {item.city ?? 'Location not set'}</Text>
              </View>
              <View style={[styles.badge, item.priority === 'high' && styles.badgeHigh]}>
                <Text style={[styles.badgeText, item.priority === 'high' && styles.badgeTextHigh]}>{item.priority}</Text>
              </View>
            </View>
            <View style={styles.clientFooter}>
              <View style={styles.phoneRow}>
                <Ionicons name="call-outline" size={16} color={colors.muted} />
                <Text style={styles.clientMeta}>{item.phone ?? 'No phone'}</Text>
              </View>
              <AppButton
                title={item.latitude != null && item.longitude != null ? 'View on map' : 'Location not set'}
                variant="secondary"
                onPress={() => openClientMap(item)}
                disabled={item.latitude == null || item.longitude == null}
                style={styles.mapButton}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={!error ? <Text style={styles.empty}>No active client assignments yet.</Text> : null}
        contentContainerStyle={styles.content}
      />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function Metric({ icon, tone, soft, label, value }: { icon: keyof typeof Ionicons.glyphMap; tone: string; soft: string; label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <View style={[styles.metricIcon, { backgroundColor: soft }]}><Ionicons name={icon} size={20} color={tone} /></View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 18, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerText: { flex: 1 },
  greeting: { color: colors.muted, fontSize: 13 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 1 },
  signOut: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  metric: { width: '47.5%', backgroundColor: colors.card, padding: 14, borderRadius: radius.lg, gap: 2, ...shadow },
  metricIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  metricValue: { fontSize: 26, fontWeight: '800', color: colors.ink },
  metricLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 8, marginBottom: 2 },
  client: { backgroundColor: colors.card, padding: 14, borderRadius: radius.lg, gap: 12, ...shadow },
  clientHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  clientInitial: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  clientInitialText: { color: colors.brand, fontSize: 18, fontWeight: '800' },
  clientInfo: { flex: 1 },
  clientName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  clientMeta: { color: colors.muted, fontSize: 13, marginTop: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#f1f5f9' },
  badgeHigh: { backgroundColor: colors.dangerSoft },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'capitalize' },
  badgeTextHigh: { color: colors.danger },
  clientFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  mapButton: { minHeight: 38, paddingVertical: 6 },
  empty: { color: colors.muted },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, marginBottom: 6 },
  error: { flex: 1, color: colors.danger, fontWeight: '600', fontSize: 13 },
});