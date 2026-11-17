import { useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, TextInput, StyleSheet, Alert, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../lib/supabase';

type BoardOption = { id: string; name: string };
type KnownUser = { email: string; boardIds: string[] };

export default function PeopleScreen({ onBack }: { onBack: () => void }) {
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const [myBoards, setMyBoards] = useState<BoardOption[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newBoardIds, setNewBoardIds] = useState<string[]>([]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: userData } = await supabase.auth.getUser();
    const myId = userData.user?.id;
    if (!myId) return;

    const { data: known } = await supabase
      .from('known_users')
      .select('contact_email')
      .eq('owner_id', myId);

    const { data: boards } = await supabase
      .from('task_sheets')
      .select('id, name, type')
      .eq('owner_id', myId)
      .neq('type', 'focus');

    const boardOptions = (boards ?? []).map((b) => ({ id: b.id, name: b.name }));
    setMyBoards(boardOptions);

    const boardIds = boardOptions.map((b) => b.id);
    const { data: collaborators } = boardIds.length
      ? await supabase.from('sheet_collaborators').select('sheet_id, user_id').in('sheet_id', boardIds)
      : { data: [] as any[] };

    const emails = (known ?? []).map((k) => k.contact_email);
    const { data: profilesData } = emails.length
      ? await supabase.from('profiles').select('id, email').in('email', emails)
      : { data: [] as any[] };

    const emailToId: Record<string, string> = {};
    (profilesData ?? []).forEach((p: any) => {
      emailToId[p.email] = p.id;
    });

    const result: KnownUser[] = (known ?? []).map((k) => {
      const uid = emailToId[k.contact_email];
      const ids = uid
        ? (collaborators ?? []).filter((c: any) => c.user_id === uid).map((c: any) => c.sheet_id)
        : [];
      return { email: k.contact_email, boardIds: ids };
    });

    setKnownUsers(result);
  }

  async function removeFromBoard(email: string, boardId: string) {
    const { data: profile } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
    if (!profile) {
      Alert.alert('Could not remove', `${email} wasn't found on this board.`);
      load();
      return;
    }
    const { error } = await supabase
      .from('sheet_collaborators')
      .delete()
      .eq('sheet_id', boardId)
      .eq('user_id', profile.id);
    if (error) Alert.alert('Could not remove', friendlyError(error));
    load();
  }

  function confirmRemovePerson(email: string) {
    Alert.alert(
      `Remove ${email}?`,
      'This removes them from every board you share and takes them out of your circle.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('remove_known_user', { p_contact_email: email });
            if (error) {
              Alert.alert(`Could not remove ${email}`, friendlyError(error));
              return;
            }
            load();
          },
        },
      ]
    );
  }

  async function addPerson() {
    const email = newEmail.trim().toLowerCase();
    if (!email || newBoardIds.length === 0) {
      Alert.alert('Missing info', 'Enter an email and choose at least one board.');
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (email === userData.user?.email?.toLowerCase()) {
      Alert.alert('Could not invite', "That's your own email.");
      return;
    }
    for (const sheetId of newBoardIds) {
      const { error } = await supabase.from('board_invites').insert({
        sheet_id: sheetId,
        invited_email: email,
        invited_by: userData.user?.id,
      });
      if (error) {
        const boardName = myBoards.find((b) => b.id === sheetId)?.name ?? 'a board';
        Alert.alert(`Could not invite to ${boardName}`, friendlyError(error, 'invite'));
        load();
        return;
      }
    }
    setNewEmail('');
    setNewBoardIds([]);
    setAddOpen(false);
    load();
  }

  async function addExistingToBoard(email: string, boardId: string) {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('board_invites').insert({
      sheet_id: boardId,
      invited_email: email,
      invited_by: userData.user?.id,
    });
    if (error) {
      Alert.alert('Could not share', friendlyError(error, 'invite'));
      return;
    }
    setPickerFor(null);
    load();
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.container, { paddingTop: insets.top + 16 }]}
    >
      <Pressable onPress={onBack} style={{ marginBottom: 10 }}>
        <Text style={styles.backText}>‹ Home</Text>
      </Pressable>
      <Text style={styles.title}>Your sharing circle</Text>
      <Text style={styles.subtitle}>{knownUsers.length} of up to 5 people (free plan)</Text>

      <FlatList
        data={knownUsers}
        keyExtractor={(item) => item.email}
        contentContainerStyle={{ paddingBottom: 20 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={styles.personCard}>
            <View style={styles.personRow}>
              <Text style={styles.personEmail}>{item.email}</Text>
              <View style={styles.personActions}>
                <Pressable onPress={() => setPickerFor(item.email)} hitSlop={10}>
                  <Ionicons name="add-circle-outline" size={20} color={Brand.colors.sprout} />
                </Pressable>
                <Pressable onPress={() => confirmRemovePerson(item.email)} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={Brand.colors.danger} />
                </Pressable>
              </View>
            </View>
            <View style={styles.chipRow}>
              {item.boardIds.length === 0 ? (
                <Text style={styles.noBoardsText}>No boards shared yet</Text>
              ) : (
                item.boardIds.map((bid) => {
                  const board = myBoards.find((b) => b.id === bid);
                  if (!board) return null;
                  return (
                    <View key={bid} style={styles.boardChip}>
                      <Text style={styles.boardChipText}>{board.name}</Text>
                      <Pressable onPress={() => removeFromBoard(item.email, bid)} hitSlop={6}>
                        <Ionicons name="close" size={13} color={Brand.colors.sproutDark} />
                      </Pressable>
                    </View>
                  );
                })
              )}
            </View>

            {pickerFor === item.email && (
              <View style={styles.pickerBox}>
                <Text style={styles.pickerLabel}>Add to a board:</Text>
                {myBoards
                  .filter((b) => !item.boardIds.includes(b.id))
                  .map((b) => (
                    <Pressable key={b.id} style={styles.pickerRow} onPress={() => addExistingToBoard(item.email, b.id)}>
                      <Text style={styles.pickerRowText}>{b.name}</Text>
                    </Pressable>
                  ))}
              </View>
            )}
          </View>
        )}
        ListFooterComponent={
          addOpen ? (
            <View style={styles.addBox}>
              <TextInput
                style={styles.input}
                placeholder="name@email.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={newEmail}
                onChangeText={setNewEmail}
              />
              <Text style={styles.pickerLabel}>Share which boards?</Text>
              {myBoards.map((b) => {
                const selected = newBoardIds.includes(b.id);
                return (
                  <Pressable
                    key={b.id}
                    style={styles.pickerRow}
                    onPress={() =>
                      setNewBoardIds((current) =>
                        selected ? current.filter((id) => id !== b.id) : [...current, b.id]
                      )
                    }
                  >
                    <Text style={styles.pickerRowText}>{b.name}</Text>
                    {selected && <Ionicons name="checkmark" size={16} color={Brand.colors.sprout} />}
                  </Pressable>
                );
              })}
              <Pressable style={styles.sendBtn} onPress={addPerson}>
                <Text style={styles.sendBtnText}>Send invite</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.newPersonBtn} onPress={() => setAddOpen(true)}>
              <Ionicons name="person-add-outline" size={16} color={Brand.colors.sprout} />
              <Text style={styles.newPersonText}>Add someone new</Text>
            </Pressable>
          )
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.paper, paddingHorizontal: 22 },
  backText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
  title: { fontFamily: Brand.fonts.display, fontSize: 24, color: Brand.colors.ink },
  subtitle: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted, marginTop: 4, marginBottom: 16 },
  personCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10 },
  personRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  personEmail: { fontFamily: Brand.fonts.bodyBold, fontSize: 14, color: Brand.colors.ink, flex: 1 },
  personActions: { flexDirection: 'row', gap: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  noBoardsText: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted },
  boardChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Brand.colors.sproutTint,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  boardChipText: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.sproutDark },
  pickerBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#ECE9E2', paddingTop: 10 },
  pickerLabel: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted, marginBottom: 6 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  pickerRowText: { fontFamily: Brand.fonts.body, fontSize: 14, color: Brand.colors.ink },
  addBox: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 4 },
  input: {
    backgroundColor: Brand.colors.stone,
    borderRadius: 10,
    padding: 12,
    fontFamily: Brand.fonts.body,
    fontSize: 14,
    marginBottom: 12,
  },
  sendBtn: { backgroundColor: Brand.colors.sprout, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  sendBtnText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 14 },
  newPersonBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  newPersonText: { fontFamily: Brand.fonts.bodyBold, fontSize: 14, color: Brand.colors.sprout },
});