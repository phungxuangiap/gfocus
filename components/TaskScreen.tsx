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

type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
type TaskSubTab = 'tasks' | 'categories';

type CategoryRow = {
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

const priorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];

const emptyTaskForm = {
  title: '',
  description: '',
  priority: 'medium' as TaskPriority,
  taskTypeId: '',
};

const emptyCategoryForm = {
  name: '',
  description: '',
  color: '#b6b56b',
};

export function TaskScreen() {
  const insets = useSafeAreaInsets();
  const session = useAppSelector((state) => state.auth.session);
  const strictModeEnabled = useAppSelector((state) => state.app.strictModeEnabled);
  const [activeTab, setActiveTab] = useState<TaskSubTab>('tasks');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createMode, setCreateMode] = useState<TaskSubTab | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<CategoryRow | null>(null);
  const userId = session?.user.id;

  const taskCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    tasks.forEach((task) => {
      if (task.task_type_id) {
        counts.set(task.task_type_id, (counts.get(task.task_type_id) ?? 0) + 1);
      }
    });
    return counts;
  }, [tasks]);

  const loadData = useCallback(async () => {
    if (!supabase || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const [{ data: categoryRows, error: categoryError }, { data: taskRows, error: taskError }] = await Promise.all([
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
    ]);
    setLoading(false);

    if (categoryError || taskError) {
      Alert.alert('Task load failed', categoryError?.message ?? taskError?.message);
      return;
    }

    setCategories(categoryRows ?? []);
    setTasks((taskRows ?? []) as TaskRow[]);
  }, [userId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function updateTask(taskId: string, form: typeof emptyTaskForm) {
    if (!supabase || !userId || !form.title.trim()) {
      Alert.alert('Check task', 'Task title is required.');
      return false;
    }

    setSaving(true);
    const { error } = await supabase
      .from('tasks')
      .update({
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        task_type_id: form.taskTypeId || null,
      })
      .eq('user_id', userId)
      .eq('id', taskId);
    setSaving(false);

    if (error) {
      Alert.alert('Update task failed', error.message);
      return false;
    }

    setSelectedTask(null);
    loadData();
    return true;
  }

  async function createTask(form: typeof emptyTaskForm) {
    if (!supabase || !userId || !form.title.trim()) {
      Alert.alert('Check task', 'Task title is required.');
      return false;
    }

    setSaving(true);
    const { error } = await supabase.from('tasks').insert({
      user_id: userId,
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      task_type_id: form.taskTypeId || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Create task failed', error.message);
      return false;
    }

    setCreateMode(null);
    loadData();
    return true;
  }

  async function deleteTask(taskId: string) {
    if (!supabase || !userId) {
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('tasks').delete().eq('user_id', userId).eq('id', taskId);
    setSaving(false);

    if (error) {
      Alert.alert('Delete task failed', error.message);
      return;
    }

    setSelectedTask(null);
    loadData();
  }

  async function updateCategory(categoryId: string, form: typeof emptyCategoryForm) {
    if (!supabase || !userId || !form.name.trim()) {
      Alert.alert('Check category', 'Category name is required.');
      return false;
    }

    setSaving(true);
    const { error } = await supabase
      .from('task_types')
      .update({
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color.trim() || null,
      })
      .eq('user_id', userId)
      .eq('id', categoryId);
    setSaving(false);

    if (error) {
      Alert.alert('Update category failed', error.message);
      return false;
    }

    setSelectedCategory(null);
    loadData();
    return true;
  }

  async function createCategory(form: typeof emptyCategoryForm) {
    if (!supabase || !userId || !form.name.trim()) {
      Alert.alert('Check category', 'Category name is required.');
      return false;
    }

    setSaving(true);
    const { error } = await supabase.from('task_types').insert({
      user_id: userId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: form.color.trim() || null,
    });
    setSaving(false);

    if (error) {
      Alert.alert('Create category failed', error.message);
      return false;
    }

    setCreateMode(null);
    loadData();
    return true;
  }

  async function deleteCategory(categoryId: string) {
    if (!supabase || !userId) {
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('task_types').delete().eq('user_id', userId).eq('id', categoryId);
    setSaving(false);

    if (error) {
      Alert.alert('Delete category failed', error.message);
      return;
    }

    setSelectedCategory(null);
    loadData();
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 132 + insets.bottom }]} style={[styles.screen, strictModeEnabled && styles.screenStrict]}>
        <Text style={styles.kicker}>WORK ITEMS</Text>
        <Text style={styles.title}>TASK</Text>
        <Text style={styles.subtitle}>Manage task list and categories.</Text>

        <View style={styles.switcher}>
          <Pressable onPress={() => setActiveTab('tasks')} style={[styles.switchItem, activeTab === 'tasks' && styles.switchItemActive]}>
            <Text style={[styles.switchText, activeTab === 'tasks' && styles.switchTextActive]}>TASKS</Text>
          </Pressable>
          <Pressable onPress={() => setActiveTab('categories')} style={[styles.switchItem, activeTab === 'categories' && styles.switchItemActive]}>
            <Text style={[styles.switchText, activeTab === 'categories' && styles.switchTextActive]}>CATEGORIES</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>LOADING TASK DATA</Text>
          </View>
        ) : null}

        {activeTab === 'tasks' ? (
          <View style={styles.list}>
            {tasks.length === 0 ? <EmptyState title="NO TASKS" body="Create tasks from the plus button." /> : null}
            {tasks.map((task) => {
              const category = categories.find((item) => item.id === task.task_type_id);
              return (
                <Pressable key={task.id} onPress={() => setSelectedTask(task)} style={styles.itemCard}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemTitle}>{task.title}</Text>
                    <Text style={styles.itemMeta}>{category?.name ?? 'NO CATEGORY'} / {(task.priority ?? 'medium').toUpperCase()}</Text>
                  </View>
                  <Ionicons color={colors.text} name="chevron-forward" size={22} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={styles.list}>
            {categories.length === 0 ? <EmptyState title="NO CATEGORIES" body="Create categories from the plus button." /> : null}
            {categories.map((category) => (
              <Pressable key={category.id} onPress={() => setSelectedCategory(category)} style={styles.itemCard}>
                <View style={[styles.colorBlock, { backgroundColor: category.color || colors.surface }]} />
                <View style={styles.itemMain}>
                  <Text style={styles.itemTitle}>{category.name}</Text>
                  <Text style={styles.itemMeta}>{taskCountByCategory.get(category.id) ?? 0} TASKS</Text>
                </View>
                <Ionicons color={colors.text} name="chevron-forward" size={22} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" onPress={() => setCreateMode(activeTab)} style={styles.fab}>
        <Ionicons color={colors.paper} name="add" size={34} />
      </Pressable>

      <TaskDetailModal
        categories={categories}
        onClose={() => setSelectedTask(null)}
        onDelete={deleteTask}
        onUpdate={updateTask}
        saving={saving}
        task={selectedTask}
      />
      <CategoryDetailModal
        category={selectedCategory}
        onClose={() => setSelectedCategory(null)}
        onDelete={deleteCategory}
        onUpdate={updateCategory}
        saving={saving}
      />
      <CreateTaskModal
        categories={categories}
        onClose={() => setCreateMode(null)}
        onCreate={createTask}
        saving={saving}
        visible={createMode === 'tasks'}
      />
      <CreateCategoryModal
        onClose={() => setCreateMode(null)}
        onCreate={createCategory}
        saving={saving}
        visible={createMode === 'categories'}
      />
    </View>
  );
}

function EmptyState({ body, title }: { body: string; title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function CreateTaskModal({
  categories,
  onClose,
  onCreate,
  saving,
  visible,
}: {
  categories: CategoryRow[];
  onClose: () => void;
  onCreate: (form: typeof emptyTaskForm) => Promise<boolean>;
  saving: boolean;
  visible: boolean;
}) {
  const [form, setForm] = useState(emptyTaskForm);

  useEffect(() => {
    if (visible) {
      setForm(emptyTaskForm);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  async function save() {
    await onCreate(form);
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ModalHeader kicker="CREATE" title="TASK" onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Field label="TITLE" onChangeText={(title) => setForm({ ...form, title })} value={form.title} />
            <Field label="DESCRIPTION" onChangeText={(description) => setForm({ ...form, description })} value={form.description} />
            <ChoiceGroup
              label="CATEGORY"
              onChange={(taskTypeId) => setForm({ ...form, taskTypeId })}
              options={[{ label: 'NONE', value: '' }, ...categories.map((item) => ({ label: item.name, value: item.id }))]}
              value={form.taskTypeId}
            />
            <ChoiceGroup
              label="PRIORITY"
              onChange={(priority) => setForm({ ...form, priority: priority as TaskPriority })}
              options={priorities.map((item) => ({ label: item.toUpperCase(), value: item }))}
              value={form.priority}
            />
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable disabled={saving} onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable disabled={saving} onPress={save} style={styles.primaryButton}>
              {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.primaryButtonText}>CREATE</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateCategoryModal({
  onClose,
  onCreate,
  saving,
  visible,
}: {
  onClose: () => void;
  onCreate: (form: typeof emptyCategoryForm) => Promise<boolean>;
  saving: boolean;
  visible: boolean;
}) {
  const [form, setForm] = useState(emptyCategoryForm);

  useEffect(() => {
    if (visible) {
      setForm(emptyCategoryForm);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  async function save() {
    await onCreate(form);
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ModalHeader kicker="CREATE" title="CATEGORY" onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Field label="NAME" onChangeText={(name) => setForm({ ...form, name })} value={form.name} />
            <Field label="DESCRIPTION" onChangeText={(description) => setForm({ ...form, description })} value={form.description} />
            <Field label="COLOR" onChangeText={(color) => setForm({ ...form, color })} value={form.color} />
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable disabled={saving} onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>CANCEL</Text>
            </Pressable>
            <Pressable disabled={saving} onPress={save} style={styles.primaryButton}>
              {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.primaryButtonText}>CREATE</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TaskDetailModal({
  categories,
  onClose,
  onDelete,
  onUpdate,
  saving,
  task,
}: {
  categories: CategoryRow[];
  onClose: () => void;
  onDelete: (taskId: string) => void;
  onUpdate: (taskId: string, form: typeof emptyTaskForm) => Promise<boolean>;
  saving: boolean;
  task: TaskRow | null;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyTaskForm);

  useEffect(() => {
    if (!task) {
      return;
    }

    setEditing(false);
    setForm({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority ?? 'medium',
      taskTypeId: task.task_type_id ?? '',
    });
  }, [task]);

  if (!task) {
    return null;
  }

  const currentTask = task;

  function confirmDelete() {
    Alert.alert('Delete task', 'This will also remove sessions attached to this task.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => onDelete(currentTask.id), style: 'destructive', text: 'Delete' },
    ]);
  }

  async function save() {
    const updated = await onUpdate(currentTask.id, form);
    if (updated) {
      setEditing(false);
    }
  }

  const category = categories.find((item) => item.id === currentTask.task_type_id);

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ModalHeader kicker="TASK DETAIL" title={currentTask.title} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {editing ? (
              <>
                <Field label="TITLE" onChangeText={(title) => setForm({ ...form, title })} value={form.title} />
                <Field label="DESCRIPTION" onChangeText={(description) => setForm({ ...form, description })} value={form.description} />
                <ChoiceGroup
                  label="CATEGORY"
                  onChange={(taskTypeId) => setForm({ ...form, taskTypeId })}
                  options={[{ label: 'NONE', value: '' }, ...categories.map((item) => ({ label: item.name, value: item.id }))]}
                  value={form.taskTypeId}
                />
                <ChoiceGroup
                  label="PRIORITY"
                  onChange={(priority) => setForm({ ...form, priority: priority as TaskPriority })}
                  options={priorities.map((item) => ({ label: item.toUpperCase(), value: item }))}
                  value={form.priority}
                />
              </>
            ) : (
              <>
                <InfoLine label="CATEGORY" value={category?.name ?? 'NO CATEGORY'} />
                <InfoLine label="PRIORITY" value={(currentTask.priority ?? 'medium').toUpperCase()} />
                <InfoLine label="DESCRIPTION" value={currentTask.description || 'NO DESCRIPTION'} />
              </>
            )}
          </ScrollView>
          <ModalActions editing={editing} onCancel={() => setEditing(false)} onDelete={confirmDelete} onEdit={() => setEditing(true)} onSave={save} saving={saving} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CategoryDetailModal({
  category,
  onClose,
  onDelete,
  onUpdate,
  saving,
}: {
  category: CategoryRow | null;
  onClose: () => void;
  onDelete: (categoryId: string) => void;
  onUpdate: (categoryId: string, form: typeof emptyCategoryForm) => Promise<boolean>;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyCategoryForm);

  useEffect(() => {
    if (!category) {
      return;
    }

    setEditing(false);
    setForm({
      name: category.name,
      description: category.description ?? '',
      color: category.color ?? '#b6b56b',
    });
  }, [category]);

  if (!category) {
    return null;
  }

  const currentCategory = category;

  function confirmDelete() {
    Alert.alert('Delete category', 'Tasks in this category will move to no category.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => onDelete(currentCategory.id), style: 'destructive', text: 'Delete' },
    ]);
  }

  async function save() {
    const updated = await onUpdate(currentCategory.id, form);
    if (updated) {
      setEditing(false);
    }
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ModalHeader kicker="CATEGORY DETAIL" title={currentCategory.name} onClose={onClose} />
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            {editing ? (
              <>
                <Field label="NAME" onChangeText={(name) => setForm({ ...form, name })} value={form.name} />
                <Field label="DESCRIPTION" onChangeText={(description) => setForm({ ...form, description })} value={form.description} />
                <Field label="COLOR" onChangeText={(color) => setForm({ ...form, color })} value={form.color} />
              </>
            ) : (
              <>
                <View style={[styles.categoryPreview, { backgroundColor: currentCategory.color || colors.surface }]} />
                <InfoLine label="COLOR" value={currentCategory.color || 'NO COLOR'} />
                <InfoLine label="DESCRIPTION" value={currentCategory.description || 'NO DESCRIPTION'} />
              </>
            )}
          </ScrollView>
          <ModalActions editing={editing} onCancel={() => setEditing(false)} onDelete={confirmDelete} onEdit={() => setEditing(true)} onSave={save} saving={saving} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ModalHeader({ kicker, onClose, title }: { kicker: string; onClose: () => void; title: string }) {
  return (
    <View style={styles.modalHeader}>
      <View style={styles.modalTitleWrap}>
        <Text style={styles.modalKicker}>{kicker}</Text>
        <Text numberOfLines={2} style={styles.modalTitle}>{title}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
        <Ionicons color={colors.text} name="close" size={24} />
      </Pressable>
    </View>
  );
}

function ModalActions({
  editing,
  onCancel,
  onDelete,
  onEdit,
  onSave,
  saving,
}: {
  editing: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <View style={styles.modalActions}>
      {editing ? (
        <>
          <Pressable disabled={saving} onPress={onCancel} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>CANCEL</Text>
          </Pressable>
          <Pressable disabled={saving} onPress={onSave} style={styles.primaryButton}>
            {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.primaryButtonText}>SAVE</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Pressable disabled={saving} onPress={onDelete} style={styles.dangerButton}>
            <Text style={styles.dangerButtonText}>DELETE</Text>
          </Pressable>
          <Pressable disabled={saving} onPress={onEdit} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>EDIT</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Field({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput autoCapitalize="none" onChangeText={onChangeText} style={styles.input} value={value} />
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
        {options.map((option) => (
          <Pressable key={`${label}-${option.value}`} onPress={() => onChange(option.value)} style={[styles.choiceButton, value === option.value && styles.choiceButtonActive]}>
            <Text style={[styles.choiceText, value === option.value && styles.choiceTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
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
    marginBottom: 18,
  },
  switcher: {
    borderColor: colors.border,
    borderWidth: 2,
    flexDirection: 'row',
    marginBottom: 18,
  },
  switchItem: {
    flex: 1,
    paddingVertical: 13,
  },
  switchItemActive: {
    backgroundColor: colors.primary,
  },
  switchText: {
    color: colors.text,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    textAlign: 'center',
  },
  switchTextActive: {
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
  list: {
    gap: 10,
  },
  itemCard: {
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    ...shadowHard,
  },
  itemMain: {
    flex: 1,
  },
  itemTitle: {
    color: colors.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  itemMeta: {
    color: colors.textMuted,
    fontFamily: 'IBMPlexMono_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 5,
  },
  colorBlock: {
    borderColor: colors.border,
    borderWidth: 2,
    height: 36,
    width: 36,
  },
  emptyState: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderWidth: 3,
    padding: 18,
    ...shadowHard,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 32,
  },
  emptyBody: {
    color: colors.textMuted,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
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
    padding: 18,
    zIndex: 999,
  },
  modalCard: {
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
    padding: 18,
  },
  modalTitleWrap: {
    flex: 1,
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
    fontSize: 34,
    lineHeight: 40,
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
  modalBody: {
    padding: 18,
  },
  infoLine: {
    borderBottomColor: colors.border,
    borderBottomWidth: 2,
    paddingVertical: 10,
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
  categoryPreview: {
    borderColor: colors.border,
    borderWidth: 3,
    height: 56,
    marginBottom: 10,
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
  secondaryButtonText: {
    color: colors.text,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.border,
    borderWidth: 3,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    ...shadowHard,
  },
  primaryButtonText: {
    color: colors.paper,
    fontFamily: 'Anton_400Regular',
    fontSize: 22,
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
});
