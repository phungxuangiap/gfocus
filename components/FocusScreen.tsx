import { useEffect, useMemo, useRef, useState } from 'react';
import { useKeepAwake } from 'expo-keep-awake';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, shadowHard } from '../constants/theme';
import { startSessionStartAlertSound, stopSessionStartRepeatingSound, type SessionStartNotificationEvent } from '../lib/notifications';

const circleSize = 320;
const circleDotSize = 22;
const circleRadius = circleSize / 2 - 14;

type FocusScreenProps = {
  checkoutAlarmEvent?: SessionStartNotificationEvent | null;
  event: SessionStartNotificationEvent;
  finishing: boolean;
  onFinish: () => void;
};

export function FocusScreen({ checkoutAlarmEvent, event, finishing, onFinish }: FocusScreenProps) {
  useKeepAwake();

  const plannedEndTime = useMemo(() => {
    const fallback = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return event.plannedEndTime ?? fallback;
  }, [event.plannedEndTime]);
  const plannedStartTime = useMemo(() => {
    const fallback = new Date(Date.now()).toISOString();
    return event.plannedStartTime ?? fallback;
  }, [event.plannedStartTime]);
  const [remainingMs, setRemainingMs] = useState(() => getRemainingMs(plannedEndTime));
  const [finishModalVisible, setFinishModalVisible] = useState(() => getRemainingMs(plannedEndTime) <= 0);
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const progress = getCountdownProgress(plannedStartTime, plannedEndTime, remainingMs);
  const progressDotStyle = getProgressDotStyle(progress);

  useEffect(() => {
    lockOrientation('landscape');

    return () => {
      stopSessionStartRepeatingSound('focus screen unmounted');
      lockOrientation('portrait');
    };
  }, []);

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          duration: 1900,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          duration: 1900,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    floatLoop.start();
    pulseLoop.start();

    return () => {
      floatLoop.stop();
      pulseLoop.stop();
    };
  }, [floatAnim, pulseAnim]);

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
      <View style={styles.topRail}>
        <Text style={styles.kicker}>FOCUS MODE</Text>
        <Text style={styles.endsText}>ENDS {formatClock(plannedEndTime)}</Text>
      </View>

      <View style={styles.focusStage}>
        <View style={styles.circleStack}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.circlePulse,
              {
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.24, 0.42],
                }),
                transform: [
                  {
                    scale: pulseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.96, 1.04],
                    }),
                  },
                ],
              },
            ]}
          />
          <View style={styles.countdownCircle}>
            <View style={styles.circleTrack} />
            <View style={[styles.progressDot, progressDotStyle]} />
            <View style={styles.circleTickTop} />
            <View style={styles.circleTickRight} />
            <View style={styles.circleTickBottom} />
            <View style={styles.circleTickLeft} />

            <Animated.View
              style={[
                styles.sessionOverlay,
                {
                  opacity: floatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.9, 1],
                  }),
                  transform: [
                    {
                      translateY: floatAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -6],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Text numberOfLines={1} style={styles.overlayTitle}>{event.title ?? 'SESSION'}</Text>
              <Text numberOfLines={1} style={styles.overlayTask}>{event.taskTitle ?? 'NO TASK DETAIL'}</Text>
            </Animated.View>

            <View style={styles.clockWrap}>
              <Text style={styles.clock}>{formatCountdown(remainingMs)}</Text>
              <Text style={styles.clockLabel}>REMAINING</Text>
            </View>
          </View>
        </View>

        <View style={styles.metaRow}>
          <InfoPill label="CATEGORY" value={event.categoryName ?? 'NO CATEGORY'} />
          <InfoPill label="PROGRESS" value={`${Math.round(progress * 100)}%`} />
        </View>
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

function getCountdownProgress(plannedStartTime: string, plannedEndTime: string, remainingMs: number) {
  const start = new Date(plannedStartTime).getTime();
  const end = new Date(plannedEndTime).getTime();
  const duration = Math.max(1, end - start);
  const elapsed = Math.max(0, duration - remainingMs);
  return Math.min(1, Math.max(0, elapsed / duration));
}

function getProgressDotStyle(progress: number) {
  const angle = -Math.PI / 2 + progress * Math.PI * 2;
  const center = circleSize / 2;

  return {
    left: center + Math.cos(angle) * circleRadius - circleDotSize / 2,
    top: center + Math.sin(angle) * circleRadius - circleDotSize / 2,
  };
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
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  topRail: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 14,
    left: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    position: 'absolute',
    top: 18,
    ...shadowHard,
  },
  kicker: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  endsText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  focusStage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleStack: {
    height: circleSize,
    position: 'relative',
    width: circleSize,
  },
  circlePulse: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 3,
    height: circleSize + 28,
    left: -14,
    position: 'absolute',
    top: -14,
    width: circleSize + 28,
  },
  countdownCircle: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 4,
    height: circleSize,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: circleSize,
    ...shadowHard,
  },
  circleTrack: {
    borderColor: colors.primary,
    borderRadius: 999,
    borderWidth: 4,
    bottom: 12,
    left: 12,
    opacity: 0.55,
    position: 'absolute',
    right: 12,
    top: 12,
  },
  progressDot: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 3,
    height: circleDotSize,
    position: 'absolute',
    width: circleDotSize,
    zIndex: 4,
  },
  circleTickTop: {
    backgroundColor: colors.border,
    height: 18,
    position: 'absolute',
    top: 12,
    width: 4,
  },
  circleTickRight: {
    backgroundColor: colors.border,
    height: 4,
    position: 'absolute',
    right: 12,
    width: 18,
  },
  circleTickBottom: {
    backgroundColor: colors.border,
    bottom: 12,
    height: 18,
    position: 'absolute',
    width: 4,
  },
  circleTickLeft: {
    backgroundColor: colors.border,
    height: 4,
    left: 12,
    position: 'absolute',
    width: 18,
  },
  sessionOverlay: {
    alignItems: 'center',
    left: 42,
    position: 'absolute',
    right: 42,
    top: 48,
    zIndex: 3,
  },
  overlayTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 27,
    lineHeight: 33,
    textAlign: 'center',
  },
  overlayTask: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 2,
    textAlign: 'center',
  },
  clockWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 38,
    zIndex: 2,
  },
  clock: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 78,
    lineHeight: 84,
  },
  clockLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    width: circleSize,
  },
  infoPill: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    flex: 1,
    minHeight: 44,
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
