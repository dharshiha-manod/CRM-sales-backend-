import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { api } from './api';
import { ensureLocationPermission, getCurrentLocation, type GpsReading } from './location';

export const TRACKING_TASK = 'field-sales-work-day-tracking';

// Tune these for battery vs. detail. One point per minute is enough for a route trail.
const TIME_INTERVAL_MS = 60000;
const BATCH_SIZE = 100;
const MAX_QUEUE = 5000;

const QUEUE_KEY = 'fs.tracking.queue';
const SESSION_KEY = 'fs.tracking.session';
const VISIT_KEY = 'fs.tracking.visitId';

export type TrackingMode = 'background' | 'foreground' | 'off';
export type WorkDaySession = { id: string; startedAt: string };
type QueuedPoint = {
  id: string;
  workDayId: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
  mocked: boolean;
  visitId: string | null;
};

// ── small helpers ──────────────────────────────────────────────
let lastFlushError = '';
export const getLastFlushError = () => lastFlushError;

const listeners = new Set<() => void>();
export const subscribeTracking = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach((listener) => listener());

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function loadQueue(): Promise<QueuedPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedPoint[]) : [];
  } catch { return []; }
}
const saveQueue = (queue: QueuedPoint[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));

export async function getSession(): Promise<WorkDaySession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as WorkDaySession) : null;
  } catch { return null; }
}
export async function getQueueSize(): Promise<number> { return (await loadQueue()).length; }

/** Tells the tracker which visit is open, so every GPS point is tagged with it. */
export async function setActiveVisitId(visitId: string | null): Promise<void> {
  if (visitId) await AsyncStorage.setItem(VISIT_KEY, visitId);
  else await AsyncStorage.removeItem(VISIT_KEY);
}

// ── queue: save every point on the phone first, upload when there is network ──
export async function enqueueLocations(locations: Location.LocationObject[]): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const visitId = await AsyncStorage.getItem(VISIT_KEY);
  const points: QueuedPoint[] = locations.map((location) => {
    const capturedAt = new Date(location.timestamp).toISOString();
    return {
      id: `${session.id}:${capturedAt}`,
      workDayId: session.id,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyMeters: location.coords.accuracy ?? null,
      capturedAt,
      mocked: (location as { mocked?: boolean }).mocked === true,
      visitId,
    };
  });
  await exclusive(async () => {
    const queue = await loadQueue();
    const known = new Set(queue.map((point) => point.id));
    const merged = [...queue, ...points.filter((point) => !known.has(point.id))];
    await saveQueue(merged.length > MAX_QUEUE ? merged.slice(merged.length - MAX_QUEUE) : merged);
  });
  await flushQueue();
}

// Server errors that will never succeed on retry: drop the batch instead of blocking the queue.
const PERMANENT_ERROR_CODES = ['VALIDATION_ERROR', 'WORK_DAY_NOT_FOUND'];
let flushing = false;

/** Uploads queued points in batches. Network / server trouble just leaves them queued for the next try. */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const queue = await exclusive(loadQueue);
      if (queue.length === 0) return;
      const workDayId = queue[0].workDayId;
      const batch = queue.filter((point) => point.workDayId === workDayId).slice(0, BATCH_SIZE);
      let dayActive = true;
      try {
        const result = await api<{ data: { dayActive: boolean } }>(`/work-days/${workDayId}/pings`, {
          method: 'POST',
          body: { points: batch.map(({ latitude, longitude, accuracyMeters, capturedAt, mocked, visitId }) => ({ latitude, longitude, accuracyMeters, capturedAt, mocked, visitId })) },
        });
        dayActive = result.data.dayActive;
        lastFlushError = '';
      } catch (cause) {
        const code = (cause as { code?: string }).code;
        lastFlushError = `${(cause as Error).message}${code ? ` (${code})` : ''}`;
        if (!code || !PERMANENT_ERROR_CODES.includes(code)) return;
      }
      const sent = new Set(batch.map((point) => point.id));
      await exclusive(async () => saveQueue((await loadQueue()).filter((point) => !sent.has(point.id))));
      // The server closed this day (too long / new day): stop recording on this phone too.
      if (!dayActive && (await getSession())?.id === workDayId) await stopTracking();
    }
  } finally {
    flushing = false;
    notify();
  }
}

// ── start / stop recording ──────────────────────────────────────
let foregroundWatcher: Location.LocationSubscription | null = null;

export async function getTrackingMode(): Promise<TrackingMode> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) return 'background';
  } catch { /* task not available (for example in Expo Go) */ }
  return foregroundWatcher ? 'foreground' : 'off';
}
export async function isTrackingRunning(): Promise<boolean> { return (await getTrackingMode()) !== 'off'; }

async function stopLocationSources() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  } catch { /* nothing to stop */ }
  foregroundWatcher?.remove();
  foregroundWatcher = null;
}

/**
 * Starts recording for a work day. Uses background tracking (works with the screen off, needs the
 * installed app build and "Allow all the time"). If that is not available it records only while the app is open.
 */
export async function startTracking(session: WorkDaySession): Promise<TrackingMode> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await stopLocationSources();
  await ensureLocationPermission(); // throws a readable message if location is denied
  try {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') throw new Error('Background location not granted');
    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: TIME_INTERVAL_MS,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Field Sales - work day tracking is ON',
        notificationBody: 'Your location is recorded until you end your day.',
        notificationColor: '#16a34a',
      },
    });
  } catch {
    foregroundWatcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: TIME_INTERVAL_MS, distanceInterval: 0 },
      (location) => { void enqueueLocations([location]); },
    );
  }
  notify();
  return getTrackingMode();
}

export async function stopTracking(): Promise<void> {
  await stopLocationSources();
  await AsyncStorage.removeItem(SESSION_KEY);
  await AsyncStorage.removeItem(VISIT_KEY);
  notify();
}

// ── work day (talks to the API) ─────────────────────────────────
type ServerWorkDay = { id: string; started_at: string };

/** Called when the app opens: re-syncs with the server and restarts recording if the day is still open. */
export async function resumeTracking(): Promise<{ active: WorkDaySession | null; error?: string }> {
  const today = await api<{ data: { active: ServerWorkDay | null } }>('/work-days/today');
  const active = today.data.active;
  if (!active) {
    if ((await getSession()) || (await isTrackingRunning())) await stopTracking();
    void flushQueue();
    return { active: null };
  }
  const session = { id: active.id, startedAt: active.started_at };
  let error: string | undefined;
  const stored = await getSession();
  if (!stored || stored.id !== session.id || !(await isTrackingRunning())) {
    try { await startTracking(session); } catch (cause) { error = (cause as Error).message; }
  }
  void flushQueue();
  notify();
  return { active: session, error };
}

export async function startWorkDay(location?: GpsReading): Promise<{ session: WorkDaySession; mode: TrackingMode }> {
  const position = location ?? await getCurrentLocation();
  const started = await api<{ data: ServerWorkDay }>('/work-days/start', { method: 'POST', body: { location: position } });
  const session = { id: started.data.id, startedAt: started.data.started_at };
  const mode = await startTracking(session);
  return { session, mode };
}

export async function endWorkDay(): Promise<void> {
  await flushQueue(); // get the route to the server before closing the day
  let location: GpsReading | null = null;
  try { location = await getCurrentLocation(); } catch { /* ending the day does not need a fix */ }
  await api('/work-days/end', { method: 'POST', body: { location } });
  await stopTracking();
  await flushQueue();
}

/** Used on check-in: if the rep forgot "Start day", start it (and tracking) now. Never throws. */
export async function ensureWorkDayStarted(location?: GpsReading): Promise<boolean> {
  try {
    const today = await api<{ data: { active: ServerWorkDay | null } }>('/work-days/today');
    const active = today.data.active;
    if (!active) { await startWorkDay(location); return true; }
    const stored = await getSession();
    if (!stored || stored.id !== active.id || !(await isTrackingRunning())) await startTracking({ id: active.id, startedAt: active.started_at });
    return true;
  } catch { return false; }
}