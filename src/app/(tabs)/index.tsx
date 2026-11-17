import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Brand } from '@/constants/brand';
import { BOARD_ICONS, BOARD_ACCENTS } from '@/constants/boards';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../../lib/supabase';
import CreateBoardModal from '@/components/create-board-modal';

type Board = {
  id: string;
  name: string;
  type: string;
  caching_enabled: boolean;
  owner_id: string;
  doneCount: number;
  totalCount: number;
};

type PendingInvite = {
  id: string;
  sheet_id: string;
  task_sheets: { name: string; type: string } | null;
  profiles: { email: string } | null;
};

export default function Home() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [isPremium, setIsPremium] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Runs on first show and every time you come back to Home (e.g. from a
  // board), so counts and names stay current.
  useFocusEffect(
    useCallback(() => {
      loadBoards();
      loadInvites();
      loadProfile();
    }, [])
  );

  async function loadProfile() {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data } = await supabase
      .from('profiles')
      .select('is_premium')
      .eq('id', userData.user.id)
      .single();
    setIsPremium(data?.is_premium ?? false);
  }

  // The spinner only shows on first load (initial state); refreshes on focus
  // update the list in place.
  async function loadBoards() {
    // One request: boards you own or joined, with counts (board_summaries view).
    const { data, error } = await supabase
      .from('board_summaries')
      .select('id, name, type, caching_enabled, owner_id, total_count, done_count')
      .order('created_at', { ascending: true });

    if (error) {
      // Keep showing the last good list; only show the error state if empty.
      setLoadError(friendlyError(error));
    } else {
      setLoadError(null);
      setBoards(
        (data ?? []).map((b) => ({
          id: b.id,
          name: b.name,
          type: b.type,
          caching_enabled: b.caching_enabled,
          owner_id: b.owner_id,
          totalCount: b.total_count ?? 0,
          doneCount: b.done_count ?? 0,
        }))
      );
    }
    setLoading(false);
  }

  async function loadInvites() {
    const { data: userData } = await supabase.auth.getUser();
    const myEmail = userData.user?.email?.toLowerCase();
    if (!myEmail) return;

    const { data, error } = await supabase
      .from('board_invites')
      .select('id, sheet_id, task_sheets(name, type), profiles(email)')
      .eq('invited_email', myEmail)
      .eq('status', 'pending');

    if (error) {
      console.log('loadInvites error:', error.message);
      return;
    }
    setPendingInvites((data as any) ?? []);
  }

  async function respondToInvite(invite: PendingInvite, accept: boolean) {
    if (!accept) {
      const { error } = await supabase
        .from('board_invites')
        .update({ status: 'declined' })
        .eq('id', invite.id);
      if (error) {
        Alert.alert('Could not decline invite', friendlyError(error));
        return;
      }
      setPendingInvites((current) => current.filter((i) => i.id !== invite.id));
      return;
    }

    const { error } = await supabase.rpc('accept_board_invite', {
      p_invite_id: invite.id,
      p_merge: false,
    });

    if (error) {
      Alert.alert('Could not join board', friendlyError(error));
      loadInvites();
      return;
    }

    setPendingInvites((current) => current.filter((i) => i.id !== invite.id));
    loadBoards();
  }

  function handleNewBoardPress() {
    if (!isPremium) {
      Alert.alert('Premium feature', 'Custom boards are part of Nolista Premium.');
      return;
    }
    setCreateOpen(true);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Brand.colors.sprout} />
      </View>
    );
  }

  if (loadError && boards.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn’t load your boards.</Text>
        <Text style={styles.subtitle}>{loadError}</Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            loadBoards();
          }}
          hitSlop={10}
        >
          <Text style={styles.newBoardText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
  <Text style={styles.title}>Nolista</Text>
  <Pressable onPress={() => router.push('/people')} hitSlop={10} style={{ marginLeft: 15 }}>
    <Ionicons name="people-circle-outline" size={40} color={Brand.colors.sprout} />
  </Pressable>
</View>
<Text style={styles.subtitle}>family, made simple</Text>

      {pendingInvites.map((invite) => (
        <View key={invite.id} style={styles.inviteBanner}>
          <Text style={styles.inviteText}>
            {invite.profiles?.email ?? 'Someone'} invited you to {invite.task_sheets?.name ?? 'a board'}
          </Text>
          <View style={styles.inviteActions}>
            <Pressable style={styles.inviteAccept} onPress={() => respondToInvite(invite, true)}>
              <Text style={styles.inviteAcceptText}>Accept</Text>
            </Pressable>
            <Pressable style={styles.inviteDecline} onPress={() => respondToInvite(invite, false)}>
              <Text style={styles.inviteDeclineText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <FlatList
        data={boards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const accent = BOARD_ACCENTS[item.type] ?? BOARD_ACCENTS.custom;
          const icon = BOARD_ICONS[item.type] ?? BOARD_ICONS.custom;
          return (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/board/[id]', params: { id: item.id } })}
            >
              <View style={[styles.iconCircle, { backgroundColor: accent.bg }]}>
                <Ionicons name={icon as any} size={20} color={accent.text} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardName}>{item.name}</Text>
              </View>
              <View style={[styles.chip, { backgroundColor: accent.bg }]}>
                <Text style={[styles.chipText, { color: accent.text }]}>
                  {item.doneCount}/{item.totalCount}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <Pressable style={styles.newBoardBtn} onPress={handleNewBoardPress}>
            <Ionicons name="add-circle-outline" size={18} color={Brand.colors.sprout} />
            <Text style={styles.newBoardText}>New board</Text>
          </Pressable>
        }
      />

      <CreateBoardModal visible={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadBoards} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.colors.stone, paddingTop: 60, paddingHorizontal: 22 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: Brand.colors.stone },
  errorText: { fontFamily: Brand.fonts.display, fontSize: 18, color: Brand.colors.ink },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: Brand.fonts.displayItalic, fontSize: 30, color: Brand.colors.ink },
  subtitle: { fontFamily: Brand.fonts.body, fontSize: 13, color: Brand.colors.muted, marginTop: 4, marginBottom: 20 },
  list: { gap: 16, paddingBottom: 20 },
  card: {
    backgroundColor: Brand.colors.paper,
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconCircle: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  cardText: { flex: 1 },
  cardName: { fontFamily: Brand.fonts.display, fontSize: 18, color: Brand.colors.ink },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipText: { fontFamily: Brand.fonts.bodyBold, fontSize: 12 },
  inviteBanner: { backgroundColor: Brand.colors.marigoldTint, borderRadius: 14, padding: 14, marginBottom: 16 },
  inviteText: { fontFamily: Brand.fonts.body, fontSize: 13.5, color: Brand.colors.marigoldDark, marginBottom: 10 },
  inviteActions: { flexDirection: 'row', gap: 8 },
  inviteAccept: { backgroundColor: Brand.colors.marigoldDark, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  inviteAcceptText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 13 },
  inviteDecline: { borderWidth: 1.4, borderColor: Brand.colors.marigoldDark, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  inviteDeclineText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.marigoldDark, fontSize: 13 },
  newBoardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  newBoardText: { fontFamily: Brand.fonts.bodyBold, fontSize: 14, color: Brand.colors.sprout },
});