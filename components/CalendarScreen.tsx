import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, shadowHard } from '../constants/theme';
import {
  blockDurationMinutes,
  blocksPerDay,
  blocksPerGridSegment,
  blocksPerHour,
  calendarHours,
  checkInGraceMinutes,
  gridSegmentsPerHour,
} from '../constants/timeBlocks';
import {
  reorderTodaySessions,
  type DynamicSessionOrderResult,
  type NextDayMoveDecision,
  type NextDayMoveRequest,
} from '../lib/dynamicSessionOrder';
import {
  cancelSessionCheckInNotification,
  cancelSessionCheckOutNotification,
  markSessionStartNotificationReadBySessionId,
  scheduleSessionCheckInNotification,
  scheduleSessionCheckOutNotification,
} from '../lib/notifications';
import { refreshStrictModeForDate } from '../lib/strictMode';
import { supabase } from '../lib/supabase';
import { setCalendarView, setFocusSession, setStrictModeEnabled, type CalendarView } from '../store/appSlice';
import { useAppDispatch, useAppSelector } from '../store/hooks';

type CreationMode = 'category' | 'task' | 'session';
type SessionType = 'immutable' | 'mutable';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

type TaskTypeRow = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority | null;
  task_type_id: string | null;
};

type SessionRow = {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  session_type: SessionType;
  planned_start_time: string;
  planned_end_time: string;
  actual_end_time: string | null;
  block_count: number;
  checked_in: boolean | null;
  tasks: {
    title: string;
    priority: TaskPriority | null;
    task_types: {
      name: string;
      color: string | null;
    } | null;
  } | null;
};

type SessionBlockSegment = {
  blockDate: string;
  blockIndexes: number[];
  date: Date;
};

type SessionDaySegment = {
  blockCount: number;
  end: Date;
  start: Date;
};

const viewOptions: CalendarView[] = ['day', 'week', 'month'];
const priorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
const sessionTypes: SessionType[] = ['mutable', 'immutable'];
const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const dayBlockHeight = 7;
const weekBlockHeight = 4;

const initialCategory = {
  name: '',
  description: '',
  color: '#b6b56b',
};

const initialTask = {
  title: '',
  description: '',
  priority: 'medium' as TaskPriority,
  taskTypeId: '',
};

const initialSession = {
  taskId: '',
  title: '',
  description: '',
  sessionType: 'mutable' as SessionType,
  date: toDateInput(new Date()),
  startTime: '08:00',
  blockCount: '12',
};

export function CalendarScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const session = useAppSelector((state) => state.auth.session);
  const view = useAppSelector((state) => state.app.calendarView);
  const focusSession = useAppSelector((state) => state.app.focusSession);
  const strictModeEnabled = useAppSelector((state) => state.app.strictModeEnabled);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskTypeRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [categoryForm, setCategoryForm] = useState(initialCategory);
  const [taskForm, setTaskForm] = useState(initialTask);
  const [sessionForm, setSessionForm] = useState(initialSession);
  const [taskSidebarVisible, setTaskSidebarVisible] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [taskFilter, setTaskFilter] = useState('');
  const [categoryMenuVisible, setCategoryMenuVisible] = useState(false);
  const [taskMenuVisible, setTaskMenuVisible] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [sessionSaving, setSessionSaving] = useState(false);
  const [immutableCheckInSession, setImmutableCheckInSession] = useState<SessionRow | null>(null);
  const [immutableCheckingIn, setImmutableCheckingIn] = useState(false);
  const [nextDayMoveRequest, setNextDayMoveRequest] = useState<NextDayMoveRequest | null>(null);
  const [selectedNextDayStart, setSelectedNextDayStart] = useState('');
  const nextDayMoveResolver = useRef<((decision: NextDayMoveDecision) => void) | null>(null);
  const sidebarTranslate = useRef(new Animated.Value(360)).current;
  const calendarTranslate = useRef(new Animated.Value(0)).current;
  const calendarOpacity = useRef(new Animated.Value(1)).current;
  const [now, setNow] = useState(new Date());
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleDate, setVisibleDate] = useState(() => startOfDay(new Date()));
  const weekDays = useMemo(() => getWeekDays(visibleDate), [visibleDate]);
  const monthDays = useMemo(() => getMonthGrid(visibleDate), [visibleDate]);
  const visibleRange = useMemo(() => getVisibleRange(view, visibleDate), [view, visibleDate]);
  const userId = session?.user.id;
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const categoryById = useMemo(() => new Map(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const filteredTasks = useMemo(
    () => tasks.filter((task) => {
      if (categoryFilter && task.task_type_id !== categoryFilter) {
        return false;
      }

      if (taskFilter && task.id !== taskFilter) {
        return false;
      }

      return true;
    }),
    [categoryFilter, taskFilter, tasks],
  );
  const filteredSessions = useMemo(
    () => sessions.filter((item) => {
      const task = taskById.get(item.task_id);

      if (categoryFilter && task?.task_type_id !== categoryFilter) {
        return false;
      }

      if (taskFilter && item.task_id !== taskFilter) {
        return false;
      }

      return true;
    }),
    [categoryFilter, sessions, taskById, taskFilter],
  );
  const changeVisibleDate = useCallback((direction: 1 | -1) => {
    Animated.parallel([
      Animated.timing(calendarTranslate, {
        duration: 120,
        toValue: direction * -36,
        useNativeDriver: true,
      }),
      Animated.timing(calendarOpacity, {
        duration: 120,
        toValue: 0.35,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisibleDate((current) => shiftVisibleDate(current, view, direction));
      calendarTranslate.setValue(direction * 36);
      Animated.parallel([
        Animated.timing(calendarTranslate, {
          duration: 180,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(calendarOpacity, {
          duration: 180,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [calendarOpacity, calendarTranslate, view]);
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 28 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) < 48) {
          return;
        }

        changeVisibleDate(gestureState.dx < 0 ? 1 : -1);
      },
    }),
    [changeVisibleDate],
  );

  const confirmNextDayMove = useCallback((request: NextDayMoveRequest) => {
    return new Promise<NextDayMoveDecision>((resolve) => {
      nextDayMoveResolver.current = resolve;
      setSelectedNextDayStart(request.options[0]?.start ?? '');
      setNextDayMoveRequest(request);
    });
  }, []);

  const syncReorderNotifications = useCallback(async (reorderResult: DynamicSessionOrderResult) => {
    if (!userId) {
      return;
    }

    await Promise.all([
      ...reorderResult.completedSessionIds.map((sessionId) => cancelSessionCheckInNotification(sessionId)),
      ...reorderResult.movedSessionSchedules.map((item) => scheduleSessionCheckInNotification({
        categoryName: item.categoryName,
        plannedEndTime: item.plannedEndTime,
        plannedStartTime: item.plannedStartTime,
        sessionId: item.sessionId,
        taskTitle: item.taskTitle,
        title: item.title,
        userId,
      }).catch((error) => {
        console.log('[dynamic-order] reschedule notification failed', {
          message: error instanceof Error ? error.message : String(error),
          sessionId: item.sessionId,
        });
      })),
    ]);
  }, [userId]);

  useEffect(() => {
    Animated.timing(sidebarTranslate, {
      duration: 260,
      toValue: taskSidebarVisible ? 0 : 360,
      useNativeDriver: true,
    }).start();
  }, [sidebarTranslate, taskSidebarVisible]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  const loadCalendarData = useCallback(async ({ runDynamicOrder = true }: { runDynamicOrder?: boolean } = {}) => {
    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    if (runDynamicOrder) {
      const reorderResult = await reorderTodaySessions(userId, today, { confirmNextDayMove });
      await syncReorderNotifications(reorderResult);
    }

    const [{ data: typeRows, error: typeError }, { data: taskRows, error: taskError }, { data: sessionRows, error: sessionError }] =
      await Promise.all([
        supabase
          .from('task_types')
          .select('id, name, description, color')
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('tasks')
          .select('id, title, description, priority, task_type_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('sessions')
          .select('id, task_id, title, description, session_type, planned_start_time, planned_end_time, actual_end_time, block_count, checked_in, tasks(title, priority, task_types(name, color))')
          .eq('user_id', userId)
          .lt('planned_start_time', visibleRange.end.toISOString())
          .gt('planned_end_time', visibleRange.start.toISOString())
          .order('planned_start_time', { ascending: true }),
      ]);

    setLoading(false);

    if (typeError || taskError || sessionError) {
      Alert.alert('Calendar load failed', typeError?.message ?? taskError?.message ?? sessionError?.message);
      return;
    }

    setTaskTypes(typeRows ?? []);
    setTasks(taskRows ?? []);
    const loadedSessions = (sessionRows ?? []) as unknown as SessionRow[];
    setSessions(loadedSessions);

    if (!focusSession) {
      const overdueImmutableSession = loadedSessions.find((item) => isImmutableOverdueForCheckIn(item, new Date()));
      if (overdueImmutableSession) {
        setImmutableCheckInSession(overdueImmutableSession);
      }
    }

    refreshStrictModeForDate(userId, today)
      .then((enabled) => dispatch(setStrictModeEnabled(enabled)))
      .catch((error) => {
        console.log('[strict-mode] calendar refresh failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }, [confirmNextDayMove, dispatch, focusSession, syncReorderNotifications, today, userId, visibleRange]);

  function resolveNextDayMove(decision: NextDayMoveDecision) {
    nextDayMoveResolver.current?.(decision);
    nextDayMoveResolver.current = null;
    setNextDayMoveRequest(null);
    setSelectedNextDayStart('');
  }

  async function checkInImmutableSession() {
    if (!supabase || !userId || !immutableCheckInSession) {
      setImmutableCheckInSession(null);
      return;
    }

    setImmutableCheckingIn(true);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('sessions')
      .update({
        actual_start_time: now,
        checked_in: true,
      })
      .eq('id', immutableCheckInSession.id)
      .eq('user_id', userId);

    if (error) {
      setImmutableCheckingIn(false);
      Alert.alert('Check-in failed', error.message);
      return;
    }

    await cancelSessionCheckInNotification(immutableCheckInSession.id);
    await markSessionStartNotificationReadBySessionId(userId, immutableCheckInSession.id);
    await scheduleSessionCheckOutNotification({
      categoryName: immutableCheckInSession.tasks?.task_types?.name ?? null,
      plannedEndTime: immutableCheckInSession.planned_end_time,
      plannedStartTime: immutableCheckInSession.planned_start_time,
      sessionId: immutableCheckInSession.id,
      taskTitle: immutableCheckInSession.tasks?.title ?? null,
      title: immutableCheckInSession.title,
      userId,
    }).catch((scheduleError) => {
      console.log('[notifications] immutable checkout schedule failed', {
        message: scheduleError instanceof Error ? scheduleError.message : String(scheduleError),
        sessionId: immutableCheckInSession.id,
      });
    });
    dispatch(setFocusSession({
      categoryName: immutableCheckInSession.tasks?.task_types?.name ?? null,
      notificationId: `immutable-overdue-${immutableCheckInSession.id}`,
      plannedEndTime: immutableCheckInSession.planned_end_time,
      plannedStartTime: immutableCheckInSession.planned_start_time,
      sessionId: immutableCheckInSession.id,
      taskTitle: immutableCheckInSession.tasks?.title ?? null,
      title: immutableCheckInSession.title,
      userId,
    }));
    setImmutableCheckingIn(false);
    setImmutableCheckInSession(null);
  }

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  async function scheduleSessionCheckIn(
    sessionId: string,
    form: typeof initialSession,
    start: Date,
    end: Date,
  ) {
    if (!userId) {
      return;
    }

    if (form.sessionType === 'immutable' && start.getTime() <= Date.now()) {
      await cancelSessionCheckInNotification(sessionId);
      await markSessionStartNotificationReadBySessionId(userId, sessionId);
      return;
    }

    const task = taskById.get(form.taskId);
    const category = task?.task_type_id ? categoryById.get(task.task_type_id) : null;

    try {
      await scheduleSessionCheckInNotification({
        categoryName: category?.name ?? null,
        plannedEndTime: end.toISOString(),
        plannedStartTime: start.toISOString(),
        sessionId,
        taskTitle: task?.title ?? null,
        title: form.title.trim(),
        userId,
      });
    } catch (error) {
      Alert.alert(
        'Notification schedule failed',
        error instanceof Error ? error.message : 'The session was saved, but its check-in notification was not scheduled.',
      );
    }
  }

  async function updateSelectedSession(form: typeof initialSession) {
    if (!supabase || !userId || !selectedSession || !form.taskId || !form.title.trim()) {
      Alert.alert('Check session', 'Task and session title are required.');
      return false;
    }

    if (isSessionCompleted(selectedSession)) {
      Alert.alert('Session locked', 'Completed sessions are immutable and cannot be updated.');
      return false;
    }

    const blockCount = Number(form.blockCount);
    const start = parseLocalDateTime(form.date, form.startTime);

    if (!start || !Number.isInteger(blockCount) || blockCount <= 0) {
      Alert.alert('Check session', 'Use a valid date, start time, and positive block count.');
      return false;
    }

    if (start.getMinutes() % blockDurationMinutes !== 0) {
      Alert.alert('Check session', `Sessions must start on a ${blockDurationMinutes}-minute block.`);
      return false;
    }

    const end = new Date(start.getTime() + blockCount * blockDurationMinutes * 60 * 1000);
    if (start.getTime() >= end.getTime()) {
      Alert.alert('Check session', 'Session start time must be before end time.');
      return false;
    }

    const blockSegments = getSessionBlockSegments(start, blockCount);

    setSessionSaving(true);
    await ensureSessionTimeBlocks(userId, blockSegments);

    let blocks: Array<{ id: string; session_id: string | null }>;
    try {
      blocks = await loadTimeBlocksForSegments(userId, blockSegments);
    } catch (blockError) {
      setSessionSaving(false);
      Alert.alert('Session check failed', blockError instanceof Error ? blockError.message : 'Could not check time blocks.');
      return false;
    }

    if (blocks.length !== getTotalSegmentBlockCount(blockSegments)) {
      setSessionSaving(false);
      Alert.alert('Conflict detected', 'One or more selected time blocks are not available.');
      return false;
    }

    const occupiedSessionIds = Array.from(new Set(blocks
      .map((block) => block.session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId) && sessionId !== selectedSession.id)));

    if (occupiedSessionIds.length > 0) {
      const { data: occupiedSessions, error: occupiedError } = await supabase
        .from('sessions')
        .select('id, session_type, checked_in, actual_end_time')
        .eq('user_id', userId)
        .in('id', occupiedSessionIds);

      if (occupiedError) {
        setSessionSaving(false);
        Alert.alert('Conflict check failed', occupiedError.message);
        return false;
      }

      const hasLockedConflict = (occupiedSessions ?? []).some((item) => {
        return Boolean(item.actual_end_time) || item.checked_in === true || item.session_type === 'immutable';
      });

      if (hasLockedConflict) {
        setSessionSaving(false);
        Alert.alert('Conflict detected', 'The selected time range overlaps an immutable session.');
        return false;
      }
    }

    setSessionSaving(false);
    const reorderResult = await reorderTodaySessions(userId, start, {
      abortOnCanceledNextDayMove: true,
      confirmNextDayMove,
      excludedSessionIds: [selectedSession.id],
      reservedIntervals: [{ start, end }],
    });

    if (reorderResult.canceledNextDayMoveCount > 0) {
      Alert.alert('Session not updated', 'Confirm the next-day move schedule before updating this session.');
      return false;
    }

    await syncReorderNotifications(reorderResult);
    setSessionSaving(true);
    await ensureSessionTimeBlocks(userId, blockSegments);

    const { error: clearError } = await supabase
      .from('time_blocks')
      .update({ session_id: null })
      .eq('user_id', userId)
      .eq('session_id', selectedSession.id);

    if (clearError) {
      setSessionSaving(false);
      Alert.alert('Update session failed', clearError.message);
      return false;
    }

    const { error: sessionError } = await supabase
      .from('sessions')
      .update({
        task_id: form.taskId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        session_type: form.sessionType,
        planned_start_time: start.toISOString(),
        planned_end_time: end.toISOString(),
        block_count: blockCount,
      })
      .eq('user_id', userId)
      .eq('id', selectedSession.id);

    if (sessionError) {
      setSessionSaving(false);
      Alert.alert('Update session failed', sessionError.message);
      return false;
    }

    const assignError = await assignTimeBlocksForSegments(userId, selectedSession.id, blockSegments);

    setSessionSaving(false);

    if (assignError) {
      Alert.alert('Assign blocks failed', assignError.message);
      return false;
    }

    await scheduleSessionCheckIn(selectedSession.id, form, start, end);
    await loadCalendarData();
    setSelectedSession(null);
    return true;
  }

  async function deleteSelectedSession() {
    if (!supabase || !userId || !selectedSession) {
      return;
    }

    if (isSessionCompleted(selectedSession)) {
      Alert.alert('Session locked', 'Completed sessions are immutable and cannot be deleted.');
      return;
    }

    setSessionSaving(true);
    const { error: clearError } = await supabase
      .from('time_blocks')
      .update({ session_id: null })
      .eq('user_id', userId)
      .eq('session_id', selectedSession.id);

    if (clearError) {
      setSessionSaving(false);
      Alert.alert('Delete session failed', clearError.message);
      return;
    }

    const { error: deleteError } = await supabase
      .from('sessions')
      .delete()
      .eq('user_id', userId)
      .eq('id', selectedSession.id);

    setSessionSaving(false);

    if (deleteError) {
      Alert.alert('Delete session failed', deleteError.message);
      return;
    }

    await cancelSessionCheckInNotification(selectedSession.id);
    await cancelSessionCheckOutNotification(selectedSession.id);
    setSelectedSession(null);
    loadCalendarData();
  }

  async function createCategory() {
    if (!supabase || !userId || !categoryForm.name.trim()) {
      Alert.alert('Check category', 'Category name is required.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('task_types').insert({
      user_id: userId,
      name: categoryForm.name.trim(),
      description: categoryForm.description.trim() || null,
      color: categoryForm.color.trim() || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Create category failed', error.message);
      return;
    }

    setCategoryForm(initialCategory);
    setCreationMode(null);
    loadCalendarData();
  }

  async function createTask() {
    if (!supabase || !userId || !taskForm.title.trim()) {
      Alert.alert('Check task', 'Task title is required.');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('tasks').insert({
      user_id: userId,
      title: taskForm.title.trim(),
      description: taskForm.description.trim() || null,
      task_type_id: taskForm.taskTypeId || null,
      priority: taskForm.priority,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Create task failed', error.message);
      return;
    }

    setTaskForm(initialTask);
    setCreationMode(null);
    loadCalendarData();
  }

  async function createSession() {
    if (!supabase || !userId || !sessionForm.taskId || !sessionForm.title.trim()) {
      Alert.alert('Check session', 'Task and session title are required.');
      return;
    }

    const blockCount = Number(sessionForm.blockCount);
    const start = parseLocalDateTime(sessionForm.date, sessionForm.startTime);

    if (!start || !Number.isInteger(blockCount) || blockCount <= 0) {
      Alert.alert('Check session', 'Use a valid date, start time, and positive block count.');
      return;
    }

    if (start.getMinutes() % blockDurationMinutes !== 0) {
      Alert.alert('Check session', `Sessions must start on a ${blockDurationMinutes}-minute block.`);
      return;
    }

    const end = new Date(start.getTime() + blockCount * blockDurationMinutes * 60 * 1000);
    if (start.getTime() >= end.getTime()) {
      Alert.alert('Check session', 'Session start time must be before end time.');
      return;
    }

    if (start.getTime() < Date.now()) {
      Alert.alert('Check session', 'New sessions must start in the future.');
      return;
    }

    const blockSegments = getSessionBlockSegments(start, blockCount);

    setSaving(true);
    await ensureSessionTimeBlocks(userId, blockSegments);

    let blocks: Array<{ id: string; session_id: string | null }>;
    try {
      blocks = await loadTimeBlocksForSegments(userId, blockSegments);
    } catch (blockError) {
      setSaving(false);
      Alert.alert('Session check failed', blockError instanceof Error ? blockError.message : 'Could not check time blocks.');
      return;
    }

    if (blocks.length !== getTotalSegmentBlockCount(blockSegments)) {
      setSaving(false);
      Alert.alert('Conflict detected', 'One or more selected time blocks are not available.');
      return;
    }

    const occupiedSessionIds = Array.from(new Set(blocks
      .map((block) => block.session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId))));

    if (occupiedSessionIds.length > 0) {
      const { data: occupiedSessions, error: occupiedError } = await supabase
        .from('sessions')
        .select('id, session_type, checked_in, actual_end_time')
        .eq('user_id', userId)
        .in('id', occupiedSessionIds);

      if (occupiedError) {
        setSaving(false);
        Alert.alert('Conflict check failed', occupiedError.message);
        return;
      }

      const hasLockedConflict = (occupiedSessions ?? []).some((item) => {
        return Boolean(item.actual_end_time) || item.checked_in === true || item.session_type === 'immutable';
      });

      if (hasLockedConflict) {
        setSaving(false);
        Alert.alert('Conflict detected', 'The selected time range overlaps an immutable session.');
        return;
      }
    }

    setSaving(false);
    const reorderResult = await reorderTodaySessions(userId, start, {
      abortOnCanceledNextDayMove: true,
      confirmNextDayMove,
      reservedIntervals: [{ start, end }],
    });

    if (reorderResult.canceledNextDayMoveCount > 0) {
      Alert.alert('Session not created', 'Confirm the next-day move schedule before creating this session.');
      return;
    }

    await syncReorderNotifications(reorderResult);
    setSaving(true);
    await ensureSessionTimeBlocks(userId, blockSegments);

    const { data: newSession, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        user_id: userId,
        task_id: sessionForm.taskId,
        title: sessionForm.title.trim(),
        description: sessionForm.description.trim() || null,
        session_type: sessionForm.sessionType,
        planned_start_time: start.toISOString(),
        planned_end_time: end.toISOString(),
        block_count: blockCount,
        checked_in: false,
      })
      .select('id')
      .single();

    if (sessionError || !newSession) {
      setSaving(false);
      Alert.alert('Create session failed', sessionError?.message ?? 'Could not create session.');
      return;
    }

    const updateError = await assignTimeBlocksForSegments(userId, newSession.id, blockSegments);

    setSaving(false);

    if (updateError) {
      Alert.alert('Assign blocks failed', updateError.message);
      return;
    }

    await scheduleSessionCheckIn(newSession.id, sessionForm, start, end);
    setSessionForm(initialSession);
    setCreationMode(null);
    loadCalendarData({ runDynamicOrder: false });
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 148 + insets.bottom }]} style={[styles.screen, strictModeEnabled && styles.screenStrict]}>
        <View style={styles.header}>
          <Text style={styles.kicker}>BLOCK CALENDAR</Text>
          <View style={styles.titleRow}>
            <View style={styles.titleTagRow}>
              <Text style={styles.title}>CALENDAR</Text>
              {strictModeEnabled ? (
                <View style={styles.strictStickyTag}>
                  <Text style={styles.strictStickyTagText}>STRICT</Text>
                </View>
              ) : null}
            </View>
            <Pressable accessibilityLabel="Open task sidebar" accessibilityRole="button" onPress={() => setTaskSidebarVisible(true)} style={styles.sidebarIconButton}>
              <Ionicons color={colors.text} name="list-outline" size={24} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>Plan categories, tasks, and sessions on 5-minute blocks.</Text>
        </View>

        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.calendarSwipeBody,
            {
              opacity: calendarOpacity,
              transform: [{ translateX: calendarTranslate }],
            },
          ]}
        >
          {view === 'day' ? <DayView date={visibleDate} now={now} onSelectSession={setSelectedSession} sessions={filteredSessions} /> : null}
          {view === 'week' ? <WeekView days={weekDays} now={now} onSelectSession={setSelectedSession} sessions={filteredSessions} /> : null}
          {view === 'month' ? <MonthView baseDate={visibleDate} days={monthDays} now={now} onSelectSession={setSelectedSession} sessions={filteredSessions} /> : null}
        </Animated.View>
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={() => setCreationMode('session')} style={styles.fab}>
        <Ionicons color={colors.paper} name="add" size={34} />
      </Pressable>

      <CreateModal
        categoryForm={categoryForm}
        creationMode={creationMode}
        onChangeCategory={setCategoryForm}
        onChangeSession={setSessionForm}
        onChangeTask={setTaskForm}
        onClose={() => setCreationMode(null)}
        onCreateCategory={createCategory}
        onCreateSession={createSession}
        onCreateTask={createTask}
        saving={saving}
        sessionForm={sessionForm}
        taskForm={taskForm}
        taskTypes={taskTypes}
        tasks={tasks}
      />
      <TaskSidebar
        categoryFilter={categoryFilter}
        categoryMenuVisible={categoryMenuVisible}
        onClose={() => setTaskSidebarVisible(false)}
        onSelectCategory={(value) => {
          setCategoryFilter(value);
          if (taskFilter && value && tasks.find((task) => task.id === taskFilter)?.task_type_id !== value) {
            setTaskFilter('');
          }
          setCategoryMenuVisible(false);
        }}
        onSelectTask={(value) => {
          setTaskFilter(value);
          setTaskMenuVisible(false);
        }}
        onToggleCategoryMenu={() => {
          setCategoryMenuVisible((value) => !value);
          setTaskMenuVisible(false);
        }}
        onToggleTaskMenu={() => {
          setTaskMenuVisible((value) => !value);
          setCategoryMenuVisible(false);
        }}
        onViewChange={(nextView) => dispatch(setCalendarView(nextView))}
        sessionCount={filteredSessions.length}
        taskFilter={taskFilter}
        taskMenuVisible={taskMenuVisible}
        taskTypes={taskTypes}
        tasks={filteredTasks}
        totalTasks={tasks}
        translateX={sidebarTranslate}
        view={view}
        visible={taskSidebarVisible}
      />
      <SessionDetailModal
        onClose={() => setSelectedSession(null)}
        onDelete={deleteSelectedSession}
        onUpdate={updateSelectedSession}
        saving={sessionSaving}
        session={selectedSession}
        tasks={tasks}
      />
      <ImmutableCheckInModal
        checkingIn={immutableCheckingIn}
        onCheckIn={checkInImmutableSession}
        session={immutableCheckInSession}
      />
      <NextDayMoveModal
        onCancel={() => resolveNextDayMove({ confirmed: false })}
        onConfirm={() => resolveNextDayMove({ confirmed: true, plannedStartTime: selectedNextDayStart })}
        onSelect={setSelectedNextDayStart}
        request={nextDayMoveRequest}
        selectedStart={selectedNextDayStart}
      />
    </View>
  );
}

function ImmutableCheckInModal({
  checkingIn,
  onCheckIn,
  session,
}: {
  checkingIn: boolean;
  onCheckIn: () => void;
  session: SessionRow | null;
}) {
  if (!session) {
    return null;
  }

  return (
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={() => undefined} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.nextDayMoveCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalKicker}>IMMUTABLE CHECK-IN</Text>
              <Text style={styles.modalTitle}>START NOW?</Text>
            </View>
          </View>
          <View style={styles.nextDayMoveBody}>
            <Text style={styles.nextDayMoveTitle}>{session.title}</Text>
            <Text style={styles.nextDayMoveMeta}>
              {session.tasks?.title ?? 'NO TASK'} · {formatTimeRange(session)}
            </Text>
            <Text style={styles.nextDayMoveText}>
              This immutable session has passed its planned start time. Check in to start focus mode now.
            </Text>
          </View>
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" disabled={checkingIn} onPress={onCheckIn} style={styles.modalButton}>
              {checkingIn ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.modalButtonText}>CHECK IN</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NextDayMoveModal({
  onCancel,
  onConfirm,
  onSelect,
  request,
  selectedStart,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  onSelect: (value: string) => void;
  request: NextDayMoveRequest | null;
  selectedStart: string;
}) {
  if (!request) {
    return null;
  }

  return (
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={onCancel} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.nextDayMoveCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalKicker}>DYNAMIC ORDER</Text>
              <Text style={styles.modalTitle}>MOVE TO NEXT DAY?</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.closeButton}>
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          </View>
          <View style={styles.nextDayMoveBody}>
            <Text style={styles.nextDayMoveTitle}>{request.title}</Text>
            <Text style={styles.nextDayMoveMeta}>
              {request.taskTitle ?? 'NO TASK'} · {request.priority.toUpperCase()} · {request.blockCount} BLOCKS
            </Text>
            <Text style={styles.nextDayMoveText}>
              Today has no valid room left. Choose an available block time on {request.targetDate}.
            </Text>
            <ScrollView contentContainerStyle={styles.nextDayMoveOptions} showsVerticalScrollIndicator={false} style={styles.nextDayMoveOptionsScroll}>
              {request.options.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  key={option.start}
                  onPress={() => onSelect(option.start)}
                  style={[styles.nextDayMoveOption, selectedStart === option.start && styles.nextDayMoveOptionActive]}
                >
                  <Text style={[styles.nextDayMoveOptionText, selectedStart === option.start && styles.nextDayMoveOptionTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!selectedStart} onPress={onConfirm} style={[styles.modalButton, !selectedStart && styles.disabledButton]}>
              <Text style={styles.modalButtonText}>CONFIRM</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function CreateModal({
  categoryForm,
  creationMode,
  onChangeCategory,
  onChangeSession,
  onChangeTask,
  onClose,
  onCreateCategory,
  onCreateSession,
  onCreateTask,
  saving,
  sessionForm,
  taskForm,
  taskTypes,
  tasks,
}: {
  categoryForm: typeof initialCategory;
  creationMode: CreationMode | null;
  onChangeCategory: (value: typeof initialCategory) => void;
  onChangeSession: (value: typeof initialSession) => void;
  onChangeTask: (value: typeof initialTask) => void;
  onClose: () => void;
  onCreateCategory: () => void;
  onCreateSession: () => void;
  onCreateTask: () => void;
  saving: boolean;
  sessionForm: typeof initialSession;
  taskForm: typeof initialTask;
  taskTypes: TaskTypeRow[];
  tasks: TaskRow[];
}) {
  const title = creationMode === 'category' ? 'CATEGORY' : creationMode === 'task' ? 'TASK' : 'SESSION';
  const submit = creationMode === 'category' ? onCreateCategory : creationMode === 'task' ? onCreateTask : onCreateSession;

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={creationMode !== null}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}
      >
        <View style={styles.formModalCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalKicker}>CREATE</Text>
              <Text style={styles.modalTitle}>{title}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.formBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {creationMode === 'category' ? (
              <>
                <Field label="NAME" onChangeText={(name) => onChangeCategory({ ...categoryForm, name })} value={categoryForm.name} />
                <Field label="DESCRIPTION" onChangeText={(description) => onChangeCategory({ ...categoryForm, description })} value={categoryForm.description} />
                <Field label="COLOR" onChangeText={(color) => onChangeCategory({ ...categoryForm, color })} value={categoryForm.color} />
              </>
            ) : null}

            {creationMode === 'task' ? (
              <>
                <Field label="TITLE" onChangeText={(titleValue) => onChangeTask({ ...taskForm, title: titleValue })} value={taskForm.title} />
                <Field label="DESCRIPTION" onChangeText={(description) => onChangeTask({ ...taskForm, description })} value={taskForm.description} />
                <ChoiceGroup
                  label="CATEGORY"
                  options={[{ label: 'NONE', value: '' }, ...taskTypes.map((type) => ({ label: type.name, value: type.id }))]}
                  value={taskForm.taskTypeId}
                  onChange={(taskTypeId) => onChangeTask({ ...taskForm, taskTypeId })}
                />
                <ChoiceGroup
                  label="PRIORITY"
                  options={priorities.map((priority) => ({ label: priority.toUpperCase(), value: priority }))}
                  value={taskForm.priority}
                  onChange={(priority) => onChangeTask({ ...taskForm, priority: priority as TaskPriority })}
                />
              </>
            ) : null}

            {creationMode === 'session' ? (
              <>
                <ChoiceGroup
                  label="TASK"
                  options={tasks.map((task) => ({ label: task.title, value: task.id }))}
                  value={sessionForm.taskId}
                  onChange={(taskId) => onChangeSession({ ...sessionForm, taskId })}
                />
                <Field label="TITLE" onChangeText={(titleValue) => onChangeSession({ ...sessionForm, title: titleValue })} value={sessionForm.title} />
                <Field label="DESCRIPTION" onChangeText={(description) => onChangeSession({ ...sessionForm, description })} value={sessionForm.description} />
                <ChoiceGroup
                  label="SESSION TYPE"
                  options={sessionTypes.map((type) => ({ label: type.toUpperCase(), value: type }))}
                  value={sessionForm.sessionType}
                  onChange={(sessionType) => onChangeSession({ ...sessionForm, sessionType: sessionType as SessionType })}
                />
                <Field label="DATE YYYY-MM-DD" onChangeText={(date) => onChangeSession({ ...sessionForm, date })} value={sessionForm.date} />
                <Field label="START HH:MM" onChangeText={(startTime) => onChangeSession({ ...sessionForm, startTime })} value={sessionForm.startTime} />
                <Field keyboardType="numeric" label="BLOCK COUNT" onChangeText={(blockCount) => onChangeSession({ ...sessionForm, blockCount })} value={sessionForm.blockCount} />
              </>
            ) : null}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving} onPress={submit} style={styles.modalButton}>
              {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.modalButtonText}>CREATE</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  keyboardType = 'default',
  label,
  onChangeText,
  value,
}: {
  keyboardType?: 'default' | 'numeric';
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
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

function ChoiceGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choiceWrap}>
        {options.length === 0 ? <Text style={styles.emptyChoice}>CREATE A TASK FIRST</Text> : null}
        {options.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={`${label}-${option.value}`}
            onPress={() => onChange(option.value)}
            style={[styles.choiceButton, value === option.value && styles.choiceButtonActive]}
          >
            <Text style={[styles.choiceText, value === option.value && styles.choiceTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TaskSidebar({
  categoryFilter,
  categoryMenuVisible,
  onClose,
  onSelectCategory,
  onSelectTask,
  onToggleCategoryMenu,
  onToggleTaskMenu,
  onViewChange,
  sessionCount,
  taskFilter,
  taskMenuVisible,
  taskTypes,
  tasks,
  totalTasks,
  translateX,
  view,
  visible,
}: {
  categoryFilter: string;
  categoryMenuVisible: boolean;
  onClose: () => void;
  onSelectCategory: (value: string) => void;
  onSelectTask: (value: string) => void;
  onToggleCategoryMenu: () => void;
  onToggleTaskMenu: () => void;
  onViewChange: (value: CalendarView) => void;
  sessionCount: number;
  taskFilter: string;
  taskMenuVisible: boolean;
  taskTypes: TaskTypeRow[];
  tasks: TaskRow[];
  totalTasks: TaskRow[];
  translateX: Animated.Value;
  view: CalendarView;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const selectedType = taskTypes.find((type) => type.id === categoryFilter);
  const selectedTask = totalTasks.find((task) => task.id === taskFilter);
  const sidebarSafePadding = {
    paddingBottom: Math.max(18, insets.bottom + 12),
    paddingTop: Math.max(34, insets.top + 14),
  };

  return (
    <Modal animationType="fade" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.sidebarLayer}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.sidebarShade} />
        <Animated.View style={[styles.sidebarPanel, sidebarSafePadding, { transform: [{ translateX }] }]}>
          <View style={styles.sidebarHeader}>
            <View>
              <Text style={styles.modalKicker}>SESSION FILTER</Text>
              <Text style={styles.sidebarTitle}>FILTERS</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          </View>

          <View style={styles.dropdownWrap}>
            <Text style={styles.sidebarSectionLabel}>CALENDAR VIEW</Text>
            <View style={styles.sidebarViewSwitcher}>
              {viewOptions.map((option) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === option }}
                  key={option}
                  onPress={() => onViewChange(option)}
                  style={[styles.sidebarViewOption, view === option && styles.sidebarViewOptionActive]}
                >
                  <Text style={[styles.sidebarViewText, view === option && styles.sidebarViewTextActive]}>{option.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sidebarSectionLabel}>CATEGORIES</Text>
            <Pressable accessibilityRole="button" onPress={onToggleCategoryMenu} style={styles.dropdownButton}>
              <Text style={styles.dropdownText}>{selectedType?.name ?? 'CATEGORIES'}</Text>
              <Ionicons color={colors.text} name={categoryMenuVisible ? 'chevron-up' : 'chevron-down'} size={18} />
            </Pressable>
            {categoryMenuVisible ? (
              <View style={styles.dropdownMenu}>
                <Pressable accessibilityRole="button" onPress={() => onSelectCategory('')} style={styles.dropdownItem}>
                  <Text style={styles.dropdownItemText}>ALL</Text>
                </Pressable>
                {taskTypes.map((type) => (
                  <Pressable
                    accessibilityRole="button"
                    key={type.id}
                    onPress={() => onSelectCategory(type.id)}
                    style={styles.dropdownItem}
                  >
                    <View style={[styles.typeDot, { backgroundColor: type.color || colors.surface }]} />
                    <Text style={styles.dropdownItemText}>{type.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.sidebarSectionLabel}>TASKS</Text>
            <Pressable accessibilityRole="button" onPress={onToggleTaskMenu} style={styles.dropdownButton}>
              <Text style={styles.dropdownText}>{selectedTask?.title ?? 'TASKS'}</Text>
              <Ionicons color={colors.text} name={taskMenuVisible ? 'chevron-up' : 'chevron-down'} size={18} />
            </Pressable>
            {taskMenuVisible ? (
              <View style={styles.dropdownMenu}>
                <Pressable accessibilityRole="button" onPress={() => onSelectTask('')} style={styles.dropdownItem}>
                  <Text style={styles.dropdownItemText}>ALL</Text>
                </Pressable>
                {tasks.map((task) => (
                  <Pressable
                    accessibilityRole="button"
                    key={task.id}
                    onPress={() => onSelectTask(task.id)}
                    style={styles.dropdownItem}
                  >
                    <Ionicons color={colors.primary} name="square-outline" size={13} />
                    <Text numberOfLines={1} style={styles.dropdownItemText}>{task.title}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.sidebarFilterSummary}>
            <Text style={styles.sidebarEmptyTitle}>{sessionCount}</Text>
            <Text style={styles.sidebarEmptyText}>SESSIONS MATCH CURRENT FILTER</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function SessionDetailModal({
  onClose,
  onDelete,
  onUpdate,
  saving,
  session,
  tasks,
}: {
  onClose: () => void;
  onDelete: () => void;
  onUpdate: (form: typeof initialSession) => Promise<boolean>;
  saving: boolean;
  session: SessionRow | null;
  tasks: TaskRow[];
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initialSession);

  useEffect(() => {
    if (!session) {
      return;
    }

    setEditing(false);
    setForm(sessionToForm(session));
  }, [session]);

  if (!session) {
    return null;
  }

  const completed = isSessionCompleted(session);

  function confirmDelete() {
    Alert.alert(
      'Delete session',
      'This will remove the session and free its time blocks.',
      [
        { style: 'cancel', text: 'Cancel' },
        { onPress: onDelete, style: 'destructive', text: 'Delete' },
      ],
    );
  }

  async function saveEdit() {
    const updated = await onUpdate(form);
    if (updated) {
      setEditing(false);
    }
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}
      >
        <View style={styles.sessionDetailCard}>
          <View style={styles.modalHeader}>
            <View style={styles.sessionDetailTitleWrap}>
              <Text style={styles.modalKicker}>SESSION DETAIL</Text>
              <Text style={styles.sessionDetailTitle}>{session.title}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Ionicons color={colors.text} name="close" size={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sessionDetailBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {editing ? (
              <>
                <ChoiceGroup
                  label="TASK"
                  options={tasks.map((task) => ({ label: task.title, value: task.id }))}
                  value={form.taskId}
                  onChange={(taskId) => setForm({ ...form, taskId })}
                />
                <Field label="TITLE" onChangeText={(title) => setForm({ ...form, title })} value={form.title} />
                <Field label="DESCRIPTION" onChangeText={(description) => setForm({ ...form, description })} value={form.description} />
                <ChoiceGroup
                  label="SESSION TYPE"
                  options={sessionTypes.map((type) => ({ label: type.toUpperCase(), value: type }))}
                  value={form.sessionType}
                  onChange={(sessionType) => setForm({ ...form, sessionType: sessionType as SessionType })}
                />
                <Field label="DATE YYYY-MM-DD" onChangeText={(date) => setForm({ ...form, date })} value={form.date} />
                <Field label="START HH:MM" onChangeText={(startTime) => setForm({ ...form, startTime })} value={form.startTime} />
                <Field keyboardType="numeric" label="BLOCK COUNT" onChangeText={(blockCount) => setForm({ ...form, blockCount })} value={form.blockCount} />
              </>
            ) : (
              <>
                <View style={styles.sessionDetailHero}>
                  <Text style={styles.sessionDetailDate}>{formatLongDate(new Date(session.planned_start_time))}</Text>
                  <Text style={styles.sessionDetailTime}>{formatTimeRange(session)}</Text>
                </View>
                <InfoLine label="TASK" value={session.tasks?.title ?? 'NO TASK'} />
                <InfoLine label="TYPE" value={session.tasks?.task_types?.name ?? 'NO TASK TYPE'} />
                <InfoLine label="SESSION MODE" value={session.session_type.toUpperCase()} />
                <InfoLine label="CHECK IN" value={session.checked_in ? 'DONE' : 'PENDING'} />
                {completed ? <InfoLine label="STATUS" value="COMPLETED / LOCKED" /> : null}
                {session.description ? (
                  <View style={styles.infoBlock}>
                    <Text style={styles.infoLabel}>DESCRIPTION</Text>
                    <Text style={styles.infoValue}>{session.description}</Text>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
          <View style={styles.sessionDetailActions}>
            {editing ? (
              <>
                <Pressable accessibilityRole="button" disabled={saving} onPress={() => setEditing(false)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>CANCEL</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={saving} onPress={saveEdit} style={styles.modalButton}>
                  {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.modalButtonText}>SAVE</Text>}
                </Pressable>
              </>
            ) : (
              completed ? (
                <View style={styles.lockedNotice}>
                  <Text style={styles.lockedNoticeText}>THIS SESSION IS LOCKED</Text>
                </View>
              ) : (
                <>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={confirmDelete} style={styles.dangerButton}>
                    <Text style={styles.dangerButtonText}>DELETE</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={() => setEditing(true)} style={styles.modalButton}>
                    <Text style={styles.modalButtonText}>EDIT</Text>
                  </Pressable>
                </>
              )
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function DayView({
  date,
  now,
  onSelectSession,
  sessions,
}: {
  date: Date;
  now: Date;
  onSelectSession: (session: SessionRow) => void;
  sessions: SessionRow[];
}) {
  const daySessions = sessions
    .map((item) => ({ segment: getSessionDaySegment(item, date), session: item }))
    .filter((item): item is { segment: SessionDaySegment; session: SessionRow } => Boolean(item.segment));

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{formatLongDate(date)}</Text>
        <Text style={styles.panelMeta}>288 BLOCKS / 5 MIN · GRID 30 MIN</Text>
      </View>
      <View style={styles.timeline}>
        {calendarHours.map((hour) => (
          <View key={hour} style={styles.hourRow}>
            <Text style={styles.hourLabel}>{formatHour(hour)}</Text>
            <View style={styles.hourBlocks}>
              {Array.from({ length: gridSegmentsPerHour }, (_, index) => (
                <View
                  key={`${hour}-${index}`}
                  pointerEvents="none"
                  style={[styles.timeBlockSegment, index === gridSegmentsPerHour - 1 && styles.timeBlockSegmentLast]}
                />
              ))}
              {isSameDay(date, now) && now.getHours() === hour ? (
                <CurrentTimeLine blockHeight={dayBlockHeight} now={now} showDot />
              ) : null}
              {daySessions.filter((item) => item.segment.start.getHours() === hour).map(({ segment, session }) => (
                <SessionChip
                  key={`${session.id}-${toDateInput(date)}`}
                  onPress={() => onSelectSession(session)}
                  session={session}
                  style={[
                    styles.sessionChipFloating,
                    {
                      height: getSegmentBlockHeight(segment, dayBlockHeight),
                      top: getSegmentTopOffset(segment, dayBlockHeight),
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function WeekView({
  days,
  now,
  onSelectSession,
  sessions,
}: {
  days: Date[];
  now: Date;
  onSelectSession: (session: SessionRow) => void;
  sessions: SessionRow[];
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.weekHeader}>
        <View style={styles.timeGutter} />
        {days.map((day) => (
          <View key={day.toISOString()} style={styles.weekDayHeader}>
            <Text style={styles.weekDayName}>{dayNames[day.getDay()]}</Text>
            <Text style={styles.weekDayNumber}>{day.getDate()}</Text>
          </View>
        ))}
      </View>
      <View style={styles.weekGrid}>
        {calendarHours.map((hour) => (
          <View key={hour} style={styles.weekHourRow}>
            <Text style={styles.weekHourLabel}>{formatHour(hour)}</Text>
            {days.map((day) => {
              const cellSessions = sessions.flatMap((item) => {
                const segment = getSessionDaySegment(item, day);
                return segment && segment.start.getHours() === hour ? [{ segment, session: item }] : [];
              });

              return (
                <View key={`${day.toISOString()}-${hour}`} style={styles.weekCell}>
                  {Array.from({ length: gridSegmentsPerHour }, (_, index) => (
                    <View
                      key={`${day.toISOString()}-${hour}-${index}`}
                      pointerEvents="none"
                      style={[styles.weekBlockSegment, index === gridSegmentsPerHour - 1 && styles.weekBlockSegmentLast]}
                    />
                  ))}
                  {isSameDay(day, now) && now.getHours() === hour ? (
                    <CurrentTimeLine blockHeight={weekBlockHeight} now={now} />
                  ) : null}
                  {cellSessions.slice(0, 1).map(({ segment, session }) => (
                    <SessionDot
                      key={`${session.id}-${toDateInput(day)}`}
                      onPress={() => onSelectSession(session)}
                      session={session}
                      style={[
                        styles.sessionDotFloating,
                        {
                          height: getSegmentBlockHeight(segment, weekBlockHeight),
                          top: getSegmentTopOffset(segment, weekBlockHeight),
                        },
                      ]}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function CurrentTimeLine({
  blockHeight,
  now,
  showDot = false,
}: {
  blockHeight: number;
  now: Date;
  showDot?: boolean;
}) {
  return (
    <View pointerEvents="none" style={[styles.currentTimeLine, { top: getCurrentTimeTopOffset(now, blockHeight) }]}>
      {showDot ? <View style={styles.currentTimeDot} /> : null}
    </View>
  );
}

function MonthView({
  baseDate,
  days,
  now,
  onSelectSession,
  sessions,
}: {
  baseDate: Date;
  days: Date[];
  now: Date;
  onSelectSession: (session: SessionRow) => void;
  sessions: SessionRow[];
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.monthHeader}>
        {dayNames.map((day) => (
          <Text key={day} style={styles.monthDayName}>{day}</Text>
        ))}
      </View>
      <View style={styles.monthGrid}>
        {days.map((day, index) => {
          const isCurrentMonth = day.getMonth() === baseDate.getMonth();
          const isToday = isSameDay(day, now);
          const daySessions = sessions.filter((item) => getSessionDaySegment(item, day));
          const count = daySessions.length;

          return (
            <Pressable
              accessibilityRole="button"
              disabled={daySessions.length === 0}
              key={`${day.toISOString()}-${index}`}
              onPress={() => onSelectSession(daySessions[0])}
              style={[styles.monthCell, !isCurrentMonth && styles.monthCellMuted]}
            >
              <Text style={[styles.monthDate, isToday && styles.monthDateToday]}>{day.getDate()}</Text>
              <View style={styles.monthBlockMeter}>
                {[0, 1, 2].map((dot) => (
                  <View key={dot} style={[styles.monthBlockDot, dot < count && styles.monthBlockDotActive]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SessionChip({
  onPress,
  session,
  style,
}: {
  onPress: () => void;
  session: SessionRow;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.sessionChip, { backgroundColor: getSessionColor(session, colors.surface) }, style]}
    >
      <Text style={styles.sessionChipTitle}>{session.title}</Text>
    </Pressable>
  );
}

function SessionDot({
  onPress,
  session,
  style,
}: {
  onPress: () => void;
  session: SessionRow;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.sessionDot, { backgroundColor: getSessionColor(session, colors.primary) }, style]}
    >
      <Text numberOfLines={1} style={styles.sessionDotText}>{session.title}</Text>
    </Pressable>
  );
}

async function ensureDayTimeBlocks(userId: string, date: Date) {
  if (!supabase) {
    return;
  }

  const blockDate = toDateInput(date);
  const rows = [];

  for (let blockIndex = 0; blockIndex < blocksPerDay; blockIndex += 1) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, blockIndex * blockDurationMinutes);
    const end = new Date(start.getTime() + blockDurationMinutes * 60 * 1000);

    rows.push({
      user_id: userId,
      block_date: blockDate,
      block_index: blockIndex,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });
  }

  const { error } = await supabase
    .from('time_blocks')
    .upsert(rows, { ignoreDuplicates: true, onConflict: 'user_id,block_date,block_index' });

  if (error) {
    Alert.alert('Time block setup failed', error.message);
    return;
  }

  await syncDaySessionBlocks(userId, date);
}

async function ensureSessionTimeBlocks(userId: string, segments: SessionBlockSegment[]) {
  const uniqueDates = Array.from(new Map(segments.map((segment) => [segment.blockDate, segment.date])).values());

  for (const date of uniqueDates) {
    await ensureDayTimeBlocks(userId, date);
  }
}

async function loadTimeBlocksForSegments(userId: string, segments: SessionBlockSegment[]) {
  if (!supabase) {
    return [];
  }

  const client = supabase;
  const results = await Promise.all(segments.map((segment) => client
    .from('time_blocks')
    .select('id, session_id')
    .eq('user_id', userId)
    .eq('block_date', segment.blockDate)
    .in('block_index', segment.blockIndexes)));

  const error = results.find((result) => result.error)?.error;

  if (error) {
    throw error;
  }

  return results.flatMap((result) => result.data ?? []);
}

async function assignTimeBlocksForSegments(userId: string, sessionId: string, segments: SessionBlockSegment[]) {
  if (!supabase) {
    return null;
  }

  for (const segment of segments) {
    const { error } = await supabase
      .from('time_blocks')
      .update({ session_id: sessionId })
      .eq('user_id', userId)
      .eq('block_date', segment.blockDate)
      .in('block_index', segment.blockIndexes);

    if (error) {
      return error;
    }
  }

  return null;
}

async function syncDaySessionBlocks(userId: string, date: Date) {
  if (!supabase) {
    return;
  }

  const blockDate = toDateInput(date);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

  const { error: clearError } = await supabase
    .from('time_blocks')
    .update({ session_id: null })
    .eq('user_id', userId)
    .eq('block_date', blockDate);

  if (clearError) {
    Alert.alert('Time block sync failed', clearError.message);
    return;
  }

  const { data: daySessions, error: sessionError } = await supabase
    .from('sessions')
    .select('id, planned_start_time, block_count')
    .eq('user_id', userId)
    .lt('planned_start_time', nextDayStart.toISOString())
    .gt('planned_end_time', dayStart.toISOString());

  if (sessionError) {
    Alert.alert('Session block sync failed', sessionError.message);
    return;
  }

  for (const session of daySessions ?? []) {
    const start = new Date(session.planned_start_time);
    const blockCount = Number(session.block_count);

    if (!Number.isInteger(blockCount) || blockCount <= 0) {
      continue;
    }

    const segment = getSessionBlockSegments(start, blockCount).find((item) => item.blockDate === blockDate);

    if (segment) {
      await supabase
        .from('time_blocks')
        .update({ session_id: session.id })
        .eq('user_id', userId)
        .eq('block_date', segment.blockDate)
        .in('block_index', segment.blockIndexes);
    }
  }
}

function getWeekDays(date: Date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function getVisibleRange(view: CalendarView, date: Date) {
  if (view === 'day') {
    const start = startOfDay(date);
    return { start, end: addDays(start, 1) };
  }

  if (view === 'week') {
    const start = getWeekDays(date)[0];
    return { start, end: addDays(start, 7) };
  }

  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  return { start, end: new Date(date.getFullYear(), date.getMonth() + 1, 1) };
}

function shiftVisibleDate(date: Date, view: CalendarView, direction: 1 | -1) {
  if (view === 'day') {
    return addDays(date, direction);
  }

  if (view === 'week') {
    return addDays(date, direction * 7);
  }

  return new Date(date.getFullYear(), date.getMonth() + direction, 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getMonthGrid(date: Date) {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function parseLocalDateTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hour, minute] = timeValue.split(':').map(Number);

  if (![year, month, day, hour, minute].every(Number.isFinite)) {
    return null;
  }

  return new Date(year, month - 1, day, hour, minute);
}

function getSessionBlockSegments(start: Date, blockCount: number): SessionBlockSegment[] {
  const segments: SessionBlockSegment[] = [];
  let remainingBlocks = blockCount;
  let cursor = new Date(start);

  while (remainingBlocks > 0) {
    const day = startOfDay(cursor);
    const startIndex = isSameDay(cursor, start) ? getBlockIndex(cursor) : 0;
    const blockCountInDay = Math.min(remainingBlocks, blocksPerDay - startIndex);
    const blockIndexes = Array.from({ length: blockCountInDay }, (_, index) => startIndex + index);

    segments.push({
      blockDate: toDateInput(day),
      blockIndexes,
      date: day,
    });

    remainingBlocks -= blockCountInDay;
    cursor = addDays(day, 1);
  }

  return segments;
}

function getTotalSegmentBlockCount(segments: SessionBlockSegment[]) {
  return segments.reduce((total, segment) => total + segment.blockIndexes.length, 0);
}

function sessionToForm(session: SessionRow) {
  const start = new Date(session.planned_start_time);

  return {
    taskId: session.task_id,
    title: session.title,
    description: session.description ?? '',
    sessionType: session.session_type,
    date: toDateInput(start),
    startTime: formatClock(start),
    blockCount: String(session.block_count),
  };
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    weekday: 'long',
  }).toUpperCase();
}

function formatTimeRange(session: SessionRow) {
  const start = new Date(session.planned_start_time);
  const end = new Date(session.planned_end_time);
  return `${formatClock(start)}-${formatClock(end)} / ${session.block_count}B`;
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getSessionBlockHeight(session: SessionRow, blockHeight: number) {
  return Math.max(blockHeight - 4, session.block_count * blockHeight - 4);
}

function getSessionTopOffset(session: SessionRow, blockHeight: number) {
  const start = new Date(session.planned_start_time);
  return (start.getMinutes() / blockDurationMinutes) * blockHeight;
}

function getSessionDaySegment(session: SessionRow, date: Date): SessionDaySegment | null {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  const sessionStart = new Date(session.planned_start_time);
  const sessionEnd = new Date(session.planned_end_time);
  const start = new Date(Math.max(sessionStart.getTime(), dayStart.getTime()));
  const end = new Date(Math.min(sessionEnd.getTime(), dayEnd.getTime()));

  if (start.getTime() >= end.getTime()) {
    return null;
  }

  return {
    blockCount: Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (blockDurationMinutes * 60 * 1000))),
    end,
    start,
  };
}

function getSegmentBlockHeight(segment: SessionDaySegment, blockHeight: number) {
  return Math.max(blockHeight - 4, segment.blockCount * blockHeight - 4);
}

function getSegmentTopOffset(segment: SessionDaySegment, blockHeight: number) {
  return (segment.start.getMinutes() / blockDurationMinutes) * blockHeight;
}

function getCurrentTimeTopOffset(now: Date, blockHeight: number) {
  return (now.getMinutes() / blockDurationMinutes) * blockHeight;
}

function getBlockIndex(date: Date) {
  return date.getHours() * blocksPerHour + Math.floor(date.getMinutes() / blockDurationMinutes);
}

function getSessionColor(session: SessionRow, fallback: string) {
  if (isSessionCompleted(session)) {
    return colors.textSoft;
  }

  return session.tasks?.task_types?.color || fallback;
}

function isSessionCompleted(session: SessionRow) {
  return Boolean(session.actual_end_time);
}

function isImmutableOverdueForCheckIn(session: SessionRow, now: Date) {
  return session.session_type === 'immutable' &&
    !session.checked_in &&
    !session.actual_end_time &&
    new Date(session.planned_start_time).getTime() + checkInGraceMinutes * 60 * 1000 < now.getTime();
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleTagRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    flexWrap: 'wrap',
    gap: 10,
  },
  strictStickyTag: {
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    transform: [{ rotate: '-3deg' }],
    ...shadowHard,
  },
  strictStickyTagText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 18,
    letterSpacing: 1,
    lineHeight: 22,
  },
  sidebarIconButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 21,
  },
  calendarSwipeBody: {
    flex: 1,
  },
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    padding: 12,
    ...shadowHard,
  },
  panelHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    marginBottom: 10,
    paddingBottom: 10,
  },
  panelTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 30,
  },
  panelMeta: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  timeline: {
    gap: 0,
  },
  hourRow: {
    flexDirection: 'row',
    minHeight: blocksPerHour * dayBlockHeight,
  },
  hourLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    width: 58,
  },
  hourBlocks: {
    borderColor: colors.border,
    borderLeftWidth: 2,
    flex: 1,
    position: 'relative',
  },
  timeBlockSegment: {
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    height: dayBlockHeight * blocksPerGridSegment,
  },
  timeBlockSegmentLast: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
  },
  currentTimeLine: {
    backgroundColor: colors.danger,
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 5,
  },
  currentTimeDot: {
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderRadius: 5,
    borderWidth: 1,
    height: 10,
    left: -6,
    position: 'absolute',
    top: -4,
    width: 10,
  },
  sessionChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sessionChipFloating: {
    left: 4,
    position: 'absolute',
    right: 4,
    zIndex: 3,
  },
  sessionChipTitle: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  weekHeader: {
    flexDirection: 'row',
  },
  timeGutter: {
    width: 46,
  },
  weekDayHeader: {
    alignItems: 'center',
    borderColor: colors.border,
    borderLeftWidth: 2,
    flex: 1,
    paddingBottom: 8,
  },
  weekDayName: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
  },
  weekDayNumber: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 26,
  },
  weekGrid: {
    borderTopColor: colors.border,
    borderTopWidth: 2,
  },
  weekHourRow: {
    flexDirection: 'row',
    minHeight: blocksPerHour * weekBlockHeight,
  },
  weekHourLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    paddingTop: 6,
    width: 46,
  },
  weekCell: {
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 2,
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    flex: 1,
    padding: 2,
    position: 'relative',
  },
  weekBlockSegment: {
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    height: weekBlockHeight * blocksPerGridSegment,
  },
  weekBlockSegmentLast: {
    borderBottomColor: colors.border,
  },
  sessionDot: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  sessionDotFloating: {
    left: 2,
    position: 'absolute',
    right: 2,
    zIndex: 3,
  },
  sessionDotText: {
    color: colors.paper,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 8,
  },
  monthHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    flexDirection: 'row',
    paddingBottom: 8,
  },
  monthDayName: {
    color: colors.textMuted,
    flex: 1,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    textAlign: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCell: {
    aspectRatio: 1,
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 2,
    borderRightColor: colors.surfaceMuted,
    borderRightWidth: 2,
    padding: 6,
    width: `${100 / 7}%`,
  },
  monthCellMuted: {
    opacity: 0.38,
  },
  monthDate: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
  },
  monthDateToday: {
    backgroundColor: colors.primary,
    color: colors.paper,
    overflow: 'hidden',
    paddingHorizontal: 5,
  },
  monthBlockMeter: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 'auto',
  },
  monthBlockDot: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 1,
    height: 7,
    width: 7,
  },
  monthBlockDotActive: {
    backgroundColor: colors.danger,
  },
  fab: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderRadius: 34,
    borderWidth: 3,
    bottom: 88,
    height: 66,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -33,
    position: 'absolute',
    width: 66,
    ...shadowHard,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 23, 18, 0.48)',
    elevation: 999,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 28,
    zIndex: 999,
  },
  modalCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxWidth: 440,
    padding: 20,
    width: '100%',
    ...shadowHard,
  },
  formModalCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxHeight: '86%',
    maxWidth: 460,
    overflow: 'hidden',
    width: '100%',
    ...shadowHard,
  },
  nextDayMoveCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxHeight: '86%',
    maxWidth: 460,
    overflow: 'hidden',
    width: '100%',
    ...shadowHard,
  },
  nextDayMoveBody: {
    gap: 10,
    padding: 18,
  },
  nextDayMoveTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 32,
    lineHeight: 38,
  },
  nextDayMoveMeta: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  nextDayMoveText: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 20,
  },
  nextDayMoveOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 4,
  },
  nextDayMoveOptionsScroll: {
    maxHeight: 240,
  },
  nextDayMoveOption: {
    borderColor: colors.border,
    borderWidth: 2,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nextDayMoveOptionActive: {
    backgroundColor: colors.primary,
  },
  nextDayMoveOptionText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
  },
  nextDayMoveOptionTextActive: {
    color: colors.paper,
  },
  sidebarLayer: {
    bottom: 0,
    elevation: 999,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 999,
  },
  sidebarShade: {
    backgroundColor: 'rgba(22, 23, 18, 0.32)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sidebarPanel: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderLeftWidth: 3,
    bottom: 0,
    maxWidth: 390,
    paddingTop: 34,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '86%',
    ...shadowHard,
  },
  sidebarHeader: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  sidebarTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 42,
    lineHeight: 48,
  },
  dropdownWrap: {
    borderBottomColor: colors.border,
    borderBottomWidth: 3,
    padding: 18,
  },
  sidebarSectionLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 12,
  },
  sidebarViewSwitcher: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 6,
  },
  sidebarViewOption: {
    flex: 1,
    paddingVertical: 10,
  },
  sidebarViewOptionActive: {
    backgroundColor: colors.primary,
  },
  sidebarViewText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
  },
  sidebarViewTextActive: {
    color: colors.paper,
  },
  dropdownButton: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  dropdownText: {
    color: colors.text,
    flex: 1,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  dropdownMenu: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 2,
    marginTop: 8,
  },
  dropdownItem: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  typeDot: {
    borderColor: colors.border,
    borderWidth: 1,
    height: 13,
    width: 13,
  },
  sidebarBody: {
    gap: 10,
    padding: 18,
    paddingBottom: 120,
  },
  sidebarTask: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    padding: 12,
  },
  sidebarTaskTitle: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  sidebarTaskMeta: {
    color: colors.primary,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 6,
  },
  sidebarTaskDescription: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  sidebarEmpty: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
    padding: 14,
  },
  sidebarEmptyTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 28,
  },
  sidebarEmptyText: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    lineHeight: 18,
  },
  sidebarFilterSummary: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
    margin: 18,
    padding: 14,
  },
  sessionDetailCard: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    maxHeight: '86%',
    maxWidth: 460,
    overflow: 'hidden',
    width: '100%',
    ...shadowHard,
  },
  sessionDetailTitleWrap: {
    flex: 1,
  },
  sessionDetailTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 34,
    lineHeight: 40,
  },
  sessionDetailBody: {
    flexGrow: 0,
    padding: 18,
  },
  sessionDetailHero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 2,
    marginBottom: 12,
    padding: 12,
  },
  sessionDetailDate: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  sessionDetailTime: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 32,
    lineHeight: 38,
    marginTop: 2,
  },
  infoLine: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    paddingVertical: 10,
  },
  infoBlock: {
    paddingTop: 12,
  },
  infoLabel: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoValue: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 21,
  },
  sessionDetailActions: {
    borderTopColor: colors.border,
    borderTopWidth: 3,
    flexDirection: 'row',
    gap: 12,
    padding: 18,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    ...shadowHard,
  },
  dangerButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
  lockedNotice: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  lockedNoticeText: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  modalHeader: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    marginLeft: 12,
    width: 42,
  },
  formBody: {
    paddingBottom: 8,
    paddingHorizontal: 18,
    paddingTop: 2,
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
    fontSize: 36,
    lineHeight: 42,
  },
  fieldGroup: {
    marginTop: 16,
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
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceButton: {
    borderColor: colors.border,
    borderWidth: 2,
    minHeight: 38,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  choiceButtonActive: {
    backgroundColor: colors.primary,
  },
  choiceText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
  },
  choiceTextActive: {
    color: colors.paper,
  },
  emptyChoice: {
    color: colors.danger,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
  },
  modalActions: {
    borderTopColor: colors.border,
    borderTopWidth: 3,
    flexDirection: 'row',
    gap: 12,
    padding: 18,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  fullButton: {
    flex: 0,
    marginTop: 18,
    width: '100%',
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
  disabledButton: {
    opacity: 0.48,
  },
  modalButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
});
