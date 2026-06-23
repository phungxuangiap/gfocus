import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Provider } from 'react-redux';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Anton_400Regular } from '@expo-google-fonts/anton/400Regular';
import { IBMPlexMono_700Bold } from '@expo-google-fonts/ibm-plex-mono/700Bold';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';

import { AuthScreen } from './components/AuthScreen';
import { CalendarScreen } from './components/CalendarScreen';
import { ProfileScreen } from './components/ProfileScreen';
import { TaskScreen } from './components/TaskScreen';
import { colors, shadowHard } from './constants/theme';
import {
  addSessionStartCheckInActionListener,
  addSessionStartForegroundListener,
  getLastSessionStartCheckInActionEvent,
  markSessionStartNotificationRead,
  stopSessionStartRepeatingSound,
  type SessionStartNotificationEvent,
} from './lib/notifications';
import { supabase } from './lib/supabase';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { setBooting, setSession } from './store/authSlice';
import { setActiveTab } from './store/appSlice';
import { store } from './store';

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </Provider>
  );
}

function AppContent() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { booting, session, suppressSignUpSession } = useAppSelector((state) => state.auth);
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    IBMPlexMono_700Bold,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (!supabase) {
      dispatch(setBooting(false));
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      dispatch(setSession(data.session));
      dispatch(setBooting(false));
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_IN' && nextSession && suppressSignUpSession) {
        return;
      }

      dispatch(setSession(nextSession));
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [dispatch, suppressSignUpSession]);

  if (!fontsLoaded || booting) {
    return (
      <SafeAreaView style={[styles.loadingScreen, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} />
        <StatusBar backgroundColor="transparent" style="dark" translucent />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <>
        <AuthScreen />
        <StatusBar backgroundColor="transparent" style="dark" translucent />
      </>
    );
  }

  return <MainShell />;
}

function MainShell() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const activeTab = useAppSelector((state) => state.app.activeTab);
  const session = useAppSelector((state) => state.auth.session);
  const [checkInEvent, setCheckInEvent] = useState<SessionStartNotificationEvent | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const userId = session?.user.id;

  async function checkInSession(event: SessionStartNotificationEvent | null) {
    console.log('[notifications] check-in action clicked', { source: 'session check-in modal', sessionId: event?.sessionId });
    stopSessionStartRepeatingSound('check-in action clicked');
    if (event?.notificationRecordId || event?.sessionId) {
      await markSessionStartNotificationRead(event);
    }

    if (!supabase || !userId || !event?.sessionId) {
      setCheckInEvent(null);
      return;
    }

    setCheckingIn(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('sessions')
      .update({
        actual_start_time: now,
        checked_in: true,
      })
      .eq('id', event.sessionId)
      .eq('user_id', userId);

    if (error) {
      console.log('[notifications] session check-in update failed', { message: error.message, sessionId: event.sessionId });
    }

    setCheckingIn(false);
    setCheckInEvent(null);
  }

  useEffect(() => {
    const foregroundSubscription = addSessionStartForegroundListener({
      onForegroundAlarm: (event) => setCheckInEvent(event),
      onTimeout: () => setCheckInEvent(null),
    });
    const checkInSubscription = addSessionStartCheckInActionListener((event) => {
      checkInSession(event).catch((error) => {
        console.log('[notifications] check-in action failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
    getLastSessionStartCheckInActionEvent()
      .then((event) => {
        if (event) {
          return checkInSession(event);
        }

        return undefined;
      })
      .catch((error) => {
        console.log('[notifications] last check-in action failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      foregroundSubscription.remove();
      checkInSubscription.remove();
      stopSessionStartRepeatingSound('main shell unmounted');
    };
  }, [userId]);

  return (
    <SafeAreaView style={[styles.appScreen, { paddingTop: insets.top }]}>
      <View style={styles.scene}>
        {activeTab === 'calendar' ? <CalendarScreen /> : null}
        {activeTab === 'task' ? <TaskScreen /> : null}
        {activeTab === 'profile' ? <ProfileScreen /> : null}
      </View>
      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'calendar' }}
          onPress={() => dispatch(setActiveTab('calendar'))}
          style={[styles.navItem, activeTab === 'calendar' && styles.navItemActive]}
        >
          <Ionicons color={activeTab === 'calendar' ? colors.paper : colors.text} name="calendar-outline" size={24} />
          <Text style={[styles.navLabel, activeTab === 'calendar' && styles.navLabelActive]}>Calendar</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'profile' }}
          onPress={() => dispatch(setActiveTab('profile'))}
          style={[styles.navItem, activeTab === 'profile' && styles.navItemActive]}
        >
          <Ionicons color={activeTab === 'profile' ? colors.paper : colors.text} name="person-circle-outline" size={24} />
          <Text style={[styles.navLabel, activeTab === 'profile' && styles.navLabelActive]}>Profile</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'task' }}
          onPress={() => dispatch(setActiveTab('task'))}
          style={[styles.navItem, activeTab === 'task' && styles.navItemActive]}
        >
          <Ionicons color={activeTab === 'task' ? colors.paper : colors.text} name="list-circle-outline" size={24} />
          <Text style={[styles.navLabel, activeTab === 'task' && styles.navLabelActive]}>Task</Text>
        </Pressable>
      </View>
      <SessionCheckInModal
        checkingIn={checkingIn}
        event={checkInEvent}
        onCheckIn={() => checkInSession(checkInEvent)}
      />
      <StatusBar backgroundColor="transparent" style="dark" translucent />
    </SafeAreaView>
  );
}

function SessionCheckInModal({
  checkingIn,
  event,
  onCheckIn,
}: {
  checkingIn: boolean;
  event: SessionStartNotificationEvent | null;
  onCheckIn: () => void;
}) {
  if (!event) {
    return null;
  }

  return (
    <Modal animationType="fade" onRequestClose={() => undefined} transparent visible>
      <View style={styles.checkInBackdrop}>
        <View style={styles.checkInCard}>
          <View style={styles.checkInTop}>
            <View style={styles.checkInCircle} />
            <View style={styles.checkInLine} />
          </View>
          <Text style={styles.checkInKicker}>STRICT ALERT</Text>
          <Text style={styles.checkInTitle}>SESSION START</Text>
          <View style={styles.checkInInfo}>
            <Text style={styles.checkInInfoLabel}>SESSION</Text>
            <Text style={styles.checkInInfoValue}>{event.title ?? 'GFocus session start'}</Text>
          </View>
          <View style={styles.checkInInfo}>
            <Text style={styles.checkInInfoLabel}>TASK</Text>
            <Text style={styles.checkInInfoValue}>{event.taskTitle ?? 'NO TASK DETAIL'}</Text>
          </View>
          <View style={styles.checkInInfo}>
            <Text style={styles.checkInInfoLabel}>CATEGORY</Text>
            <Text style={styles.checkInInfoValue}>{event.categoryName ?? 'NO CATEGORY'}</Text>
          </View>
          <Text style={styles.checkInBody}>
            Check in to stop the alert sound and mark this session as started.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={checkingIn}
            onPress={onCheckIn}
            style={({ pressed }) => [styles.checkInButton, (pressed || checkingIn) && styles.checkInButtonPressed]}
          >
            {checkingIn ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.checkInButtonText}>CHECK IN</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
  },
  appScreen: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  scene: {
    flex: 1,
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderTopWidth: 3,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    left: 0,
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'absolute',
    right: 0,
    ...shadowHard,
  },
  navItem: {
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  navItemActive: {
    backgroundColor: colors.primary,
  },
  navLabel: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  navLabelActive: {
    color: colors.paper,
  },
  checkInBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 23, 18, 0.48)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  checkInCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxWidth: 440,
    padding: 20,
    width: '100%',
    ...shadowHard,
  },
  checkInTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  checkInCircle: {
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 3,
    height: 36,
    width: 36,
  },
  checkInLine: {
    backgroundColor: colors.text,
    flex: 1,
    height: 4,
  },
  checkInKicker: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  checkInTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 42,
    lineHeight: 48,
  },
  checkInInfo: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    paddingVertical: 10,
  },
  checkInInfoLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 4,
  },
  checkInInfoValue: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 21,
  },
  checkInBody: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  checkInButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 56,
    ...shadowHard,
  },
  checkInButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
  checkInButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
});
