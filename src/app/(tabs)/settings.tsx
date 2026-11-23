import { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Switch,
  Platform,
  Linking,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { BOARD_ACCENTS, sortBoards } from '@/constants/boards';
import { friendlyError } from '@/utils/errors';
import NameModal from '@/components/name-modal';
import {
  askForPermission,
  getReminderSettings,
  saveReminderSettings,
  type ReminderSettings,
} from '@/utils/reminders';
import { supabase } from '../../../lib/supabase';

const REMINDER_TIMES = [
  { label: '8:00', hour: 8 },
  { label: '9:00', hour: 9 },
  { label: '12:00', hour: 12 },
  { label: '18:00', hour: 18 },
  { label: '20:00', hour: 20 },
];

type Board = {
  id: string;
  name: string;
  type: string;
  owner_id: string;
  collaborator_count: number;
};

export default function Settings() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [myName, setMyName] = useState<string | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadBoards();
      getReminderSettings().then(setReminders);
    }, [])
  );

  async function updateReminders(next: ReminderSettings) {
    setReminders(next);
    await saveReminderSettings(next);
    if (next.enabled && !(await askForPermission())) {
      Alert.alert(
        'Notifications are off',
        'Allow notifications for Nolista in your phone settings to get reminders.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
  }

  async function loadBoards() {
    const { data: userData } = await supabase.auth.getUser();
    setMyId(userData.user?.id ?? null);
    if (userData.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userData.user.id)
        .maybeSingle();
      setMyName(profile?.display_name ?? null);
    }

    const { data, error } = await supabase
      .from('board_summaries')
      .select('id, name, type, owner_id, collaborator_count')
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert('Could not load boards', friendlyError(error));
      return;
    }

    setBoards(data ?? []);
  }

  async function clearHistory(board: Board) {
    const { error } = await supabase.from('board_item_cache').delete().eq('sheet_id', board.id);
    if (error) {
      Alert.alert('Could not clear history', friendlyError(error));
      return;
    }
    Alert.alert('Cleared', `${board.name}'s suggestion history has been cleared.`);
  }

  function confirmClear(board: Board) {
    Alert.alert(
      `Clear ${board.name}'s history?`,
      "This clears everything it remembers. Your current list stays exactly as it is.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clearHistory(board) },
      ]
    );
  }

  function confirmDeleteBoard(board: Board) {
    Alert.alert(
      `Delete ${board.name}?`,
      'This permanently deletes the board, all its items, its suggestion history, and removes anyone it was shared with. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteBoard(board) },
      ]
    );
  }

  async function deleteBoard(board: Board) {
    setBoards((current) => current.filter((b) => b.id !== board.id));
    const { error } = await supabase.from('task_sheets').delete().eq('id', board.id);
    if (error) {
      Alert.alert('Could not delete board', friendlyError(error));
      loadBoards();
    }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not sign out', friendlyError(error));
  }

  function confirmDeleteAccount() {
    const sharedOwned = boards.filter((b) => b.owner_id === myId && b.collaborator_count > 0);
    const sharedNote =
      sharedOwned.length > 0
        ? `\n\nThese boards are shared with others and will be deleted for them too: ${sharedOwned
            .map((b) => b.name)
            .join(', ')}.`
        : '';

    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, your boards and everything in them, ' +
        'your suggestion history and your sharing circle. Items you added to other ' +
        "people's boards stay on their lists." +
        sharedNote,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert('This cannot be undone', 'Delete your Nolista account now?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete account', style: 'destructive', onPress: deleteAccount },
            ]),
        },
      ]
    );
  }

  async function deleteAccount() {
    setDeleting(true);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setDeleting(false);
      Alert.alert('Could not delete account', friendlyError(error));
      return;
    }
    // The user no longer exists on the server, so only clear the local
    // session. The root layout then shows the sign-in screen.
    await supabase.auth.signOut({ scope: 'local' });
  }

  const cacheableBoards = boards.filter((b) => b.type === 'market' || b.type === 'custom');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {!pickerOpen ? (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.sectionLabel}>Sharing & collaborators</Text>
          {sortBoards(boards, myId).map((board) => {
            const accent = BOARD_ACCENTS[board.type] ?? BOARD_ACCENTS.custom;
            const isOwnedByMe = board.owner_id === myId;
            const isCustom = board.type === 'custom';
            return (
              <View key={board.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: accent.text }]} />
                <Text style={styles.rowLabel}>{board.name}</Text>
                <Text style={styles.rowMeta}>
                  {board.type === 'focus' ? 'private' : `${board.collaborator_count + 1} people`}
                </Text>
                {isCustom && isOwnedByMe && (
                  <Pressable onPress={() => confirmDeleteBoard(board)} hitSlop={10} style={{ marginLeft: 10 }}>
                    <Ionicons name="trash-outline" size={16} color={Brand.colors.danger} />
                  </Pressable>
                )}
              </View>
            );
          })}

          <Pressable style={styles.row} onPress={() => setPickerOpen(true)}>
            <Ionicons name="trash-outline" size={16} color={Brand.colors.ink} style={{ marginRight: 12 }} />
            <Text style={styles.rowLabel}>Clear suggestion history</Text>
            <Ionicons name="chevron-forward" size={16} color={Brand.colors.muted} />
          </Pressable>

          {reminders && Platform.OS !== 'web' && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Reminders</Text>
              <View style={styles.row}>
                <Ionicons name="notifications-outline" size={16} color={Brand.colors.ink} style={{ marginRight: 12 }} />
                <Text style={styles.rowLabel}>Remind me of due items</Text>
                <Switch
                  value={reminders.enabled}
                  onValueChange={(enabled) => updateReminders({ ...reminders, enabled })}
                  trackColor={{ true: Brand.colors.sprout }}
                />
              </View>
              {reminders.enabled && (
                <View style={styles.timeRow}>
                  {REMINDER_TIMES.map((t) => {
                    const active = reminders.hour === t.hour && reminders.minute === 0;
                    return (
                      <Pressable
                        key={t.hour}
                        style={[styles.timeChip, active && styles.timeChipActive]}
                        onPress={() => updateReminders({ ...reminders, hour: t.hour, minute: 0 })}
                      >
                        <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Account</Text>
          <Pressable style={styles.row} onPress={() => setNameOpen(true)}>
            <Ionicons name="person-outline" size={16} color={Brand.colors.ink} style={{ marginRight: 12 }} />
            <Text style={styles.rowLabel}>Your name</Text>
            <Text style={[styles.rowMeta, { marginRight: 8 }]}>{myName ?? 'Not set'}</Text>
            <Ionicons name="chevron-forward" size={16} color={Brand.colors.muted} />
          </Pressable>
          <Pressable style={styles.row} onPress={signOut}>
            <Ionicons name="log-out-outline" size={16} color={Brand.colors.danger} style={{ marginRight: 12 }} />
            <Text style={[styles.rowLabel, { color: Brand.colors.danger }]}>Sign out</Text>
          </Pressable>
          <Pressable style={styles.row} onPress={confirmDeleteAccount} disabled={deleting}>
            <Ionicons name="person-remove-outline" size={16} color={Brand.colors.danger} style={{ marginRight: 12 }} />
            <Text style={[styles.rowLabel, { color: Brand.colors.danger }]}>
              {deleting ? 'Deleting account…' : 'Delete account'}
            </Text>
            {deleting && <ActivityIndicator color={Brand.colors.danger} />}
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.list}>
          <Pressable onPress={() => setPickerOpen(false)} style={{ marginBottom: 16 }}>
            <Text style={styles.backText}>‹ Settings</Text>
          </Pressable>
          <Text style={styles.sectionLabel}>Choose a board</Text>
          {cacheableBoards.length === 0 ? (
            <Text style={styles.rowMeta}>No boards with suggestion history yet</Text>
          ) : (
            cacheableBoards.map((board) => (
              <Pressable key={board.id} style={styles.row} onPress={() => confirmClear(board)}>
                <Text style={styles.rowLabel}>{board.name}</Text>
                <Ionicons name="chevron-forward" size={16} color={Brand.colors.muted} />
              </Pressable>
            ))
          )}
        </View>
      )}
      <NameModal
        visible={nameOpen}
        initialName={myName}
        title="Your name"
        onClose={() => setNameOpen(false)}
        onSaved={(name) => {
          setMyName(name);
          setNameOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.paper, paddingTop: 60, paddingHorizontal: 22 },
  title: { fontFamily: Brand.fonts.display, fontSize: 26, color: Brand.colors.ink, marginBottom: 20 },
  list: { flex: 1 },
  sectionLabel: {
    fontFamily: Brand.fonts.body,
    fontSize: 12,
    color: Brand.colors.muted,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE9E2',
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 12 },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  timeChip: {
    borderWidth: 1.2,
    borderColor: '#E2DFD6',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  timeChipActive: { backgroundColor: Brand.colors.sprout, borderColor: Brand.colors.sprout },
  timeChipText: { fontFamily: Brand.fonts.bodyBold, fontSize: 13, color: Brand.colors.ink },
  timeChipTextActive: { color: '#fff' },
  rowLabel: { flex: 1, fontFamily: Brand.fonts.body, fontSize: 15, color: Brand.colors.ink },
  rowMeta: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted },
  backText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
});