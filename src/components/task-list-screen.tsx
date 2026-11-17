import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { BOARD_ICONS, BOARD_ACCENTS } from '@/constants/boards';
import ShareModal from '@/components/share-modal';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../lib/supabase';

type Task = {
  id: string;
  title: string;
  is_done: boolean;
  due_date: string | null;
  recurrence_rule: string | null;
};

type Suggestion = {
  id: string;
  item_name: string;
  use_count: number;
};

type Board = {
  id: string;
  name: string;
  type: string;
  caching_enabled?: boolean;
  owner_id: string;
};

function toTask(row: Record<string, any>): Task {
  return {
    id: row.id,
    title: row.title,
    is_done: row.is_done,
    due_date: row.due_date ?? null,
    recurrence_rule: row.recurrence_rule ?? null,
  };
}

function formatDueDate(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export default function TaskListScreen({
  board,
  isPremium,
  onBack,
  onRenamed,
}: {
  board: Board;
  isPremium: boolean;
  onBack: () => void;
  onRenamed: (newName: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<'daily' | 'weekly' | 'monthly' | null>(null);
  const [recurrenceStrategy, setRecurrenceStrategy] = useState<'add_on_top' | 'recur_on_complete'>(
    'add_on_top'
  );
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(board.name);
  const [myId, setMyId] = useState<string | null>(null);
  const latestQuery = useRef('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadTasks();
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));

    // Live updates: changes made by anyone sharing this board.
    // Our own changes come back here too; upsertTask/removeTask are idempotent.
    const channel = supabase
      .channel(`tasks:${board.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tasks', filter: `sheet_id=eq.${board.id}` },
        (payload) => upsertTask(toTask(payload.new))
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `sheet_id=eq.${board.id}` },
        (payload) => upsertTask(toTask(payload.new))
      )
      // Filters don't apply to DELETE events, so this receives deletes from
      // every board; removing an id that isn't in this list is a no-op.
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'tasks' },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) removeTask(id);
        }
      )
      .subscribe((status) => {
        // Fires on first connect and after every reconnect (e.g. app back
        // from background). Refetch quietly to pick up anything missed.
        if (status === 'SUBSCRIBED') loadTasks(false);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [board.id]);

  function upsertTask(row: Task) {
    setTasks((current) =>
      current.some((t) => t.id === row.id)
        ? current.map((t) => (t.id === row.id ? row : t))
        : [...current, row]
    );
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((t) => t.id !== id));
  }

  useEffect(() => {
    const text = newTitle.trim();
    latestQuery.current = text;

    if (!board.caching_enabled || text.length === 0) {
      setSuggestions([]);
      return;
    }
    const timeout = setTimeout(() => fetchSuggestions(text), 150);
    return () => clearTimeout(timeout);
  }, [newTitle]);

  async function fetchSuggestions(text: string) {
    const normalized = text.toLowerCase();
    const { data, error } = await supabase
      .from('board_item_cache')
      .select('id, item_name, use_count')
      .eq('sheet_id', board.id)
      .ilike('normalized_name', `${normalized}%`)
      .order('use_count', { ascending: false })
      .order('last_used_at', { ascending: false })
      .limit(5);

    if (error) {
      console.log('fetchSuggestions error:', error.message);
      return;
    }

    if (latestQuery.current === text) {
      setSuggestions(data ?? []);
    }
  }

  async function deleteSuggestion(s: Suggestion) {
    setSuggestions((current) => current.filter((item) => item.id !== s.id));
    const { error } = await supabase.from('board_item_cache').delete().eq('id', s.id);
    if (error) {
      console.log('deleteSuggestion error:', error.message);
    }
  }

  async function loadTasks(showSpinner = true) {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, is_done, due_date, recurrence_rule')
      .eq('sheet_id', board.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.log('loadTasks error:', error.message);
    } else {
      setTasks(data ?? []);
    }
    setLoading(false);
  }

  async function addTask(titleOverride?: string) {
    const title = (titleOverride ?? newTitle).trim();
    if (!title) return;
    setNewTitle('');
    setSuggestions([]);

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        sheet_id: board.id,
        title,
        recurrence_rule: recurrenceRule,
        recurrence_strategy: recurrenceRule ? recurrenceStrategy : null,
      })
      .select('id, title, is_done, due_date, recurrence_rule')
      .single();

    setRecurrenceRule(null);
    setPickerOpen(false);

    if (error) {
      Alert.alert('Could not add item', friendlyError(error));
      return;
    }

    if (data) {
      upsertTask(data);
    }
  }

  async function toggleTask(task: Task) {
    upsertTask({ ...task, is_done: !task.is_done });
    const { error } = await supabase
      .from('tasks')
      .update({ is_done: !task.is_done })
      .eq('id', task.id);

    if (error) {
      upsertTask(task); // roll back the optimistic tick
      Alert.alert('Could not update item', friendlyError(error));
      return;
    }

    // Completing a recurring task makes the database reset it or add the next
    // one. Realtime delivers that too; the refetch covers a dropped connection.
    if (task.recurrence_rule && !task.is_done) {
      loadTasks(false);
    }
  }

  function confirmDelete(task: Task) {
    if (task.is_done) {
      deleteTask(task);
      return;
    }
    Alert.alert('Delete this item?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteTask(task),
      },
    ]);
  }

  async function deleteTask(task: Task) {
    setTasks((current) => current.filter((t) => t.id !== task.id));
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      console.log('deleteTask error:', error.message);
    }
  }

  function toggleRecurrencePicker() {
    if (!isPremium) {
      Alert.alert('Premium feature', 'Recurring tasks are part of Nolista Premium.');
      return;
    }
    setPickerOpen((open) => !open);
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === board.name) {
      setEditingName(false);
      setNameDraft(board.name);
      return;
    }
    const { error } = await supabase.from('task_sheets').update({ name: trimmed }).eq('id', board.id);
    setEditingName(false);
    if (error) {
      Alert.alert('Could not rename board', friendlyError(error));
      return;
    }
    onRenamed(trimmed);
  }

  async function clearCompleted() {
    setMenuOpen(false);
    const completedIds = tasks.filter((t) => t.is_done).map((t) => t.id);
    if (completedIds.length === 0) return;

    setTasks((current) => current.filter((t) => !t.is_done));
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('sheet_id', board.id)
      .eq('is_done', true);

    if (error) {
      console.log('clearCompleted error:', error.message);
      loadTasks();
    }
  }

  function confirmClearList() {
    setMenuOpen(false);
    Alert.alert(
      'Clear list?',
      `This removes every item in ${board.name}, done or not. Suggestion history stays, so you can quickly add things back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearList },
      ]
    );
  }

  async function clearList() {
    setTasks([]);
    const { error } = await supabase.from('tasks').delete().eq('sheet_id', board.id);
    if (error) {
      console.log('clearList error:', error.message);
      loadTasks();
    }
  }

  const doneCount = tasks.filter((t) => t.is_done).length;
  const isOwner = board.owner_id === myId;

  return (
    // Expo apps are edge-to-edge on Android, so the window doesn't resize for
    // the keyboard; padding keeps the add row above it on both platforms.
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { paddingTop: insets.top + 16 }]}
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={onBack}>
            <Text style={styles.backText}>‹ Boards</Text>
          </Pressable>
          <Pressable onPress={() => setMenuOpen((open) => !open)} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={20} color={Brand.colors.muted} />
          </Pressable>
        </View>

        {menuOpen && (
          <>
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
            <View style={styles.dropdownMenu}>
              <Pressable style={styles.dropdownItem} onPress={clearCompleted}>
                <Text style={styles.dropdownItemText}>Clear completed</Text>
              </Pressable>
              <Pressable style={styles.dropdownItem} onPress={confirmClearList}>
                <Text style={[styles.dropdownItemText, styles.dropdownItemDanger]}>Clear list</Text>
              </Pressable>
            </View>
          </>
        )}

        <View style={styles.headerRow}>
          <View
            style={[
              styles.headerIcon,
              { backgroundColor: BOARD_ACCENTS[board.type]?.bg ?? BOARD_ACCENTS.custom.bg },
            ]}
          >
            <Ionicons
              name={(BOARD_ICONS[board.type] ?? BOARD_ICONS.custom) as any}
              size={22}
              color={BOARD_ACCENTS[board.type]?.text ?? BOARD_ACCENTS.custom.text}
            />
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {board.type === 'custom' && isOwner && editingName ? (
                <>
                  <TextInput
                    style={styles.nameInput}
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    autoFocus
                    onSubmitEditing={saveName}
                  />
                  <Pressable onPress={saveName} hitSlop={10}>
                    <Ionicons name="checkmark" size={20} color={Brand.colors.sprout} />
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.title}>{board.name}</Text>
                  {board.type === 'custom' && isOwner && (
                    <Pressable onPress={() => setEditingName(true)} hitSlop={10}>
                      <Ionicons name="pencil-outline" size={14} color={Brand.colors.muted} />
                    </Pressable>
                  )}
                  {board.type !== 'focus' && isOwner && (
                    <Pressable onPress={() => setShareOpen(true)} hitSlop={10}>
                      <Ionicons name="share-social-outline" size={18} color={Brand.colors.sprout} />
                    </Pressable>
                  )}
                </>
              )}
            </View>
            <Text style={styles.count}>{doneCount} of {tasks.length} done</Text>
          </View>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#4C7A5E" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => toggleTask(item)}>
                <View style={[styles.checkbox, item.is_done && styles.checkboxChecked]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.taskName, item.is_done && styles.taskDone]}>
                    {item.title}
                  </Text>
                  {item.recurrence_rule && (
                    <View style={styles.recurrenceTag}>
                      <Ionicons name="repeat-outline" size={12} color={Brand.colors.sprout} />
                      <Text style={styles.recurrenceTagText}>
                        {item.recurrence_rule[0].toUpperCase() + item.recurrence_rule.slice(1)}
                        {item.due_date ? ` · next ${formatDueDate(item.due_date)}` : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
              <Pressable onPress={() => confirmDelete(item)} style={styles.deleteBtn} hitSlop={10}>
                <Ionicons name="trash-outline" size={17} color="#B9B6AC" />
              </Pressable>
            </View>
          )}
        />
      )}

      {suggestions.length > 0 && (
        <View style={styles.suggestList}>
          {suggestions.map((s) => (
            <View key={s.id} style={styles.suggestRow}>
              <Pressable style={styles.suggestMain} onPress={() => addTask(s.item_name)}>
                <Text style={styles.suggestName}>{s.item_name}</Text>
                <Text style={styles.suggestMeta}>added {s.use_count}x</Text>
              </Pressable>
              <Pressable
                onPress={() => deleteSuggestion(s)}
                style={styles.suggestDeleteBtn}
                hitSlop={10}
              >
                <Ionicons name="trash-outline" size={15} color="#B9B6AC" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {pickerOpen && (
        <View style={styles.recurrenceBar}>
          {(['daily', 'weekly', 'monthly'] as const).map((rule) => (
            <Pressable
              key={rule}
              style={[styles.ruleChip, recurrenceRule === rule && styles.ruleChipActive]}
              onPress={() => setRecurrenceRule(rule)}
            >
              <Text
                style={[styles.ruleChipText, recurrenceRule === rule && styles.ruleChipTextActive]}
              >
                {rule[0].toUpperCase() + rule.slice(1)}
              </Text>
            </Pressable>
          ))}
          {recurrenceRule && (
            <Pressable
              style={styles.strategyToggle}
              onPress={() =>
                setRecurrenceStrategy((s) => (s === 'add_on_top' ? 'recur_on_complete' : 'add_on_top'))
              }
            >
              <Text style={styles.strategyText}>
                {recurrenceStrategy === 'add_on_top' ? 'Add on top' : 'Recur on complete'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Keep the add row clear of the Android navigation bar / iOS home indicator. */}
      <View style={[styles.addRow, { paddingBottom: 16 + insets.bottom }]}>
        <Pressable onPress={toggleRecurrencePicker} style={styles.repeatBtn}>
          <Ionicons
            name="repeat-outline"
            size={20}
            color={recurrenceRule ? Brand.colors.sprout : Brand.colors.muted}
          />
        </Pressable>
        <TextInput
          style={styles.addInput}
          placeholder="Add an item..."
          value={newTitle}
          onChangeText={setNewTitle}
          onSubmitEditing={() => addTask()}
          returnKeyType="done"
        />
        <Pressable style={styles.addBtn} onPress={() => addTask()}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      <ShareModal
        visible={shareOpen}
        boardId={board.id}
        boardName={board.name}
        onClose={() => setShareOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.paper },
  header: { paddingHorizontal: 22, marginBottom: 10, position: 'relative' },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  backText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
  menuBackdrop: {
    position: 'absolute',
    top: -100,
    left: -100,
    right: -100,
    bottom: -1000,
    zIndex: 10,
  },
  dropdownMenu: {
    position: 'absolute',
    top: 34,
    right: 22,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 170,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 20,
  },
  dropdownItem: { paddingVertical: 11, paddingHorizontal: 16 },
  dropdownItemText: { fontFamily: Brand.fonts.body, fontSize: 14, color: Brand.colors.ink },
  dropdownItemDanger: { color: Brand.colors.danger },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontFamily: Brand.fonts.display, fontSize: 26, color: Brand.colors.ink },
  nameInput: {
    fontFamily: Brand.fonts.display,
    fontSize: 22,
    color: Brand.colors.ink,
    borderBottomWidth: 1.4,
    borderBottomColor: Brand.colors.sprout,
    minWidth: 140,
    paddingVertical: 2,
  },
  count: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted, marginTop: 2 },
  list: { paddingHorizontal: 22, paddingBottom: 20, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE9E2',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.6,
    borderColor: '#C9C6BC',
  },
  checkboxChecked: { backgroundColor: Brand.colors.sprout, borderColor: Brand.colors.sprout },
  taskName: { fontFamily: Brand.fonts.body, fontSize: 15.5, color: Brand.colors.ink },
  taskDone: { color: '#B9B6AC', textDecorationLine: 'line-through' },
  recurrenceTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recurrenceTagText: { fontFamily: Brand.fonts.body, fontSize: 11.5, color: Brand.colors.sprout },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  suggestList: {
    marginHorizontal: 16,
    marginBottom: 6,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE7',
  },
  suggestMain: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
  },
  suggestName: { fontFamily: Brand.fonts.body, fontSize: 15, color: Brand.colors.ink },
  suggestMeta: { fontFamily: Brand.fonts.body, fontSize: 11.5, color: Brand.colors.muted },
  suggestDeleteBtn: { paddingHorizontal: 14, paddingVertical: 12 },
  repeatBtn: { justifyContent: 'center', paddingHorizontal: 6 },
  recurrenceBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  ruleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D8D5CC',
  },
  ruleChipActive: { backgroundColor: Brand.colors.sprout, borderColor: Brand.colors.sprout },
  ruleChipText: { fontFamily: Brand.fonts.body, fontSize: 12.5, color: Brand.colors.ink },
  ruleChipTextActive: { color: '#fff', fontFamily: Brand.fonts.bodyBold },
  strategyToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Brand.colors.stone,
  },
  strategyText: { fontFamily: Brand.fonts.body, fontSize: 12.5, color: Brand.colors.ink },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#ECE9E2',
    backgroundColor: '#fff',
  },
  addInput: {
    flex: 1,
    backgroundColor: '#F0EEE7',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    fontFamily: Brand.fonts.body,
    fontSize: 15,
  },
  addBtn: {
    backgroundColor: Brand.colors.sprout,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addBtnText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 15 },
});