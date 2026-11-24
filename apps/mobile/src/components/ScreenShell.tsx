import { type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadow } from '../lib/theme';

export function ScreenShell({ title, children, refreshing = false, onRefresh }: { title: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const cardStyles = StyleSheet.create({
  card: { backgroundColor: colors.card, padding: 14, borderRadius: 16, gap: 8, ...shadow },
  title: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 24 },
  error: { color: colors.danger, fontWeight: '600' },
  ok: { color: colors.success, fontWeight: '600' },
  warn: { color: colors.warn, fontWeight: '600' },
  label: { color: colors.ink, fontWeight: '700', marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 10, color: colors.ink, backgroundColor: '#fff' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: colors.ink },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', ...shadow },
  title: { fontSize: 20, fontWeight: '800', color: colors.ink },
  content: { padding: 18, paddingTop: 6, gap: 12, paddingBottom: 40 },
});