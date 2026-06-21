import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
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
      <StatusBar backgroundColor="transparent" style="dark" translucent />
    </SafeAreaView>
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
});
