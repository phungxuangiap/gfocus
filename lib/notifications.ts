import { AppState, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';

const TEST_CHANNEL_ID = 'gfocus-test';
const SESSION_START_ALARM_CHANNEL_ID = 'gfocus-session-start-alarm';
const SESSION_START_CATEGORY_ID = 'gfocus_session_start';
const SESSION_START_CHECK_IN_ACTION_ID = 'gfocus_session_start_check_in';
const CHECKIN_SOUND_FILE = 'checkin_sound.mp3';
const CHECKIN_TIMEOUT_MS = 5 * 60 * 1000;
const checkinSoundSource = require('../assets/sounds/checkin_sound.mp3');

let sessionStartPlayer: AudioPlayer | null = null;
let sessionStartSystemNotificationId: string | null = null;
let sessionStartTimeout: ReturnType<typeof setTimeout> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

function logNotification(message: string, details?: Record<string, unknown>) {
  console.log(`[notifications] ${message}`, details ?? '');
}

export async function prepareNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TEST_CHANNEL_ID, {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'GFocus test notifications',
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const currentPermission = await Notifications.getPermissionsAsync();
  let finalStatus = currentPermission.status;

  if (currentPermission.status !== 'granted') {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  return finalStatus === 'granted';
}

async function prepareSessionStartAlarmNotifications() {
  const hasPermission = await prepareNotifications();

  if (!hasPermission) {
    return false;
  }

  await Notifications.setNotificationCategoryAsync(SESSION_START_CATEGORY_ID, [
    {
      buttonTitle: 'CHECK IN',
      identifier: SESSION_START_CHECK_IN_ACTION_ID,
      options: {
        opensAppToForeground: true,
      },
    },
  ]);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SESSION_START_ALARM_CHANNEL_ID, {
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
      },
      bypassDnd: true,
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: 'GFocus session alarms',
      sound: CHECKIN_SOUND_FILE,
      vibrationPattern: [0, 400, 250, 400, 250, 700],
    });
  }

  return true;
}

async function storeNotificationRecord(userId: string, payload: {
  message: string;
  scheduledAt: Date;
  sentAt?: Date;
  severity: 'soft' | 'normal' | 'strict';
  title: string;
  type: 'plan_reminder' | 'session_start';
}) {
  if (!supabase) {
    throw new Error('Missing Supabase config.');
  }

  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    type: payload.type,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    scheduled_at: payload.scheduledAt.toISOString(),
    sent_at: payload.sentAt?.toISOString(),
  });

  if (error) {
    throw error;
  }
}

async function startSessionStartRepeatingSound(onTimeout?: () => void) {
  stopSessionStartRepeatingSound('restart before new session_start test');

  await setAudioModeAsync({
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldPlayInBackground: true,
  });

  sessionStartPlayer = createAudioPlayer(checkinSoundSource, { keepAudioSessionActive: true });
  sessionStartPlayer.loop = true;
  sessionStartPlayer.volume = 1;
  sessionStartPlayer.play();
  logNotification('sound started', { sound: CHECKIN_SOUND_FILE, timeoutMs: CHECKIN_TIMEOUT_MS });

  sessionStartTimeout = setTimeout(() => {
    logNotification('5-minute timeout reached', { type: 'session_start' });
    stopSessionStartRepeatingSound('5-minute timeout reached');
    onTimeout?.();
  }, CHECKIN_TIMEOUT_MS);
}

export function stopSessionStartRepeatingSound(reason = 'manual stop') {
  const hadTimeout = Boolean(sessionStartTimeout);
  const hadPlayer = Boolean(sessionStartPlayer);
  const notificationId = sessionStartSystemNotificationId;

  if (sessionStartTimeout) {
    clearTimeout(sessionStartTimeout);
    sessionStartTimeout = null;
  }

  if (notificationId) {
    sessionStartSystemNotificationId = null;
    Notifications.dismissNotificationAsync(notificationId).catch(() => undefined);
  }

  if (!sessionStartPlayer) {
    if (hadTimeout || notificationId) {
      logNotification('sound stopped', { reason, source: 'system notification fallback' });
    }
    return;
  }

  try {
    sessionStartPlayer.pause();
    sessionStartPlayer.seekTo(0).catch(() => undefined);
    sessionStartPlayer.remove();
  } finally {
    sessionStartPlayer = null;
    logNotification('sound stopped', { reason, source: hadPlayer ? 'in-app audio' : 'unknown' });
  }
}

export function addSessionStartCheckInActionListener(onCheckIn: () => void) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.actionIdentifier !== SESSION_START_CHECK_IN_ACTION_ID) {
      return;
    }

    logNotification('check-in action clicked', { source: 'system notification' });
    stopSessionStartRepeatingSound('check-in action clicked');
    onCheckIn();
  });
}

export async function sendTestNotification(userId: string) {
  const hasPermission = await prepareNotifications();

  if (!hasPermission) {
    throw new Error('Notification permission was not granted.');
  }

  const scheduledAt = new Date(Date.now() + 1000);

  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'This is a test notification from the Profile screen.',
      sound: 'default',
      title: 'GFocus notification test',
    },
    trigger: {
      channelId: TEST_CHANNEL_ID,
      seconds: 1,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });

  await storeNotificationRecord(userId, {
    type: 'plan_reminder',
    severity: 'soft',
    title: 'GFocus notification test',
    message: 'This is a test notification from the Profile screen.',
    scheduledAt,
  });
}

export async function sendSessionStartStrictTestNotification(
  userId: string,
  options: {
    onForegroundAlarm?: () => void;
    onTimeout?: () => void;
  } = {},
) {
  logNotification('notification triggered', {
    severity: 'strict',
    type: 'session_start',
  });

  const hasPermission = await prepareSessionStartAlarmNotifications();

  if (!hasPermission) {
    throw new Error('Notification permission was not granted.');
  }

  const appState = AppState.currentState;
  const isForeground = appState === 'active';
  const now = new Date();

  logNotification('app state detected', {
    appState,
    mode: isForeground ? 'foreground' : 'background',
  });

  await storeNotificationRecord(userId, {
    message: 'Strict session_start test notification. Check in to stop the alert.',
    scheduledAt: now,
    sentAt: isForeground ? now : undefined,
    severity: 'strict',
    title: 'GFocus session start',
    type: 'session_start',
  });

  if (isForeground) {
    options.onForegroundAlarm?.();
    await startSessionStartRepeatingSound(options.onTimeout);
    return;
  }

  logNotification('background fallback scheduled', {
    limitation:
      'Expo can schedule a custom-sound action notification, but full-screen intent, critical alert entitlement, and guaranteed 5-minute looping after app kill require native configuration.',
  });

  sessionStartSystemNotificationId = await Notifications.scheduleNotificationAsync({
    content: {
      autoDismiss: false,
      body: 'Your session is starting now. Tap CHECK IN to stop the alert.',
      categoryIdentifier: SESSION_START_CATEGORY_ID,
      data: {
        notificationType: 'session_start',
        severity: 'strict',
      },
      interruptionLevel: Platform.OS === 'ios' ? 'timeSensitive' : undefined,
      priority: Notifications.AndroidNotificationPriority.MAX,
      sound: CHECKIN_SOUND_FILE,
      sticky: true,
      title: 'GFocus session start',
      vibrate: [0, 400, 250, 400, 250, 700],
    },
    trigger: {
      channelId: SESSION_START_ALARM_CHANNEL_ID,
      seconds: 1,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
  logNotification('sound started', { source: 'system notification', sound: CHECKIN_SOUND_FILE });

  sessionStartTimeout = setTimeout(() => {
    logNotification('5-minute timeout reached', { type: 'session_start', source: 'system notification fallback' });
    stopSessionStartRepeatingSound('5-minute timeout reached');
    options.onTimeout?.();
  }, CHECKIN_TIMEOUT_MS);
}
