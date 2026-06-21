import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function prepareNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('gfocus-test', {
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

export async function sendTestNotification() {
  const hasPermission = await prepareNotifications();

  if (!hasPermission) {
    throw new Error('Notification permission was not granted.');
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'This is a test notification from the Profile screen.',
      sound: 'default',
      title: 'GFocus notification test',
    },
    trigger: {
      channelId: 'gfocus-test',
      seconds: 1,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
}
