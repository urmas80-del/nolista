import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../lib/supabase';

type Collaborator = { user_id: string; email: string; name: string | null };
type Invite = { id: string; invited_email: string };
type KnownContact = { contact_email: string };

export default function ShareModal({
  visible,
  boardId,
  boardName,
  onClose,
}: {
  visible: boolean;
  boardId: string;
  boardName: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [knownContacts, setKnownContacts] = useState<KnownContact[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  async function load() {
    setErrorMsg('');
    const { data: userData } = await supabase.auth.getUser();

    const { data: collabData } = await supabase
      .from('sheet_collaborators')
      .select('user_id, profiles(email, display_name)')
      .eq('sheet_id', boardId);

    setCollaborators(
      (collabData ?? []).map((c: any) => ({
        user_id: c.user_id,
        email: c.profiles?.email ?? '?',
        name: c.profiles?.display_name ?? null,
      }))
    );

    const { data: inviteData } = await supabase
      .from('board_invites')
      .select('id, invited_email')
      .eq('sheet_id', boardId)
      .eq('status', 'pending');

    setInvites(inviteData ?? []);

    const { data: known } = await supabase
      .from('known_users')
      .select('contact_email')
      .eq('owner_id', userData.user?.id);

    setKnownContacts(known ?? []);
  }

  async function sendInviteTo(targetEmail: string) {
    const trimmed = targetEmail.trim().toLowerCase();
    if (!trimmed) return;
    setErrorMsg('');

    const { data: user } = await supabase.auth.getUser();
    if (trimmed === user.user?.email?.toLowerCase()) {
      setErrorMsg("That's your own email. You already have access to this board.");
      return;
    }
    if (alreadyEmails.has(trimmed)) {
      setErrorMsg('That person already has access or a pending invite.');
      return;
    }

    const { error } = await supabase.from('board_invites').insert({
      sheet_id: boardId,
      invited_email: trimmed,
      invited_by: user.user?.id,
    });

    if (error) {
      setErrorMsg(friendlyError(error, 'invite'));
      return;
    }

    setEmail('');
    load();
  }

  async function revokeInvite(inviteId: string) {
    setInvites((current) => current.filter((i) => i.id !== inviteId));
    const { error } = await supabase.from('board_invites').delete().eq('id', inviteId);
    if (error) {
      setErrorMsg(friendlyError(error));
      load();
    }
  }

  const alreadyEmails = new Set([
    ...collaborators.map((c) => c.email),
    ...invites.map((i) => i.invited_email),
  ]);

  const matchingContacts = knownContacts.filter(
    (k) =>
      !alreadyEmails.has(k.contact_email) &&
      (email.trim().length === 0 || k.contact_email.toLowerCase().includes(email.trim().toLowerCase()))
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>‹ Close</Text>
        </Pressable>
        <Text style={styles.title}>Invite people to {boardName}</Text>
        <Text style={styles.emptyText}>They’ll see and edit the same live list.</Text>

        <Text style={styles.sectionLabel}>People with access</Text>
        <FlatList
          data={collaborators}
          keyExtractor={(item) => item.user_id}
          style={{ maxHeight: 120 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>{item.name ?? item.email}</Text>
                {item.name && <Text style={styles.roleTag}>{item.email}</Text>}
              </View>
              <Text style={styles.roleTag}>Editor</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Just you so far</Text>}
        />

        {invites.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Pending invites</Text>
            {invites.map((inv) => (
              <View key={inv.id} style={styles.row}>
                <Text style={styles.rowText}>{inv.invited_email}</Text>
                <Pressable onPress={() => revokeInvite(inv.id)} hitSlop={10}>
                  <Ionicons name="close-circle-outline" size={18} color={Brand.colors.muted} />
                </Pressable>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>Invite someone</Text>
        <TextInput
          style={styles.input}
          placeholder="Search your circle or type an email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        {matchingContacts.length > 0 && (
          <View style={styles.suggestBox}>
            {matchingContacts.slice(0, 5).map((c) => (
              <Pressable key={c.contact_email} style={styles.suggestRow} onPress={() => sendInviteTo(c.contact_email)}>
                <Ionicons name="person-circle-outline" size={16} color={Brand.colors.sprout} />
                <Text style={styles.suggestText}>{c.contact_email}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        <Pressable style={styles.sendBtn} onPress={() => sendInviteTo(email)}>
          <Text style={styles.sendBtnText}>Invite</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.paper, paddingTop: 60, paddingHorizontal: 22 },
  closeBtn: { marginBottom: 10 },
  closeText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
  title: { fontFamily: Brand.fonts.display, fontSize: 24, color: Brand.colors.ink, marginBottom: 20 },
  sectionLabel: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted, marginBottom: 8, marginTop: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE9E2',
  },
  rowText: { fontFamily: Brand.fonts.body, fontSize: 14.5, color: Brand.colors.ink },
  roleTag: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted },
  emptyText: { fontFamily: Brand.fonts.body, fontSize: 13, color: Brand.colors.muted },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontFamily: Brand.fonts.body, fontSize: 15, marginBottom: 6 },
  suggestBox: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEE7',
  },
  suggestText: { fontFamily: Brand.fonts.body, fontSize: 14, color: Brand.colors.ink },
  error: { color: Brand.colors.danger, fontFamily: Brand.fonts.body, fontSize: 13, marginBottom: 8 },
  sendBtn: { backgroundColor: Brand.colors.sprout, borderRadius: 12, padding: 14, alignItems: 'center' },
  sendBtnText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 15 },
});