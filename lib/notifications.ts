import { AppState, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Notifications from 'expo-notifications';

import { supabase } from './supabase';

const TEST_CHANNEL_ID = 'gfocus-test';
const SESSION_START_ALARM_CHANNEL_ID = 'strict_session_start_alarm_v2';
const SESSION_START_CATEGORY_ID = 'gfocus_session_start';
const SESSION_START_CHECK_IN_ACTION_ID = 'gfocus_session_start_check_in';
const ANDROID_CHECKIN_SOUND_RESOURCE = 'checkin_sound';
const IOS_CHECKIN_SOUND_FILE = 'checkin_sound.mp3';
const CHECKIN_TIMEOUT_MS = 5 * 60 * 1000;
const BACKGROUND_TEST_DELAY_SECONDS = 10;
const checkinSoundSource = require('../assets/sounds/checkin_sound.mp3');

let sessionStartPlayer: AudioPlayer | null = null;
let sessionStartSystemNotificationIds: string[] = [];
const sessionCheckInNotificationIds = new Map<string, string>();
let sessionStartDelayLogTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionStartTimeout: ReturnType<typeof setTimeout> | null = null;

export type SessionStartNotificationEvent = {
  categoryName?: string | null;
  notificationId: string;
  notificationRecordId?: string;
  plannedEndTime?: string;
  plannedStartTime?: string;
  sessionId?: string;
  taskTitle?: string | null;
  title?: string;
  userId?: string;
};

export type SessionCheckInSchedule = {
  categoryName?: string | null;
  plannedEndTime: string;
  plannedStartTime: string;
  sessionId: string;
  taskTitle?: string | null;
  title: string;
  userId: string;
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    if (notification.request.content.data?.notificationType === 'session_start') {
      return {
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
        priority: Notifications.AndroidNotificationPriority.MAX,
      };
    }

    return {
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    };
  },
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
    logNotification('using Android channel: strict_session_start_alarm_v2');
    logNotification('using Android sound resource: checkin_sound');

    await Notifications.setNotificationChannelAsync(SESSION_START_ALARM_CHANNEL_ID, {
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
      },
      bypassDnd: true,
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: 'Strict session start alarm v2',
      sound: ANDROID_CHECKIN_SOUND_RESOURCE,
      vibrationPattern: [0, 400, 250, 400, 250, 700],
    });
  } else if (Platform.OS === 'ios') {
    logNotification('using iOS sound file: checkin_sound.mp3');
    logNotification('iOS Critical Alert entitlement is required for true critical alerts; falling back to time-sensitive/custom sound behavior.');
  }

  return true;
}

async function storeNotificationRecord(userId: string, payload: {
  message: string;
  scheduledAt: Date;
  sentAt?: Date;
  severity: 'soft' | 'normal' | 'strict';
  sessionId?: string;
  title: string;
  type: 'plan_reminder' | 'session_start';
}) {
  if (!supabase) {
    throw new Error('Missing Supabase config.');
  }

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type: payload.type,
      severity: payload.severity,
      title: payload.title,
      message: payload.message,
      scheduled_at: payload.scheduledAt.toISOString(),
      session_id: payload.sessionId,
      sent_at: payload.sentAt?.toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

async function updateNotificationLifecycle(
  event: Pick<SessionStartNotificationEvent, 'notificationRecordId' | 'sessionId' | 'userId'>,
  values: {
    readAt?: Date;
    sentAt?: Date;
  },
) {
  if (!supabase || !event.userId) {
    return;
  }

  const updateValues = {
    ...(values.sentAt ? { sent_at: values.sentAt.toISOString() } : {}),
    ...(values.readAt ? { read_at: values.readAt.toISOString() } : {}),
  };

  if (Object.keys(updateValues).length === 0) {
    return;
  }

  let query = supabase
    .from('notifications')
    .update(updateValues)
    .eq('user_id', event.userId)
    .eq('type', 'session_start');

  if (event.notificationRecordId) {
    query = query.eq('id', event.notificationRecordId);
  } else if (event.sessionId) {
    query = query.eq('session_id', event.sessionId).is('read_at', null);
  } else {
    return;
  }

  const { error } = await query;

  if (error) {
    logNotification('notification lifecycle update failed', {
      message: error.message,
      notificationRecordId: event.notificationRecordId,
      sessionId: event.sessionId,
    });
  }
}

export async function markSessionStartNotificationSent(event: SessionStartNotificationEvent) {
  await updateNotificationLifecycle(event, { sentAt: new Date() });
}

export async function markSessionStartNotificationRead(event: SessionStartNotificationEvent) {
  const now = new Date();
  await updateNotificationLifecycle(event, {
    readAt: now,
    sentAt: now,
  });
}

export async function startSessionStartAlertSound(onTimeout?: () => void) {
  stopSessionStartRepeatingSound('restart before new session_start test');

  await setAudioModeAsync({
    interruptionMode: 'doNotMix',
    playsInSilentMode: true,
    shouldPlayInBackground: true,
  });

  sessionStartPlayer = createAudioPlayer(checkinSoundSource, { keepAudioSessionActive: true });
  sessionStartPlayer.loop = false;
  sessionStartPlayer.volume = 1;
  sessionStartPlayer.play();
  logNotification('custom sound started', {
    sound: IOS_CHECKIN_SOUND_FILE,
    timeoutMs: CHECKIN_TIMEOUT_MS,
    playback: 'single 5-minute file',
  });

  sessionStartTimeout = setTimeout(() => {
    logNotification('5-minute timeout reached', { type: 'session_start' });
    stopSessionStartRepeatingSound('5-minute timeout reached');
    onTimeout?.();
  }, CHECKIN_TIMEOUT_MS);
}

export function stopSessionStartRepeatingSound(reason = 'manual stop') {
  const hadTimeout = Boolean(sessionStartTimeout);
  const hadPlayer = Boolean(sessionStartPlayer);
  const notificationIds = [...sessionStartSystemNotificationIds];

  if (sessionStartTimeout) {
    clearTimeout(sessionStartTimeout);
    sessionStartTimeout = null;
  }

  if (sessionStartDelayLogTimeout) {
    clearTimeout(sessionStartDelayLogTimeout);
    sessionStartDelayLogTimeout = null;
  }

  if (notificationIds.length > 0) {
    sessionStartSystemNotificationIds = [];
    notificationIds.forEach((notificationId) => {
      Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      Notifications.dismissNotificationAsync(notificationId).catch(() => undefined);
    });
  }

  if (!sessionStartPlayer) {
    if (hadTimeout || notificationIds.length > 0) {
      logNotification('custom sound stopped', {
        canceledNotifications: notificationIds.length,
        reason,
        source: 'system notification fallback',
      });
    }
    return;
  }

  try {
    sessionStartPlayer.pause();
    sessionStartPlayer.seekTo(0).catch(() => undefined);
    sessionStartPlayer.remove();
  } finally {
    sessionStartPlayer = null;
    logNotification('custom sound stopped', { reason, source: hadPlayer ? 'in-app audio' : 'unknown' });
  }
}

export function addSessionStartForegroundListener(options: {
  onForegroundAlarm: (event: SessionStartNotificationEvent) => void;
  onTimeout?: (event: SessionStartNotificationEvent) => void;
}) {
  return Notifications.addNotificationReceivedListener((notification) => {
    if (notification.request.content.data?.notificationType !== 'session_start') {
      return;
    }

    const event = getSessionStartEvent(notification);

    logNotification('10-second delay completed', {
      notificationId: notification.request.identifier,
    });
    logNotification('current app state: foreground');

    Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined);
    markSessionStartNotificationSent(event).catch((error) => {
      logNotification('notification sent_at update failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    if (sessionStartPlayer) {
      return;
    }

    options.onForegroundAlarm(event);
    startSessionStartAlertSound(() => options.onTimeout?.(event)).catch((error) => {
      logNotification('custom sound start failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

export function addSessionStartCheckInActionListener(onCheckIn: (event: SessionStartNotificationEvent) => void) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.actionIdentifier !== SESSION_START_CHECK_IN_ACTION_ID) {
      return;
    }

    logNotification('check-in action clicked', { source: 'system notification' });
    stopSessionStartRepeatingSound('check-in action clicked');
    const event = getSessionStartEvent(response.notification);
    markSessionStartNotificationRead(event).catch((error) => {
      logNotification('notification read_at update failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    onCheckIn(event);
  });
}

export async function getLastSessionStartCheckInActionEvent() {
  const response = await Notifications.getLastNotificationResponseAsync();

  if (!response || response.actionIdentifier !== SESSION_START_CHECK_IN_ACTION_ID) {
    return null;
  }

  await Notifications.clearLastNotificationResponseAsync();
  logNotification('check-in action clicked', { source: 'last notification response' });
  const event = getSessionStartEvent(response.notification);
  await markSessionStartNotificationRead(event);
  return event;
}

function getStringData(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function getSessionStartEvent(notification: Notifications.Notification): SessionStartNotificationEvent {
  const data = notification.request.content.data ?? {};

  return {
    categoryName: getStringData(data, 'categoryName') ?? null,
    notificationId: notification.request.identifier,
    notificationRecordId: getStringData(data, 'notificationRecordId'),
    plannedEndTime: getStringData(data, 'plannedEndTime'),
    plannedStartTime: getStringData(data, 'plannedStartTime'),
    sessionId: getStringData(data, 'sessionId'),
    taskTitle: getStringData(data, 'taskTitle') ?? null,
    title: getStringData(data, 'title') ?? notification.request.content.title ?? undefined,
    userId: getStringData(data, 'userId'),
  };
}

function getPlatformNotificationSound() {
  return Platform.OS === 'android' ? ANDROID_CHECKIN_SOUND_RESOURCE : IOS_CHECKIN_SOUND_FILE;
}

async function scheduleSessionStartSystemNotification(
  seconds: number,
  data: Record<string, unknown> = {},
  content: {
    body?: string;
    title?: string;
  } = {},
) {
  return Notifications.scheduleNotificationAsync({
    content: {
      autoDismiss: false,
      body: content.body ?? 'Your session is starting now. Tap CHECK IN to stop the alert.',
      categoryIdentifier: SESSION_START_CATEGORY_ID,
      data: {
        notificationType: 'session_start',
        severity: 'strict',
        ...data,
      },
      interruptionLevel: Platform.OS === 'ios' ? 'timeSensitive' : undefined,
      priority: Notifications.AndroidNotificationPriority.MAX,
      sound: getPlatformNotificationSound(),
      sticky: true,
      title: content.title ?? 'GFocus session start',
      vibrate: [0, 400, 250, 400, 250, 700],
    },
    trigger: {
      channelId: SESSION_START_ALARM_CHANNEL_ID,
      seconds,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
}

export async function cancelSessionCheckInNotification(sessionId: string) {
  const notificationId = sessionCheckInNotificationIds.get(sessionId);

  if (notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
    await Notifications.dismissNotificationAsync(notificationId).catch(() => undefined);
    sessionCheckInNotificationIds.delete(sessionId);
  }

  if (supabase) {
    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('session_id', sessionId)
        .eq('type', 'session_start')
        .is('sent_at', null);
    } catch {
      // Canceling the local notification is the critical path here.
    }
  }
}

export async function scheduleSessionCheckInNotification(payload: SessionCheckInSchedule) {
  logNotification('notification triggered', {
    scheduledAt: payload.plannedStartTime,
    sessionId: payload.sessionId,
    severity: 'strict',
    type: 'session_start',
  });

  const hasPermission = await prepareSessionStartAlarmNotifications();

  if (!hasPermission) {
    throw new Error('Notification permission was not granted.');
  }

  await cancelSessionCheckInNotification(payload.sessionId);

  const scheduledAt = new Date(payload.plannedStartTime);
  const secondsUntilStart = Math.max(1, Math.round((scheduledAt.getTime() - Date.now()) / 1000));
  const body = payload.taskTitle
    ? `${payload.taskTitle} is starting now. Tap CHECK IN to stop the alert.`
    : 'Your session is starting now. Tap CHECK IN to stop the alert.';

  const notificationRecordId = await storeNotificationRecord(payload.userId, {
    message: body,
    scheduledAt,
    sessionId: payload.sessionId,
    severity: 'strict',
    title: payload.title,
    type: 'session_start',
  });

  const notificationId = await scheduleSessionStartSystemNotification(
    secondsUntilStart,
    {
      categoryName: payload.categoryName ?? undefined,
      notificationRecordId,
      plannedEndTime: payload.plannedEndTime,
      plannedStartTime: payload.plannedStartTime,
      sessionId: payload.sessionId,
      source: 'session_checkin',
      taskTitle: payload.taskTitle ?? undefined,
      title: payload.title,
      userId: payload.userId,
    },
    {
      body,
      title: payload.title,
    },
  );

  sessionCheckInNotificationIds.set(payload.sessionId, notificationId);

  logNotification('session_start strict notification scheduled', {
    notificationId,
    secondsUntilStart,
    sessionId: payload.sessionId,
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

  const notificationRecordId = await storeNotificationRecord(userId, {
    message: 'Strict session_start test notification. Check in to stop the alert.',
    scheduledAt: now,
    sentAt: isForeground ? now : undefined,
    severity: 'strict',
    title: 'GFocus session start',
    type: 'session_start',
  });

  if (isForeground) {
    options.onForegroundAlarm?.();
    await startSessionStartAlertSound(options.onTimeout);
    return;
  }

  logNotification('background/system notification scheduled with single 5-minute sound file');

  sessionStartSystemNotificationIds = [await scheduleSessionStartSystemNotification(1, { notificationRecordId, userId })];
  logNotification('custom sound started', { source: 'system notification', sound: getPlatformNotificationSound() });

  sessionStartTimeout = setTimeout(() => {
    logNotification('5-minute timeout reached', { type: 'session_start', source: 'system notification fallback' });
    stopSessionStartRepeatingSound('5-minute timeout reached');
    options.onTimeout?.();
  }, CHECKIN_TIMEOUT_MS);
}

export async function scheduleSessionStartStrictNotificationAfter10Seconds(userId: string) {
  logNotification('session_start strict notification scheduled after 10 seconds');

  const hasPermission = await prepareSessionStartAlarmNotifications();

  if (!hasPermission) {
    throw new Error('Notification permission was not granted.');
  }

  stopSessionStartRepeatingSound('restart before scheduled session_start test');

  const scheduledAt = new Date(Date.now() + BACKGROUND_TEST_DELAY_SECONDS * 1000);

  const notificationRecordId = await storeNotificationRecord(userId, {
    message: 'Strict session_start test notification scheduled after 10 seconds. Check in to stop the alert.',
    scheduledAt,
    severity: 'strict',
    title: 'GFocus session start',
    type: 'session_start',
  });

  sessionStartSystemNotificationIds = [
    await scheduleSessionStartSystemNotification(BACKGROUND_TEST_DELAY_SECONDS, {
      notificationRecordId,
      scheduledAfter10SecondsTest: true,
      userId,
    }),
  ];

  logNotification(`current app state: ${AppState.currentState === 'active' ? 'foreground' : 'background'}`);
  logNotification('using Android channel: strict_session_start_alarm_v2');
  logNotification('using Android sound resource: checkin_sound');
  logNotification('using iOS sound file: checkin_sound.mp3');

  sessionStartDelayLogTimeout = setTimeout(() => {
    const appState = AppState.currentState === 'active' ? 'foreground' : 'background';
    logNotification('10-second delay completed');
    logNotification(`current app state: ${appState}`);
    logNotification('custom sound started', {
      source: appState === 'foreground' ? 'in-app audio' : 'system notification',
      sound: getPlatformNotificationSound(),
      playback: 'single 5-minute file',
    });
  }, BACKGROUND_TEST_DELAY_SECONDS * 1000);

  sessionStartTimeout = setTimeout(() => {
    logNotification('5-minute timeout reached', { source: 'scheduled background/system test', type: 'session_start' });
    stopSessionStartRepeatingSound('5-minute timeout reached');
  }, BACKGROUND_TEST_DELAY_SECONDS * 1000 + CHECKIN_TIMEOUT_MS);
}
