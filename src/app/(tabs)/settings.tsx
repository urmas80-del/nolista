import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { BOARD_ACCENTS } from '@/constants/boards';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../../lib/supabase';

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
  const [pickerOpen, setPickerOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadBoards();
    }, [])
  );

  async function loadBoards() {
    const { data: userData } = await supabase.auth.getUser();
    setMyId(userData.user?.id ?? null);

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

  const cacheableBoards = boards.filter((b) => b.type === 'market' || b.type === 'custom');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {!pickerOpen ? (
        <View style={styles.list}>
          <Text style={styles.sectionLabel}>Sharing & collaborators</Text>
          {boards.map((board) => {
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

          <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Account</Text>
          <Pressable style={styles.row} onPress={signOut}>
            <Ionicons name="log-out-outline" size={16} color={Brand.colors.danger} style={{ marginRight: 12 }} />
            <Text style={[styles.rowLabel, { color: Brand.colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>
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
  rowLabel: { flex: 1, fontFamily: Brand.fonts.body, fontSize: 15, color: Brand.colors.ink },
  rowMeta: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted },
  backText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
});