import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { FieldVisitPanel } from '../src/components/FieldVisitPanel';
import { WorkDayPanel } from '../src/components/WorkDayPanel';
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
  summary: { assignedClients: number; scheduledVisits: number; visitsToday?: number; pendingCollections: number; upcomingFollowUps: number };
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

  if (loading) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /></SafeAreaView>;
  if (!session) return <SignInScreen onSignedIn={refreshSession} />;

  const summary = dashboard?.summary;
  const name = dashboard?.representative.user_profiles?.display_name ?? 'Representative';
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{name.trim().charAt(0).toUpperCase()}</Text></View>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.title} numberOfLines={1}>{name}</Text>
          </View>
          <Pressable style={styles.signOut} onPress={() => void supabase.auth.signOut()} hitSlop={10} accessibilityLabel="Sign out">
            <Ionicons name="log-out-outline" size={22} color={colors.ink} />
          </Pressable>
        </View>

        {error ? <View style={styles.errorBox}><Ionicons name="cloud-offline-outline" size={18} color={colors.danger} /><Text style={styles.error}>{error}</Text></View> : null}

        <WorkDayPanel refreshKey={refreshKey} />

        <View style={styles.stats}>
          <Stat icon="people-outline" tone={colors.brand} soft={colors.brandSoft} label="Clients" value={summary?.assignedClients ?? 0} />
          <Stat icon="checkmark-done-outline" tone={colors.success} soft={colors.successSoft} label="Visits today" value={summary?.visitsToday ?? summary?.scheduledVisits ?? 0} />
          <Stat icon="wallet-outline" tone={colors.warn} soft={colors.warnSoft} label="Collections" value={summary?.pendingCollections ?? 0} />
          <Stat icon="notifications-outline" tone="#7c3aed" soft="#f5f3ff" label="Follow-ups" value={summary?.upcomingFollowUps ?? 0} />
        </View>

        <FieldVisitPanel clients={dashboard?.clients ?? []} refreshKey={refreshKey} onChanged={() => void refresh()} />

        <Pressable style={styles.stockLink} onPress={() => router.push('/stock' as never)} accessibilityRole="button">
          <View style={styles.stockIcon}><Ionicons name="cube-outline" size={22} color={colors.brand} /></View>
          <View style={styles.headerText}>
            <Text style={styles.stockTitle}>My stock &amp; requests</Text>
            <Text style={styles.stockMeta}>See what you carry and ask for more</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function Stat({ icon, tone, soft, label, value }: { icon: keyof typeof Ionicons.glyphMap; tone: string; soft: string; label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: soft }]}><Ionicons name={icon} size={16} color={tone} /></View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 19, fontWeight: '800' },
  headerText: { flex: 1 },
  greeting: { color: colors.muted, fontSize: 13 },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  signOut: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.card, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.md, alignItems: 'center', gap: 2, ...shadow },
  statIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.ink },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  stockLink: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, padding: 14, borderRadius: radius.lg, ...shadow },
  stockIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  stockTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  stockMeta: { color: colors.muted, fontSize: 13, marginTop: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12 },
  error: { flex: 1, color: colors.danger, fontWeight: '600', fontSize: 13 },
});
