import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { Brand } from '@/constants/brand';
import { BOARD_ICONS, BOARD_ACCENTS } from '@/constants/boards';
import ShareModal from '@/components/share-modal';
import DueDatePicker from '@/components/due-date-picker';
import { dueLabel, dueStatus, type DueStatus } from '@/utils/due-dates';
import { onDueDateSet } from '@/utils/reminders';
import { friendlyError } from '@/utils/errors';
import { moveItem, removeById, sortByPosition, upsertById } from '@/utils/task-list';
import { listAsText } from '@/utils/list-text';
import { sharedWithLabel } from '@/utils/names';
import { supabase } from '../../lib/supabase';

type Task = {
  id: string;
  title: string;
  is_done: boolean;
  due_date: string | null;
  recurrence_rule: string | null;
  position: number;
};

const TASK_COLUMNS = 'id, title, is_done, due_date, recurrence_rule, position';

type Suggestion = {
  id: string;
  item_name: string;
  use_count: number;
};

type SameTypeBoard = { id: string; owner_id: string; member_names: string[] | null };

type Board = {
  id: string;
  name: string;
  type: string;
  caching_enabled?: boolean;
  owner_id: string;
  member_names?: string[];
};

function toTask(row: Record<string, any>): Task {
  return {
    id: row.id,
    title: row.title,
    is_done: row.is_done,
    due_date: row.due_date ?? null,
    recurrence_rule: row.recurrence_rule ?? null,
    position: row.position ?? 0,
  };
}

const DUE_COLORS: Record<DueStatus, string> = {
  overdue: Brand.colors.danger,
  today: Brand.colors.marigoldDark,
  soon: Brand.colors.sproutDark,
  later: Brand.colors.muted,
};

function dueColor(task: { is_done: boolean; due_date: string }) {
  return task.is_done ? Brand.colors.muted : DUE_COLORS[dueStatus(task.due_date)];
}

export default function TaskListScreen({
  board,
  isPremium,
  onBack,
  onRenamed,
  onGone,
}: {
  board: Board;
  isPremium: boolean;
  onBack: () => void;
  onRenamed: (newName: string) => void;
  onGone: () => void;
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
  // Due date for the item being typed, and which date the picker is editing.
  const [newDueDate, setNewDueDate] = useState<string | null>(null);
  const [dateTarget, setDateTarget] = useState<'new' | Task | null>(null);
  // Other Market/Together boards you have, for the merge options in the menu.
  const [sameType, setSameType] = useState<SameTypeBoard[]>([]);
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
    setTasks((current) => sortByPosition(upsertById(current, row)));
  }

  function removeTask(id: string) {
    setTasks((current) => removeById(current, id));
  }

  const query = newTitle.trim();
  const suggestionsEnabled = !!board.caching_enabled && query.length > 0;
  // Derived instead of cleared in an effect: nothing typed means no suggestions.
  const visibleSuggestions = suggestionsEnabled ? suggestions : [];

  useEffect(() => {
    if (!suggestionsEnabled) return;

    // A newer keystroke cancels this request, so results can't arrive out of order.
    let cancelled = false;
    const timeout = setTimeout(async () => {
      // Escape LIKE wildcards so typing "%" or "_" matches literally.
      const prefix = query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data, error } = await supabase
        .from('board_item_cache')
        .select('id, item_name, use_count')
        .eq('sheet_id', board.id)
        .ilike('normalized_name', `${prefix}%`)
        .order('use_count', { ascending: false })
        .order('last_used_at', { ascending: false })
        .limit(5);

      if (cancelled) return;
      if (error) {
        console.log('fetchSuggestions error:', error.message);
        return;
      }
      setSuggestions(data ?? []);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, suggestionsEnabled, board.id]);

  async function deleteSuggestion(s: Suggestion) {
    setSuggestions((current) => current.filter((item) => item.id !== s.id));
    const { error } = await supabase.from('board_item_cache').delete().eq('id', s.id);
    if (error) {
      setSuggestions((current) => [s, ...current]);
      Alert.alert('Could not remove suggestion', friendlyError(error));
    }
  }

  async function loadTasks(showSpinner = true) {
    if (showSpinner) setLoading(true);
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('sheet_id', board.id)
      .order('position', { ascending: true });

    if (error) {
      // Silent refreshes keep the current list; a failed first load would
      // look like an empty board, so say so.
      if (showSpinner) Alert.alert('Could not load items', friendlyError(error));
      else console.log('loadTasks error:', error.message);
    } else {
      setTasks(sortByPosition(data ?? []));
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
        due_date: newDueDate,
      })
      .select(TASK_COLUMNS)
      .single();

    setRecurrenceRule(null);
    setPickerOpen(false);
    setNewDueDate(null);

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

  async function setTaskDue(task: Task, due: string | null) {
    if (task.due_date === due) return;
    upsertTask({ ...task, due_date: due });
    const { error } = await supabase.from('tasks').update({ due_date: due }).eq('id', task.id);
    if (error) {
      upsertTask(task); // roll back
      Alert.alert('Could not set the date', friendlyError(error));
    }
  }

  function onDatePicked(value: string | null) {
    // First date ever: ask for notification permission (reminders are
    // scheduled when the app goes to the background).
    if (value) onDueDateSet();
    if (dateTarget === 'new') setNewDueDate(value);
    else if (dateTarget) setTaskDue(dateTarget, value);
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
    removeTask(task.id);
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      Alert.alert('Could not delete item', friendlyError(error));
      loadTasks(false); // put it back in its original position
    }
  }

  // Drag and drop: save only the moved item (or, rarely, renumber the list).
  async function onReorder({ from, to }: ReorderableListReorderEvent) {
    if (from === to) return;
    const { items, moved, renumber } = moveItem(tasks, from, to);
    setTasks(items);
    const changed = renumber ? items : [moved];
    const results = await Promise.all(
      changed.map((t) => supabase.from('tasks').update({ position: t.position }).eq('id', t.id))
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      Alert.alert('Could not move item', friendlyError(failed.error));
      loadTasks(false); // back to the saved order
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
      Alert.alert('Could not clear completed items', friendlyError(error));
      loadTasks(false);
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
      Alert.alert('Could not clear the list', friendlyError(error));
      loadTasks(false);
    }
  }

  async function sendAsText() {
    if (!isPremium) {
      Alert.alert('Premium feature', 'Sending a list as text (WhatsApp, SMS…) is part of Nolista Premium.');
      return;
    }
    try {
      await Share.share({ message: listAsText(board, tasks) });
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    }
  }

  const builtIn = board.type === 'market' || board.type === 'together';
  const typeName = board.type === 'market' ? 'Market' : 'Together';

  async function loadSameType() {
    if (!builtIn) return;
    const { data } = await supabase
      .from('board_summaries')
      .select('id, owner_id, member_names')
      .eq('type', board.type)
      .neq('id', board.id);
    setSameType(data ?? []);
  }

  function toggleMenu() {
    if (!menuOpen) loadSameType();
    setMenuOpen(!menuOpen);
  }

  function openBoard(id: string) {
    router.replace({ pathname: '/board/[id]', params: { id } });
  }

  // From your own board: fold it into a shared one you joined.
  function confirmMergeInto(target: SameTypeBoard) {
    setMenuOpen(false);
    const owner = target.member_names?.[0] ?? 'the shared';
    Alert.alert(
      `Merge into ${owner}’s ${typeName}?`,
      `Your items, suggestions and the people you shared this board with move there, ` +
        `so everyone uses one list. You can unmerge later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: async () => {
            const { error } = await supabase.rpc('merge_into_board', { p_target: target.id });
            if (error) {
              Alert.alert('Could not merge', friendlyError(error));
              return;
            }
            openBoard(target.id);
          },
        },
      ]
    );
  }

  function confirmUnmerge() {
    setMenuOpen(false);
    Alert.alert(
      `Unmerge ${board.name}?`,
      `You get your own ${typeName} back with your items, and the people you brought in when you ` +
        `merged move back to it. You stay on this shared board too.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unmerge',
          onPress: async () => {
            const { data, error } = await supabase.rpc('unmerge_board', { p_board: board.id });
            if (error) {
              Alert.alert('Could not unmerge', friendlyError(error));
              return;
            }
            if (data) openBoard(data as string);
            else onGone();
          },
        },
      ]
    );
  }

  function confirmMerge() {
    setMenuOpen(false);
    Alert.alert(
      `Merge your ${typeName} into this board?`,
      `Your own ${typeName} items, suggestions and the people you shared it with move here, ` +
        `so everyone uses one list. You can unmerge later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', onPress: mergeIntoThis },
      ]
    );
  }

  async function mergeIntoThis() {
    const { error } = await supabase.rpc('merge_into_board', { p_target: board.id });
    if (error) {
      Alert.alert('Could not merge', friendlyError(error));
      return;
    }
    loadTasks(false);
    Alert.alert('Merged', 'Your items are on this board now.');
  }

  function confirmLeave() {
    setMenuOpen(false);
    Alert.alert(
      `Leave ${board.name}?`,
      builtIn
        ? `You’ll keep your own ${board.name} with a copy of these items. Changes stop syncing with the others.`
        : 'The board will disappear from your list. The owner can invite you again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: leave },
      ]
    );
  }

  async function leave() {
    const { error } = await supabase
      .from('sheet_collaborators')
      .delete()
      .eq('sheet_id', board.id)
      .eq('user_id', myId ?? '');
    if (error) {
      Alert.alert('Could not leave board', friendlyError(error));
      return;
    }
    onGone();
  }

  const doneCount = tasks.filter((t) => t.is_done).length;
  const isOwner = board.owner_id === myId;
  const isMember = !isOwner && myId !== null;
  const ownsSameType = sameType.some((b) => b.owner_id === myId);
  const joinedSameType = sameType.filter((b) => b.owner_id !== myId);
  const sharedLabel = sharedWithLabel(board.member_names);

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
          <Pressable onPress={toggleMenu} hitSlop={10}>
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
              {builtIn &&
                isOwner &&
                joinedSameType.map((b) => (
                  <Pressable key={b.id} style={styles.dropdownItem} onPress={() => confirmMergeInto(b)}>
                    <Text style={styles.dropdownItemText}>
                      Merge into {b.member_names?.[0] ?? 'shared'}’s {typeName}
                    </Text>
                  </Pressable>
                ))}
              {builtIn && isMember && ownsSameType && (
                <Pressable style={styles.dropdownItem} onPress={confirmMerge}>
                  <Text style={styles.dropdownItemText}>Merge my {typeName} here</Text>
                </Pressable>
              )}
              {builtIn && isMember && !ownsSameType && (
                <Pressable style={styles.dropdownItem} onPress={confirmUnmerge}>
                  <Text style={styles.dropdownItemText}>Unmerge</Text>
                </Pressable>
              )}
              {isMember && (!builtIn || ownsSameType) && (
                <Pressable style={styles.dropdownItem} onPress={confirmLeave}>
                  <Text style={[styles.dropdownItemText, styles.dropdownItemDanger]}>Leave board</Text>
                </Pressable>
              )}
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
          <View style={{ flex: 1 }}>
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
                </>
              )}
            </View>
            {sharedLabel && (
              <Text style={styles.shared} numberOfLines={1}>
                {sharedLabel}
              </Text>
            )}
            <Text style={styles.count}>{doneCount} of {tasks.length} done</Text>
          </View>
          {/* Two different kinds of sharing:
              person-add = invite people to the live board (owners only)
              share     = send a text copy to WhatsApp, SMS… (Premium) */}
          <View style={styles.headerActions}>
            {board.type !== 'focus' && isOwner && (
              <Pressable
                onPress={() => setShareOpen(true)}
                hitSlop={8}
                style={styles.headerAction}
                accessibilityLabel="Invite people"
              >
                <Ionicons name="person-add-outline" size={20} color={Brand.colors.sprout} />
              </Pressable>
            )}
            <Pressable
              onPress={sendAsText}
              hitSlop={8}
              style={styles.headerAction}
              accessibilityLabel="Send list as text"
            >
              <Ionicons
                name="share-outline"
                size={20}
                color={isPremium ? Brand.colors.sprout : Brand.colors.muted}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#4C7A5E" style={{ marginTop: 40 }} />
      ) : (
        <ReorderableList
          data={tasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onReorder={onReorder}
          renderItem={({ item }) => (
            <TaskRow
              item={item}
              onToggle={toggleTask}
              onPickDate={setDateTarget}
              onDelete={confirmDelete}
            />
          )}
        />
      )}

      {visibleSuggestions.length > 0 && (
        <View style={styles.suggestList}>
          {visibleSuggestions.map((s) => (
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

      {newDueDate && (
        <View style={styles.newDueRow}>
          <Pressable style={styles.newDueChip} onPress={() => setDateTarget('new')}>
            <Ionicons name="calendar-outline" size={13} color={DUE_COLORS[dueStatus(newDueDate)]} />
            <Text style={[styles.dueTagText, { color: DUE_COLORS[dueStatus(newDueDate)] }]}>
              Due {dueLabel(newDueDate)}
            </Text>
          </Pressable>
          <Pressable onPress={() => setNewDueDate(null)} hitSlop={10} accessibilityLabel="Remove date">
            <Ionicons name="close-circle" size={16} color={Brand.colors.muted} />
          </Pressable>
        </View>
      )}

      {/* Keep the add row clear of the Android navigation bar / iOS home indicator. */}
      <View style={[styles.addRow, { paddingBottom: 16 + insets.bottom }]}>
        <Pressable onPress={() => setDateTarget('new')} style={styles.repeatBtn} accessibilityLabel="Due date">
          <Ionicons
            name="calendar-outline"
            size={20}
            color={newDueDate ? Brand.colors.sprout : Brand.colors.muted}
          />
        </Pressable>
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

      <DueDatePicker
        visible={dateTarget !== null}
        value={dateTarget === 'new' ? newDueDate : (dateTarget?.due_date ?? null)}
        onPick={onDatePicked}
        onClose={() => setDateTarget(null)}
      />

      <ShareModal
        visible={shareOpen}
        boardId={board.id}
        boardName={board.name}
        onClose={() => setShareOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

/**
 * One item. Drag it by the handle on the left, or by long-pressing the row
 * (a quick tap still ticks it). Its own component because the drag hook
 * only works inside a list item.
 */
function TaskRow({
  item,
  onToggle,
  onPickDate,
  onDelete,
}: {
  item: Task;
  onToggle: (task: Task) => void;
  onPickDate: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const drag = useReorderableDrag();
  const color = item.due_date ? dueColor({ ...item, due_date: item.due_date }) : undefined;

  return (
    <View style={styles.row}>
      <Pressable
        onPressIn={drag}
        style={styles.dragHandle}
        hitSlop={{ top: 8, bottom: 8, left: 10 }}
        accessibilityLabel="Drag to reorder"
      >
        <Ionicons name="reorder-two" size={18} color="#CFCCC2" />
      </Pressable>
      <Pressable
        style={styles.rowMain}
        onPress={() => onToggle(item)}
        onLongPress={drag}
        delayLongPress={300}
      >
        <View style={[styles.checkbox, item.is_done && styles.checkboxChecked]} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.taskName, item.is_done && styles.taskDone]}>{item.title}</Text>
          {(item.due_date || item.recurrence_rule) && (
            <View style={styles.recurrenceTag}>
              {item.due_date && (
                <Pressable onPress={() => onPickDate(item)} hitSlop={6} style={styles.dueTag}>
                  <Ionicons name="calendar-outline" size={12} color={color} />
                  <Text style={[styles.dueTagText, { color }]}>
                    {!item.is_done && dueStatus(item.due_date) === 'overdue' ? 'Overdue · ' : ''}
                    {dueLabel(item.due_date)}
                  </Text>
                </Pressable>
              )}
              {item.recurrence_rule && (
                <>
                  <Ionicons name="repeat-outline" size={12} color={Brand.colors.sprout} />
                  <Text style={styles.recurrenceTagText}>
                    {item.recurrence_rule[0].toUpperCase() + item.recurrence_rule.slice(1)}
                  </Text>
                </>
              )}
            </View>
          )}
        </View>
      </Pressable>
      {!item.is_done && !item.due_date && (
        <Pressable
          onPress={() => onPickDate(item)}
          style={styles.deleteBtn}
          hitSlop={8}
          accessibilityLabel="Set due date"
        >
          <Ionicons name="calendar-outline" size={17} color="#B9B6AC" />
        </Pressable>
      )}
      <Pressable onPress={() => onDelete(item)} style={styles.deleteBtn} hitSlop={10}>
        <Ionicons name="trash-outline" size={17} color="#B9B6AC" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.paper },
  // zIndex keeps the ⋯ menu above the list when it hangs below the header.
  header: { paddingHorizontal: 22, marginBottom: 10, position: 'relative', zIndex: 10, elevation: 10 },
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
  shared: { fontFamily: Brand.fonts.body, fontSize: 12.5, color: Brand.colors.sprout, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  headerAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: { paddingHorizontal: 22, paddingBottom: 20, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE9E2',
    // Opaque, so a dragged row hides the ones it passes over.
    backgroundColor: Brand.colors.paper,
  },
  dragHandle: { paddingRight: 8, paddingVertical: 4, marginLeft: -6 },
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
  dueTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  dueTagText: { fontFamily: Brand.fonts.bodyBold, fontSize: 11.5 },
  newDueRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, paddingTop: 8 },
  newDueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
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