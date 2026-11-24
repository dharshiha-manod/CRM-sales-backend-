import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

// Offline outbox: writes that can safely wait (follow-up updates, payments, new leads, visit photos) are saved
// on the phone when there is no network and are sent automatically later. GPS points have their own queue (tracking.ts).
// Check-in / check-out are NOT queued: the server stamps their time and verifies the geofence, so they need a live connection.
const KEY = 'fs.outbox';
type Method = 'POST' | 'PATCH';
type Item = { id: string; label: string; path: string; method: Method; body: unknown; createdAt: string };

const listeners = new Set<() => void>();
export const subscribeOutbox = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach((listener) => listener());

async function load(): Promise<Item[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Item[]) : [];
  } catch { return []; }
}
const save = (items: Item[]) => AsyncStorage.setItem(KEY, JSON.stringify(items));
export async function getOutboxCount(): Promise<number> { return (await load()).length; }

// React Native throws a TypeError when the request never reached the server.
const isNetworkError = (cause: unknown) => cause instanceof TypeError;
// The server answered and said "no" (4xx): retrying can never help, so the item is dropped. 401/408/429 are retried.
const isPermanent = (cause: unknown) => {
  const status = (cause as { status?: number }).status;
  return typeof status === 'number' && status >= 400 && status < 500 && ![401, 408, 429].includes(status);
};

/** Sends now; if the phone is offline, keeps it in the outbox and reports queued = true. Server rejections are thrown. */
export async function sendOrQueue(label: string, path: string, method: Method, body: unknown): Promise<{ queued: boolean }> {
  try {
    await api(path, { method, body });
    return { queued: false };
  } catch (cause) {
    if (!isNetworkError(cause)) throw cause;
    const items = await load();
    items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, path, method, body, createdAt: new Date().toISOString() });
    await save(items);
    notify();
    return { queued: true };
  }
}

let flushing = false;
/** Sends the saved items in order. Stops at the first network / server problem and tries again next time. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const [item] = await load();
      if (!item) return;
      try {
        await api(item.path, { method: item.method, body: item.body });
      } catch (cause) {
        if (!isPermanent(cause)) return;
      }
      await save((await load()).filter((entry) => entry.id !== item.id));
      notify();
    }
  } finally {
    flushing = false;
    notify();
  }
}