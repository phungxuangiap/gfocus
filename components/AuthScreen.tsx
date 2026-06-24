import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, shadowHard } from '../constants/theme';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  beginSignUpWithoutAutoLogin,
  endSignUpWithoutAutoLogin,
  hideSignupSuccess,
  setLoading,
  setMode,
  showSignupSuccess,
} from '../store/authSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';

export function AuthScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { loading, mode, signupSuccessVisible } = useAppSelector((state) => state.auth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const keyboardProgress = useRef(new Animated.Value(0)).current;

  const isSignIn = mode === 'sign-in';

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      Animated.timing(keyboardProgress, {
        duration: 220,
        toValue: 1,
        useNativeDriver: false,
      }).start();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      Animated.timing(keyboardProgress, {
        duration: 220,
        toValue: 0,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardProgress]);

  async function submit() {
    if (!supabase) {
      Alert.alert('Missing Supabase config', 'Create .env from .env.example and add your Supabase URL and publishable key.');
      return;
    }

    if (!email.trim() || password.length < 6) {
      Alert.alert('Check your details', 'Email is required and password must be at least 6 characters.');
      return;
    }

    dispatch(setLoading(true));

    if (!isSignIn) {
      dispatch(beginSignUpWithoutAutoLogin());
    }

    const { data, error } = isSignIn
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

    dispatch(setLoading(false));

    if (error) {
      if (!isSignIn) {
        dispatch(endSignUpWithoutAutoLogin());
      }

      const isNetworkError = error.message.toLowerCase().includes('network request failed');
      Alert.alert(
        isNetworkError ? 'Network check needed' : 'Auth failed',
        isNetworkError
          ? 'The app could not reach Supabase from this device. Restart Expo with cache clear, then check that the phone can open your Supabase project URL in a browser and is not behind VPN/Private DNS/ad-blocking.'
          : error.message,
      );
      return;
    }

    if (!isSignIn && data.user) {
      if (data.session) {
        await supabase.auth.signOut();
      }

      dispatch(endSignUpWithoutAutoLogin());
      setPassword('');
      dispatch(showSignupSuccess());
      return;
    }

    if (!isSignIn) {
      dispatch(endSignUpWithoutAutoLogin());
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.screen, { paddingTop: Math.max(insets.top + 12, 20) }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.keyboardOverlay,
            {
              opacity: keyboardProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.1],
              }),
            },
          ]}
        />

        <Animated.View
          style={[
            styles.header,
            {
              marginBottom: keyboardProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [22, 0],
              }),
              maxHeight: keyboardProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [150, 0],
              }),
              opacity: keyboardProgress.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [1, 0, 0],
              }),
              transform: [
                {
                  translateY: keyboardProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -18],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.badge}>
            <Text style={styles.badgeText}>BLOCK 16 / AUTH</Text>
          </View>
          <Text style={styles.title}>GFOCUS</Text>
          <Text style={styles.subtitle}>Plan the day in hard blocks. Keep the streak honest.</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.poster,
            {
              transform: [
                {
                  translateY: keyboardProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -42],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.shapeRow}>
            <View style={styles.circle} />
            <View style={styles.bar} />
            <View style={styles.square} />
          </View>

          <View style={styles.switcher}>
            <Pressable
              accessibilityRole="button"
              onPress={() => dispatch(setMode('sign-in'))}
              style={[styles.switchButton, isSignIn && styles.switchButtonActive]}
            >
              <Text style={[styles.switchText, isSignIn && styles.switchTextActive]}>LOGIN</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => dispatch(setMode('sign-up'))}
              style={[styles.switchButton, !isSignIn && styles.switchButtonActive]}
            >
              <Text style={[styles.switchText, !isSignIn && styles.switchTextActive]}>SIGN UP</Text>
            </Pressable>
          </View>

          {!isSupabaseConfigured ? (
            <View style={styles.configWarning}>
              <Text style={styles.configWarningTitle}>SUPABASE ENV NEEDED</Text>
              <Text style={styles.configWarningText}>Copy .env.example to .env and fill EXPO_PUBLIC_SUPABASE_URL plus EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.</Text>
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              editable={!loading}
              inputMode="email"
              onChangeText={setEmail}
              placeholder="you@gfocus.app"
              placeholderTextColor={colors.textSoft}
              style={styles.input}
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete={isSignIn ? 'current-password' : 'new-password'}
              editable={!loading}
              onChangeText={setPassword}
              placeholder="minimum 6 characters"
              placeholderTextColor={colors.textSoft}
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={submit}
            style={({ pressed }) => [styles.primaryButton, (pressed || loading) && styles.primaryButtonPressed]}
          >
            {loading ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.primaryButtonText}>{isSignIn ? 'ENTER PLAN' : 'CREATE ACCOUNT'}</Text>}
          </Pressable>

          <Text style={styles.microCopy}>
            {isSignIn ? 'No account yet? Switch to SIGN UP.' : 'Already planned before? Switch to LOGIN.'}
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        navigationBarTranslucent
        onRequestClose={() => dispatch(hideSignupSuccess())}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={signupSuccessVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalTop}>
              <View style={styles.modalCircle} />
              <View style={styles.modalLine} />
            </View>

            <Text style={styles.modalKicker}>ACCOUNT CREATED</Text>
            <Text style={styles.modalTitle}>YOU ARE SET</Text>
            <Text style={styles.modalText}>
              Your GFocus account has been created. Go back to login and enter with your new credentials.
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                dispatch(hideSignupSuccess());
                dispatch(setMode('sign-in'));
              }}
              style={({ pressed }) => [styles.modalButton, pressed && styles.modalButtonPressed]}
            >
              <Text style={styles.modalButtonText}>BACK TO LOGIN</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  keyboardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.border,
  },
  header: {
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 68,
    letterSpacing: 0,
    lineHeight: 78,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 320,
  },
  poster: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    padding: 18,
    ...shadowHard,
  },
  shapeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  circle: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderRadius: 28,
    borderWidth: 3,
    height: 56,
    width: 56,
  },
  bar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    height: 28,
  },
  square: {
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderWidth: 3,
    height: 42,
    transform: [{ rotate: '8deg' }],
    width: 42,
  },
  switcher: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 18,
  },
  switchButton: {
    flex: 1,
    paddingVertical: 13,
  },
  switchButtonActive: {
    backgroundColor: colors.primary,
  },
  switchText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 13,
    textAlign: 'center',
  },
  switchTextActive: {
    color: colors.paper,
  },
  configWarning: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    marginBottom: 16,
    padding: 12,
  },
  configWarningTitle: {
    color: colors.danger,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    marginBottom: 4,
  },
  configWarningText: {
    color: colors.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    lineHeight: 18,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 7,
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    minHeight: 56,
    justifyContent: 'center',
    marginTop: 4,
    ...shadowHard,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    opacity: 0.88,
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
  primaryButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
    letterSpacing: 0,
  },
  microCopy: {
    color: colors.textMuted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 23, 18, 0.42)',
    elevation: 999,
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    zIndex: 999,
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxWidth: 380,
    padding: 18,
    width: '100%',
    ...shadowHard,
  },
  modalTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  modalCircle: {
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 3,
    height: 40,
    width: 40,
  },
  modalLine: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    height: 20,
  },
  modalKicker: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 8,
  },
  modalTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 42,
    lineHeight: 48,
  },
  modalText: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  modalButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 52,
    ...shadowHard,
  },
  modalButtonPressed: {
    backgroundColor: colors.primaryDark,
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
  modalButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
});
