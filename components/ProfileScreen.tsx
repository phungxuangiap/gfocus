import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, shadowHard } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { toggleAppMode } from '../store/appSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';

type ProfileForm = {
  email: string;
  username: string;
  blockDurationMinutes: string;
  strictThresholdPercent: string;
  blankBlockMinPercent: string;
  enableAutoReorder: boolean;
  enableMascot: boolean;
};

type ProfileSubTab = 'info' | 'settings';

type SettingsSnapshot = Pick<
  ProfileForm,
  | 'blockDurationMinutes'
  | 'strictThresholdPercent'
  | 'blankBlockMinPercent'
  | 'enableAutoReorder'
  | 'enableMascot'
>;

const defaultSettings = {
  blockDurationMinutes: '5',
  strictThresholdPercent: '80',
  blankBlockMinPercent: '20',
  enableAutoReorder: true,
  enableMascot: true,
};

export function ProfileScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const appMode = useAppSelector((state) => state.app.mode);
  const strictModeEnabled = useAppSelector((state) => state.app.strictModeEnabled);
  const session = useAppSelector((state) => state.auth.session);
  const [form, setForm] = useState<ProfileForm>({
    email: session?.user.email ?? '',
    username: '',
    ...defaultSettings,
  });
  const [activeSubTab, setActiveSubTab] = useState<ProfileSubTab>('info');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmSettingsVisible, setConfirmSettingsVisible] = useState(false);
  const [savedSettings, setSavedSettings] = useState<SettingsSnapshot>(defaultSettings);

  const userId = session?.user.id;
  const settingsChanged =
    savedSettings.blockDurationMinutes !== form.blockDurationMinutes ||
    savedSettings.strictThresholdPercent !== form.strictThresholdPercent ||
    savedSettings.blankBlockMinPercent !== form.blankBlockMinPercent ||
    savedSettings.enableAutoReorder !== form.enableAutoReorder ||
    savedSettings.enableMascot !== form.enableMascot;

  useEffect(() => {
    async function loadProfile() {
      if (!supabase || !session || !userId) {
        setLoading(false);
        return;
      }

      setLoading(true);

      const fallbackEmail = session.user.email ?? '';
      const fallbackUsername = fallbackEmail.split('@')[0] || 'gfocus-user';

      const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('email, username')
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        Alert.alert('Profile load failed', userError.message);
        setLoading(false);
        return;
      }

      const nextEmail = userRow?.email ?? fallbackEmail;
      const nextUsername = userRow?.username ?? fallbackUsername;

      if (!userRow) {
        const { error } = await supabase.from('users').upsert(
          {
            id: userId,
            email: nextEmail,
            username: nextUsername,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );

        if (error) {
          Alert.alert('Profile setup failed', error.message);
          setLoading(false);
          return;
        }
      }

      const { data: settingsRow, error: settingsError } = await supabase
        .from('user_settings')
        .select('block_duration_minutes, strict_threshold_percent, blank_block_min_percent, enable_auto_reorder, enable_mascot')
        .eq('user_id', userId)
        .maybeSingle();

      if (settingsError) {
        Alert.alert('Settings load failed', settingsError.message);
        setLoading(false);
        return;
      }

      if (!settingsRow) {
        const { error } = await supabase.from('user_settings').upsert(
          {
            user_id: userId,
            block_duration_minutes: Number(defaultSettings.blockDurationMinutes),
            strict_threshold_percent: Number(defaultSettings.strictThresholdPercent),
            blank_block_min_percent: Number(defaultSettings.blankBlockMinPercent),
            enable_auto_reorder: defaultSettings.enableAutoReorder,
            enable_mascot: defaultSettings.enableMascot,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );

        if (error) {
          Alert.alert('Settings setup failed', error.message);
          setLoading(false);
          return;
        }
      }

      const nextSettings = {
        blockDurationMinutes: String(settingsRow?.block_duration_minutes ?? defaultSettings.blockDurationMinutes),
        strictThresholdPercent: String(settingsRow?.strict_threshold_percent ?? defaultSettings.strictThresholdPercent),
        blankBlockMinPercent: String(settingsRow?.blank_block_min_percent ?? defaultSettings.blankBlockMinPercent),
        enableAutoReorder: settingsRow?.enable_auto_reorder ?? defaultSettings.enableAutoReorder,
        enableMascot: settingsRow?.enable_mascot ?? defaultSettings.enableMascot,
      };

      setSavedSettings(nextSettings);
      setForm({
        email: nextEmail,
        username: nextUsername,
        ...nextSettings,
      });
      setLoading(false);
    }

    loadProfile();
  }, [session, userId]);

  function updateForm<Key extends keyof ProfileForm>(key: Key, value: ProfileForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validateSettings() {
    const blockDuration = Number(form.blockDurationMinutes);
    const strictThreshold = Number(form.strictThresholdPercent);
    const blankBlockMin = Number(form.blankBlockMinPercent);

    if (![blockDuration, strictThreshold, blankBlockMin].every(Number.isFinite)) {
      Alert.alert('Check settings', 'Numeric settings must be valid numbers.');
      return null;
    }

    return {
      blockDuration,
      strictThreshold,
      blankBlockMin,
    };
  }

  function requestSaveSettings() {
    if (!settingsChanged) {
      return;
    }

    const nextSettings = validateSettings();

    if (!nextSettings) {
      return;
    }

    setConfirmSettingsVisible(true);
  }

  async function saveSettings() {
    if (!supabase || !userId) {
      return;
    }

    const nextSettings = validateSettings();

    if (!nextSettings) {
      return;
    }

    setSaving(true);
    setConfirmSettingsVisible(false);

    const { error: settingsError } = await supabase.from('user_settings').upsert(
      {
        user_id: userId,
        block_duration_minutes: nextSettings.blockDuration,
        strict_threshold_percent: nextSettings.strictThreshold,
        blank_block_min_percent: nextSettings.blankBlockMin,
        enable_auto_reorder: form.enableAutoReorder,
        enable_mascot: form.enableMascot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    setSaving(false);

    if (settingsError) {
      Alert.alert('Save failed', settingsError.message);
      return;
    }

    setSavedSettings({
      blockDurationMinutes: form.blockDurationMinutes,
      strictThresholdPercent: form.strictThresholdPercent,
      blankBlockMinPercent: form.blankBlockMinPercent,
      enableAutoReorder: form.enableAutoReorder,
      enableMascot: form.enableMascot,
    });
    Alert.alert('Settings saved', 'Your user settings are up to date.');
  }

  if (loading) {
    return (
      <View style={styles.loadingPanel}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: 112 + insets.bottom }]}
      style={[styles.screen, strictModeEnabled && styles.screenStrict]}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>USER MODULE</Text>
        <Text style={styles.title}>PROFILE</Text>
        <Text style={styles.subtitle}>Manage your identity, block rules, and app mode.</Text>
      </View>

      <View style={styles.subTabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeSubTab === 'info' }}
          onPress={() => setActiveSubTab('info')}
          style={[styles.subTab, activeSubTab === 'info' && styles.subTabActive]}
        >
          <Text style={[styles.subTabText, activeSubTab === 'info' && styles.subTabTextActive]}>INFO</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeSubTab === 'settings' }}
          onPress={() => setActiveSubTab('settings')}
          style={[styles.subTab, activeSubTab === 'settings' && styles.subTabActive]}
        >
          <Text style={[styles.subTabText, activeSubTab === 'settings' && styles.subTabTextActive]}>SETTINGS</Text>
        </Pressable>
      </View>

      {activeSubTab === 'info' ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>USER INFORMATION</Text>
            <ReadOnlyRow label="EMAIL" value={form.email} />
            <ReadOnlyRow label="USERNAME" value={form.username} />
            <ReadOnlyRow label="USER ID" value={userId ?? '-'} />
            <Text style={styles.helperText}>Profile editing and password changes are disabled for now.</Text>
          </View>
        </>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>USER SETTINGS</Text>
            <Field
              keyboardType="numeric"
              label="BLOCK DURATION MINUTES"
              onChangeText={(value) => updateForm('blockDurationMinutes', value)}
              value={form.blockDurationMinutes}
            />
            <Field
              keyboardType="numeric"
              label="STRICT THRESHOLD PERCENT"
              onChangeText={(value) => updateForm('strictThresholdPercent', value)}
              value={form.strictThresholdPercent}
            />
            <Field
              keyboardType="numeric"
              label="BLANK BLOCK MIN PERCENT"
              onChangeText={(value) => updateForm('blankBlockMinPercent', value)}
              value={form.blankBlockMinPercent}
            />

            <ToggleRow
              label="AUTO REORDER"
              onValueChange={(value) => updateForm('enableAutoReorder', value)}
              value={form.enableAutoReorder}
            />
            <ToggleRow
              label="MASCOT"
              onValueChange={(value) => updateForm('enableMascot', value)}
              value={form.enableMascot}
            />

          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>APP MODE</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: appMode === 'focus' }}
              onPress={() => dispatch(toggleAppMode())}
              style={styles.modeToggle}
            >
              <View style={[styles.modeOption, appMode === 'plan' && styles.modeOptionActive]}>
                <Text style={[styles.modeText, appMode === 'plan' && styles.modeTextActive]}>PLAN</Text>
              </View>
              <View style={[styles.modeOption, appMode === 'focus' && styles.modeOptionActive]}>
                <Text style={[styles.modeText, appMode === 'focus' && styles.modeTextActive]}>FOCUS</Text>
              </View>
            </Pressable>
          </View>

          {/*
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NOTIFICATION TEST</Text>
            <Text style={styles.helperText}>Send a local notification to verify notification permission and scheduling.</Text>
            <Pressable accessibilityRole="button" onPress={sendNotificationTest} style={styles.notificationButton}>
              <Text style={styles.notificationButtonText}>SEND NOTIFICATION</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={sendStrictSessionStartNotificationTest}
              style={[styles.notificationButton, styles.strictNotificationButton]}
            >
              <Text style={styles.strictNotificationButtonText}>TEST SESSION START</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={scheduleBackgroundNotificationAfter10Seconds}
              style={[styles.notificationButton, styles.scheduledNotificationButton]}
            >
              <Text style={styles.scheduledNotificationButtonText}>Background notification after 10s</Text>
            </Pressable>
          </View>
          */}

          <Pressable
            accessibilityRole="button"
            disabled={saving || !settingsChanged}
            onPress={requestSaveSettings}
            style={({ pressed }) => [
              styles.primaryButton,
              !settingsChanged && styles.primaryButtonDisabled,
              (pressed || saving) && settingsChanged && styles.primaryButtonPressed,
            ]}
          >
            {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.primaryButtonText}>SAVE SETTINGS</Text>}
          </Pressable>

          <Pressable accessibilityRole="button" onPress={() => supabase?.auth.signOut()} style={styles.signOutButton}>
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </Pressable>
        </>
      )}

      <Modal
        animationType="fade"
        navigationBarTranslucent
        onRequestClose={() => setConfirmSettingsVisible(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={confirmSettingsVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalTop}>
              <View style={styles.modalCircle} />
              <View style={styles.modalLine} />
            </View>

            <Text style={styles.modalKicker}>CONFIRM SETTINGS</Text>
            <Text style={styles.modalTitle}>CHECK CHANGES</Text>
            <View style={styles.changeList}>
              <ChangeRow label="BLOCK MINUTES" nextValue={form.blockDurationMinutes} previousValue={savedSettings.blockDurationMinutes} />
              <ChangeRow label="STRICT THRESHOLD" nextValue={`${form.strictThresholdPercent}%`} previousValue={`${savedSettings.strictThresholdPercent}%`} />
              <ChangeRow label="BLANK BLOCK MIN" nextValue={`${form.blankBlockMinPercent}%`} previousValue={`${savedSettings.blankBlockMinPercent}%`} />
              <ChangeRow label="AUTO REORDER" nextValue={formatToggle(form.enableAutoReorder)} previousValue={formatToggle(savedSettings.enableAutoReorder)} />
              <ChangeRow label="MASCOT" nextValue={formatToggle(form.enableMascot)} previousValue={formatToggle(savedSettings.enableMascot)} />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmSettingsVisible(false)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>CANCEL</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={saveSettings}
                style={({ pressed }) => [styles.modalButton, (pressed || saving) && styles.modalButtonPressed]}
              >
                {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.modalButtonText}>CONFIRM</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/*
      <Modal
        animationType="fade"
        onRequestClose={checkInStrictSessionStartTest}
        transparent
        visible={strictCheckInVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.strictModalCard]}>
            <View style={styles.modalTop}>
              <View style={[styles.modalCircle, styles.strictModalCircle]} />
              <View style={[styles.modalLine, styles.strictModalLine]} />
            </View>

            <Text style={styles.modalKicker}>STRICT ALERT</Text>
            <Text style={styles.modalTitle}>SESSION START</Text>
            <Text style={styles.strictModalBody}>
              Your focus session is starting now. Check in to stop the repeating alert sound.
            </Text>

            <Pressable
              accessibilityRole="button"
              onPress={checkInStrictSessionStartTest}
              style={({ pressed }) => [styles.checkInButton, pressed && styles.modalButtonPressed]}
            >
              <Text style={styles.checkInButtonText}>CHECK IN</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      */}
    </ScrollView>
  );
}

type FieldProps = {
  keyboardType?: 'default' | 'numeric';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
};

function Field({ keyboardType = 'default', label, onChangeText, value }: FieldProps) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textSoft}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

type ReadOnlyRowProps = {
  label: string;
  value: string;
};

function ReadOnlyRow({ label, value }: ReadOnlyRowProps) {
  return (
    <View style={styles.readOnlyRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.readOnlyValue}>{value}</Text>
    </View>
  );
}

type ToggleRowProps = {
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
};

function ToggleRow({ label, onValueChange, value }: ToggleRowProps) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        ios_backgroundColor={colors.textSoft}
        onValueChange={onValueChange}
        thumbColor={value ? colors.paper : colors.bg}
        trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

type ChangeRowProps = {
  label: string;
  nextValue: string;
  previousValue: string;
};

function ChangeRow({ label, nextValue, previousValue }: ChangeRowProps) {
  const changed = previousValue !== nextValue;

  return (
    <View style={[styles.changeRow, changed && styles.changeRowActive]}>
      <Text style={styles.changeLabel}>{label}</Text>
      <View style={styles.changeValues}>
        <Text style={styles.previousValue}>{previousValue}</Text>
        <Text style={styles.changeArrow}>TO</Text>
        <Text style={styles.nextValue}>{nextValue}</Text>
      </View>
    </View>
  );
}

function formatToggle(value: boolean) {
  return value ? 'ON' : 'OFF';
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  screenStrict: {
    backgroundColor: colors.strictBg,
  },
  content: {
    padding: 20,
  },
  loadingPanel: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 18,
  },
  kicker: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 54,
    lineHeight: 62,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 21,
  },
  subTabs: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 18,
  },
  subTab: {
    flex: 1,
    paddingVertical: 13,
  },
  subTabActive: {
    backgroundColor: colors.primary,
  },
  subTabText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 13,
    letterSpacing: 1,
    textAlign: 'center',
  },
  subTabTextActive: {
    color: colors.paper,
  },
  section: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 18,
    padding: 16,
    ...shadowHard,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 14,
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
    minHeight: 50,
    paddingHorizontal: 12,
  },
  helperText: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    lineHeight: 18,
    marginTop: -2,
  },
  readOnlyRow: {
    borderColor: colors.border,
    borderBottomWidth: 2,
    marginBottom: 14,
    paddingBottom: 12,
  },
  readOnlyValue: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    lineHeight: 22,
  },
  toggleRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderTopWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  toggleLabel: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  modeToggle: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
  },
  modeOption: {
    flex: 1,
    paddingVertical: 13,
  },
  modeOptionActive: {
    backgroundColor: colors.primary,
  },
  modeText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 13,
    textAlign: 'center',
  },
  modeTextActive: {
    color: colors.paper,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    minHeight: 56,
    ...shadowHard,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
    opacity: 0.88,
    transform: [{ translateX: 2 }, { translateY: 2 }],
  },
  primaryButtonDisabled: {
    backgroundColor: colors.textSoft,
    shadowOpacity: 0,
  },
  primaryButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
  notificationButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 54,
    ...shadowHard,
  },
  notificationButtonText: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
  strictNotificationButton: {
    backgroundColor: colors.text,
  },
  strictNotificationButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
  scheduledNotificationButton: {
    backgroundColor: colors.primary,
  },
  scheduledNotificationButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 20,
  },
  signOutButton: {
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  signOutText: {
    color: colors.danger,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
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
    maxWidth: 420,
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
  changeList: {
    borderColor: colors.border,
    borderTopWidth: 2,
    marginTop: 14,
  },
  changeRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
  },
  changeRowActive: {
    backgroundColor: colors.surfaceMuted,
  },
  changeLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  changeValues: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  previousValue: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    textDecorationLine: 'line-through',
  },
  changeArrow: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  nextValue: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
  modalButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
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
  strictModalCard: {
    backgroundColor: colors.bg,
  },
  strictModalCircle: {
    backgroundColor: colors.danger,
  },
  strictModalLine: {
    backgroundColor: colors.primary,
  },
  strictModalBody: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  checkInButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 58,
    ...shadowHard,
  },
  checkInButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 28,
  },
});
