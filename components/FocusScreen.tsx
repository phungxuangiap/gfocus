import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, shadowHard } from '../constants/theme';
import { startSessionStartAlertSound, stopSessionStartRepeatingSound, type SessionStartNotificationEvent } from '../lib/notifications';

type FocusScreenProps = {
  checkoutAlarmEvent?: SessionStartNotificationEvent | null;
  event: SessionStartNotificationEvent;
  finishing: boolean;
  onFinish: () => void;
};

export function FocusScreen({ checkoutAlarmEvent, event, finishing, onFinish }: FocusScreenProps) {
  const plannedEndTime = useMemo(() => {
    const fallback = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return event.plannedEndTime ?? fallback;
  }, [event.plannedEndTime]);
  const [remainingMs, setRemainingMs] = useState(() => getRemainingMs(plannedEndTime));
  const [finishModalVisible, setFinishModalVisible] = useState(() => getRemainingMs(plannedEndTime) <= 0);

  useEffect(() => {
    lockOrientation('landscape');

    return () => {
      stopSessionStartRepeatingSound('focus screen unmounted');
      lockOrientation('portrait');
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const nextRemaining = getRemainingMs(plannedEndTime);
      setRemainingMs(nextRemaining);

      if (nextRemaining <= 0) {
        setFinishModalVisible(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [plannedEndTime]);

  useEffect(() => {
    if (!finishModalVisible) {
      return;
    }

    startSessionStartAlertSound().catch((error) => {
      console.log('[focus] finish alert sound failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [finishModalVisible]);

  useEffect(() => {
    if (!checkoutAlarmEvent || checkoutAlarmEvent.sessionId !== event.sessionId) {
      return;
    }

    setFinishModalVisible(true);
  }, [checkoutAlarmEvent, event.sessionId]);

  function finishSession() {
    stopSessionStartRepeatingSound('finish session clicked');
    onFinish();
  }

  return (
    <View style={styles.screen}>
      <View style={styles.infoRail}>
        <Text style={styles.kicker}>FOCUS MODE</Text>
        <Text numberOfLines={1} style={styles.title}>{event.title ?? 'SESSION'}</Text>
        <View style={styles.metaRow}>
          <InfoPill label="TASK" value={event.taskTitle ?? 'NO TASK DETAIL'} />
          <InfoPill label="CATEGORY" value={event.categoryName ?? 'NO CATEGORY'} />
          <InfoPill label="ENDS" value={formatClock(plannedEndTime)} />
        </View>
      </View>

      <View style={styles.clockWrap}>
        <Text style={styles.clock}>{formatCountdown(remainingMs)}</Text>
        <Text style={styles.clockLabel}>REMAINING UNTIL PLANNED END</Text>
      </View>

      <Modal animationType="fade" navigationBarTranslucent onRequestClose={() => undefined} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={finishModalVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalKicker}>SESSION COMPLETE</Text>
            <Text style={styles.modalTitle}>FINISH?</Text>
            <Text style={styles.modalBody}>The planned session time is over. Confirm finish to stop the alert and return.</Text>
            <Pressable accessibilityRole="button" disabled={finishing} onPress={finishSession} style={styles.finishButton}>
              {finishing ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.finishButtonText}>FINISH</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoPill}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function getRemainingMs(plannedEndTime: string) {
  return Math.max(0, new Date(plannedEndTime).getTime() - Date.now());
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatClock(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

async function lockOrientation(mode: 'landscape' | 'portrait') {
  try {
    const ScreenOrientation = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
    await ScreenOrientation.lockAsync(
      mode === 'landscape'
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
  } catch (error) {
    console.log(`[focus] ${mode} lock failed`, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'space-between',
    padding: 24,
  },
  infoRail: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    padding: 14,
    ...shadowHard,
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
    fontSize: 36,
    lineHeight: 42,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  infoPill: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  infoLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 9,
    letterSpacing: 1,
  },
  infoValue: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    marginTop: 3,
  },
  clockWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  clock: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 104,
    lineHeight: 112,
  },
  clockLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 23, 18, 0.48)',
    elevation: 999,
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    zIndex: 999,
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxWidth: 420,
    padding: 20,
    width: '100%',
    ...shadowHard,
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
    fontSize: 44,
    lineHeight: 50,
  },
  modalBody: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  finishButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 56,
    ...shadowHard,
  },
  finishButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 24,
  },
});
