import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from './AppButton';
import { colors, radius, shadow } from '../lib/theme';
import {
  endWorkDay,
  flushQueue,
   getLastFlushError,
  getQueueSize,
  getSession,
  getTrackingMode,
  resumeTracking,
  startWorkDay,
  subscribeTracking,
  type TrackingMode,
  type WorkDaySession,
} from '../lib/tracking';

const elapsed = (sinceIso: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(sinceIso).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const MODE_TEXT: Record<TrackingMode, string> = {
  background: 'Tracking ON (works with screen off)',
  foreground: 'Tracking ON only while the app is open. Allow location "All the time" in app settings.',
  off: 'Tracking is OFF',
};

export function WorkDayPanel({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [day, setDay] = useState<WorkDaySession | null>(null);
  const [mode, setMode] = useState<TrackingMode>('off');
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [, forceTick] = useState(0);

  // Reads what this phone currently knows (no network call).
  const readLocal = useCallback(async () => {
    setDay(await getSession());
    setMode(await getTrackingMode());
    setQueued(await getQueueSize());
  }, []);

  // Syncs with the server and restarts recording if the day is still open.
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await resumeTracking();
      if (result.error) setError(result.error);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await readLocal();
      setLoading(false);
    }
  }, [readLocal]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => subscribeTracking(() => { void readLocal(); }), [readLocal]);
  useEffect(() => {
    const id = setInterval(() => { forceTick((current) => current + 1); void readLocal(); }, 30000);
    return () => clearInterval(id);
  }, [readLocal]);

  async function start() {
    setWorking(true);
    setError('');
    try {
      await startWorkDay();
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await readLocal();
      setWorking(false);
    }
  }

  async function end() {
    setWorking(true);
    setError('');
    try {
      await endWorkDay();
      onChanged?.();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      await readLocal();
      setWorking(false);
    }
  }

  if (loading) return null;

  return (
    <View style={[styles.card, day ? styles.cardActive : null]}>
      <View style={styles.titleRow}>
        <View style={[styles.iconBox, day ? styles.iconBoxActive : null]}>
          <Ionicons name={day ? 'radio-button-on' : 'time-outline'} size={22} color={day ? colors.success : colors.brand} />
        </View>
        <View style={styles.titleText}>
          <Text style={styles.title}>{day ? 'Work day in progress' : 'Start your work day'}</Text>
          <Text style={styles.meta}>
            {day ? `Since ${new Date(day.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${elapsed(day.startedAt)}` : 'Your route is recorded until you end the day.'}
          </Text>
        </View>
      </View>

      {day ? (
        <>
          <View style={[styles.statusRow, mode === 'background' ? styles.statusOk : styles.statusWarn]}>
            <Ionicons name={mode === 'background' ? 'checkmark-circle' : 'warning'} size={18} color={mode === 'background' ? colors.success : colors.warn} />
            <Text style={mode === 'background' ? styles.ok : styles.warn}>{MODE_TEXT[mode]}</Text>
          </View>
          {queued > 0 ? (
            <View style={styles.queueRow}>
              <Ionicons name="cloud-upload-outline" size={18} color={colors.warn} />
              <Text style={[styles.warn, styles.queueText]}>{queued} location point{queued === 1 ? '' : 's'} waiting to upload</Text>
           <AppButton title="Upload now" variant="ghost" onPress={() => { void flushQueue().then(readLocal); }} style={styles.small} />
            </View>
          ) : null}
          {queued > 0 && getLastFlushError() ? (
            <Text style={styles.warn}>Upload error: {getLastFlushError()}</Text>
          ) : null}
          <AppButton title="End day" variant="danger" loading={working} disabled={working} onPress={() => void end()} />
        </>
      ) : (
        <AppButton title="Start day" loading={working} disabled={working} onPress={() => void start()} />
      )}
      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, padding: 16, borderRadius: radius.lg, gap: 12, marginBottom: 14, ...shadow },
  cardActive: { borderLeftWidth: 4, borderLeftColor: colors.success },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: colors.successSoft },
  titleText: { flex: 1 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md },
  statusOk: { backgroundColor: colors.successSoft },
  statusWarn: { backgroundColor: colors.warnSoft },
  ok: { flex: 1, color: colors.success, fontWeight: '600', fontSize: 13 },
  warn: { flex: 1, color: colors.warn, fontWeight: '600', fontSize: 13 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.warnSoft, padding: 10, borderRadius: radius.md },
  queueText: { flex: 1 },
  small: { minHeight: 32, paddingVertical: 4, paddingHorizontal: 8 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 10 },
  error: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '600' },
});