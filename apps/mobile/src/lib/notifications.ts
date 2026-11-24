import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const CHANNEL = 'followups';
const MAX_REMINDERS = 40;

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Follow-up reminders', importance: Notifications.AndroidImportance.HIGH });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export type ReminderSource = { id: string; title: string; due_at: string; status: string; clients?: { client_name?: string } | null };

/** Local reminder (works offline, also in Expo Go) at the due time of every open, future follow-up. */
export async function scheduleFollowUpReminders(items: ReminderSource[]): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    const upcoming = items
      .filter((item) => (item.status === 'pending' || item.status === 'in_progress') && new Date(item.due_at).getTime() > Date.now() + 30000)
      .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
      .slice(0, MAX_REMINDERS);
    for (const item of upcoming) {
      await Notifications.scheduleNotificationAsync({
        identifier: `followup-${item.id}`,
        content: { title: 'Follow-up due', body: `${item.title}${item.clients?.client_name ? ` · ${item.clients.client_name}` : ''}` },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.due_at), channelId: CHANNEL },
      });
    }
  } catch { /* reminders are a convenience: never block the screen */ }
}

/** Registers this phone for manager messages. Remote push needs the installed APK (Expo Go does not support it), so failures are ignored. */
export async function registerForPush(): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await api('/mobile/push-token', { method: 'POST', body: { token, platform: Platform.OS } });
  } catch { /* not available (Expo Go) or offline */ }
}