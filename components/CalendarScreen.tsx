import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, shadowHard } from '../constants/theme';
import { supabase } from '../lib/supabase';
import { useAppSelector } from '../store/hooks';

type CalendarView = 'day' | 'week' | 'month';
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
  title: string;
  session_type: SessionType;
  planned_start_time: string;
  planned_end_time: string;
  block_count: number;
  tasks: {
    title: string;
    task_types: {
      name: string;
      color: string | null;
    } | null;
  } | null;
};

const viewOptions: CalendarView[] = ['day', 'week', 'month'];
const priorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
const sessionTypes: SessionType[] = ['mutable', 'immutable'];
const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const hours = Array.from({ length: 18 }, (_, index) => index + 6);

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
  blockCount: '2',
};

export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const session = useAppSelector((state) => state.auth.session);
  const [view, setView] = useState<CalendarView>('week');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionModalVisible, setActionModalVisible] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
  const [taskTypes, setTaskTypes] = useState<TaskTypeRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [categoryForm, setCategoryForm] = useState(initialCategory);
  const [taskForm, setTaskForm] = useState(initialTask);
  const [sessionForm, setSessionForm] = useState(initialSession);
  const today = useMemo(() => new Date(), []);
  const weekDays = useMemo(() => getWeekDays(today), [today]);
  const monthDays = useMemo(() => getMonthGrid(today), [today]);
  const userId = session?.user.id;

  const loadCalendarData = useCallback(async () => {
    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    await ensureCurrentMonthTimeBlocks(userId, today);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);

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
          .select('id, title, session_type, planned_start_time, planned_end_time, block_count, tasks(title, task_types(name, color))')
          .eq('user_id', userId)
          .gte('planned_start_time', monthStart.toISOString())
          .lt('planned_start_time', monthEnd.toISOString())
          .order('planned_start_time', { ascending: true }),
      ]);

    setLoading(false);

    if (typeError || taskError || sessionError) {
      Alert.alert('Calendar load failed', typeError?.message ?? taskError?.message ?? sessionError?.message);
      return;
    }

    setTaskTypes(typeRows ?? []);
    setTasks(taskRows ?? []);
    setSessions((sessionRows ?? []) as unknown as SessionRow[]);
  }, [today, userId]);

  useEffect(() => {
    loadCalendarData();
  }, [loadCalendarData]);

  function openCreateMode(mode: CreationMode) {
    setCreationMode(mode);
    setActionModalVisible(false);
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

    const startIndex = start.getHours() * 2 + (start.getMinutes() >= 30 ? 1 : 0);
    const endIndex = startIndex + blockCount - 1;

    if (start.getMinutes() % 30 !== 0 || endIndex > 47) {
      Alert.alert('Check session', 'Sessions must start on a 30-minute block and stay inside the selected day.');
      return;
    }

    const end = new Date(start.getTime() + blockCount * 30 * 60 * 1000);

    setSaving(true);
    await ensureCurrentMonthTimeBlocks(userId, start);

    const blockIndexes = Array.from({ length: blockCount }, (_, index) => startIndex + index);
    const { data: blocks, error: blockError } = await supabase
      .from('time_blocks')
      .select('id, session_id')
      .eq('user_id', userId)
      .eq('block_date', sessionForm.date)
      .in('block_index', blockIndexes);

    if (blockError) {
      setSaving(false);
      Alert.alert('Session check failed', blockError.message);
      return;
    }

    if ((blocks ?? []).length !== blockCount || (blocks ?? []).some((block) => block.session_id)) {
      setSaving(false);
      Alert.alert('Conflict detected', 'One or more selected time blocks are already occupied.');
      return;
    }

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

    const { error: updateError } = await supabase
      .from('time_blocks')
      .update({ session_id: newSession.id })
      .eq('user_id', userId)
      .eq('block_date', sessionForm.date)
      .in('block_index', blockIndexes);

    setSaving(false);

    if (updateError) {
      Alert.alert('Assign blocks failed', updateError.message);
      return;
    }

    setSessionForm(initialSession);
    setCreationMode(null);
    loadCalendarData();
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 148 + insets.bottom }]} style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.kicker}>BLOCK CALENDAR</Text>
          <Text style={styles.title}>CALENDAR</Text>
          <Text style={styles.subtitle}>Plan categories, tasks, and sessions on 30-minute blocks.</Text>
        </View>

        <View style={styles.viewSwitcher}>
          {viewOptions.map((option) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: view === option }}
              key={option}
              onPress={() => setView(option)}
              style={[styles.viewOption, view === option && styles.viewOptionActive]}
            >
              <Text style={[styles.viewOptionText, view === option && styles.viewOptionTextActive]}>{option.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>CREATING MONTH BLOCKS</Text>
          </View>
        ) : null}

        {view === 'day' ? <DayView date={today} sessions={sessions} /> : null}
        {view === 'week' ? <WeekView days={weekDays} sessions={sessions} /> : null}
        {view === 'month' ? <MonthView baseDate={today} days={monthDays} sessions={sessions} /> : null}
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={() => setActionModalVisible(true)} style={styles.fab}>
        <Ionicons color={colors.paper} name="add" size={34} />
      </Pressable>

      <ActionModal
        onClose={() => setActionModalVisible(false)}
        onOpenMode={openCreateMode}
        visible={actionModalVisible}
      />
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
    </View>
  );
}

function ActionModal({
  onClose,
  onOpenMode,
  visible,
}: {
  onClose: () => void;
  onOpenMode: (mode: CreationMode) => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalCard}>
          <Text style={styles.modalKicker}>CREATE</Text>
          <Text style={styles.modalTitle}>ADD BLOCK DATA</Text>
          <View style={styles.creationStack}>
            <CreationButton label="CATEGORY" subtitle="Alias for task type" onPress={() => onOpenMode('category')} />
            <CreationButton label="TASK" subtitle="Work item with priority" onPress={() => onOpenMode('task')} />
            <CreationButton label="SESSION" subtitle="Place a task on time blocks" onPress={() => onOpenMode('session')} />
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.secondaryButton, styles.fullButton]}>
            <Text style={styles.secondaryButtonText}>CANCEL</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function CreationButton({ label, onPress, subtitle }: { label: string; onPress: () => void; subtitle: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.creationButton}>
      <Text style={styles.creationLabel}>{label}</Text>
      <Text style={styles.creationSubtitle}>{subtitle}</Text>
    </Pressable>
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
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={creationMode !== null}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

function DayView({ date, sessions }: { date: Date; sessions: SessionRow[] }) {
  const daySessions = sessions.filter((item) => isSameDay(new Date(item.planned_start_time), date));

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{formatLongDate(date)}</Text>
        <Text style={styles.panelMeta}>48 BLOCKS / 30 MIN</Text>
      </View>
      <View style={styles.timeline}>
        {hours.map((hour) => (
          <View key={hour} style={styles.hourRow}>
            <Text style={styles.hourLabel}>{formatHour(hour)}</Text>
            <View style={styles.hourBlocks}>
              <View style={styles.halfBlock}>
                {daySessions.filter((item) => new Date(item.planned_start_time).getHours() === hour).map((item) => (
                  <SessionChip key={item.id} session={item} />
                ))}
              </View>
              <View style={styles.halfBlockMuted} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function WeekView({ days, sessions }: { days: Date[]; sessions: SessionRow[] }) {
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
        {hours.map((hour) => (
          <View key={hour} style={styles.weekHourRow}>
            <Text style={styles.weekHourLabel}>{formatHour(hour)}</Text>
            {days.map((day) => {
              const cellSessions = sessions.filter((item) => {
                const start = new Date(item.planned_start_time);
                return isSameDay(start, day) && start.getHours() === hour;
              });

              return (
                <View key={`${day.toISOString()}-${hour}`} style={styles.weekCell}>
                  <View style={styles.weekHalfLine} />
                  {cellSessions.slice(0, 1).map((item) => <SessionDot key={item.id} session={item} />)}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function MonthView({ baseDate, days, sessions }: { baseDate: Date; days: Date[]; sessions: SessionRow[] }) {
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
          const isToday = isSameDay(day, baseDate);
          const count = sessions.filter((item) => isSameDay(new Date(item.planned_start_time), day)).length;

          return (
            <View key={`${day.toISOString()}-${index}`} style={[styles.monthCell, !isCurrentMonth && styles.monthCellMuted]}>
              <Text style={[styles.monthDate, isToday && styles.monthDateToday]}>{day.getDate()}</Text>
              <View style={styles.monthBlockMeter}>
                {[0, 1, 2].map((dot) => (
                  <View key={dot} style={[styles.monthBlockDot, dot < count && styles.monthBlockDotActive]} />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SessionChip({ session }: { session: SessionRow }) {
  return (
    <View style={styles.sessionChip}>
      <Text style={styles.sessionChipTitle}>{session.title}</Text>
      <Text style={styles.sessionChipMeta}>{formatTimeRange(session)}</Text>
    </View>
  );
}

function SessionDot({ session }: { session: SessionRow }) {
  return (
    <View style={styles.sessionDot}>
      <Text numberOfLines={1} style={styles.sessionDotText}>{session.title}</Text>
    </View>
  );
}

async function ensureCurrentMonthTimeBlocks(userId: string, date: Date) {
  if (!supabase) {
    return;
  }

  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const rows = [];

  for (let day = new Date(monthStart); day <= monthEnd; day.setDate(day.getDate() + 1)) {
    const blockDate = toDateInput(day);

    for (let blockIndex = 0; blockIndex < 48; blockIndex += 1) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, blockIndex * 30);
      const end = new Date(start.getTime() + 30 * 60 * 1000);

      rows.push({
        user_id: userId,
        block_date: blockDate,
        block_index: blockIndex,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      });
    }
  }

  const { error } = await supabase
    .from('time_blocks')
    .upsert(rows, { ignoreDuplicates: true, onConflict: 'user_id,block_date,block_index' });

  if (error) {
    Alert.alert('Time block setup failed', error.message);
  }
}

function getWeekDays(date: Date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
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
  subtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    lineHeight: 21,
  },
  viewSwitcher: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 18,
  },
  viewOption: {
    flex: 1,
    paddingVertical: 13,
  },
  viewOptionActive: {
    backgroundColor: colors.primary,
  },
  viewOptionText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 13,
    letterSpacing: 1,
    textAlign: 'center',
  },
  viewOptionTextActive: {
    color: colors.paper,
  },
  loadingPanel: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    marginBottom: 18,
    padding: 14,
    ...shadowHard,
  },
  loadingText: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
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
    minHeight: 58,
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
  },
  halfBlock: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    flex: 1,
    padding: 4,
  },
  halfBlockMuted: {
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 2,
    flex: 1,
  },
  sessionChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sessionChipTitle: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  sessionChipMeta: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 9,
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
    minHeight: 44,
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
  },
  weekHalfLine: {
    borderBottomColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    flex: 1,
  },
  sessionDot: {
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 2,
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
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 28,
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
  creationStack: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    borderTopColor: colors.border,
    borderTopWidth: 2,
    marginTop: 16,
  },
  creationButton: {
    borderColor: colors.border,
    borderBottomWidth: 2,
    paddingHorizontal: 2,
    paddingVertical: 16,
  },
  creationLabel: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 28,
    lineHeight: 34,
  },
  creationSubtitle: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    lineHeight: 17,
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
  modalButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
});
