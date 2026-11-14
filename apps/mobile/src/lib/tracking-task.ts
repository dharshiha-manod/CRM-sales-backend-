import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { TRACKING_TASK, enqueueLocations } from './tracking';

// Runs in the background while the work day is active (even when the app is closed or the screen is off).
// Must be imported once at app start (see app/_layout.tsx).
TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) { console.warn('Tracking task error', error.message); return; }
  const locations = (data as { locations?: LocationObject[] } | undefined)?.locations ?? [];
  if (locations.length > 0) await enqueueLocations(locations);
});