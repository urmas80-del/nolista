import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { toDateString } from '@/utils/due-dates';
import { planReminders, type DueItem } from '@/utils/reminder-plan';
import { supabase } from '../../lib/supabase';

// Reminders are local notifications scheduled on this phone from the due
// dates of open items on every board you can see. They're rebuilt from
// scratch (cancel all, schedule again) when the app starts and whenever it
// goes to the background, so edits by you or anyone sharing a board are
// picked up without a server.

export type ReminderSettings = { enabled: boolean; hour: number; minute: number };

const SETTINGS_KEY = 'nolista.reminders';
const CHANNEL_ID = 'reminders';
const DEFAULT_SETTINGS: ReminderSettings = { enabled: true, hour: 9, minute: 0 };

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveReminderSettings(settings: ReminderSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (settings.enabled) await askForPermission();
  await syncReminders();
}

/** Android needs a channel before it will show the permission prompt. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Due date reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Ask for notification permission if we haven't yet. Called when someone
 * first sets a due date or turns reminders on, not at launch.
 * Returns whether notifications are allowed.
 */
export async function askForPermission(): Promise<boolean> {
  if (!supported) return false;
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Called after a due date is set: ask once, if reminders are on. */
export async function onDueDateSet() {
  const settings = await getReminderSettings();
  if (settings.enabled) await askForPermission();
}

let running: Promise<void> | null = null;
let rerun = false;

/** Rebuild all reminders. Overlapping calls are merged into one more run. */
export function syncReminders(): Promise<void> {
  if (!supported) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await rebuild();
      } while (rerun);
    } catch (e) {
      console.log('syncReminders error:', e instanceof Error ? e.message : e);
    } finally {
      running = null;
    }
  })();
  return running;
}

export async function clearReminders() {
  if (!supported) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

async function rebuild() {
  const settings = await getReminderSettings();
  const permission = await Notifications.getPermissionsAsync();
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.enabled || !permission.granted) return;

  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return;

  const today = new Date();
  const until = new Date(today);
  until.setDate(until.getDate() + 60);

  // RLS limits this to boards you own or joined.
  const { data, error } = await supabase
    .from('tasks')
    .select('title, due_date, sheet_id, task_sheets(name)')
    .eq('is_done', false)
    .gte('due_date', toDateString(today))
    .lte('due_date', toDateString(until));
  if (error) throw new Error(error.message);

  const items: DueItem[] = (data ?? []).map((row: any) => ({
    title: row.title,
    due_date: row.due_date,
    board_id: row.sheet_id,
    board_name: row.task_sheets?.name ?? 'Nolista',
  }));

  await ensureChannel();
  for (const plan of planReminders(items, settings)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, data: { boardId: plan.boardId } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: plan.date,
        channelId: CHANNEL_ID,
      },
    });
  }
}
