import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Brand } from '@/constants/brand';
import TaskListScreen from '@/components/task-list-screen';
import { supabase } from '../../../lib/supabase';

type Board = {
  id: string;
  name: string;
  type: string;
  caching_enabled: boolean;
  owner_id: string;
};

export default function BoardRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [board, setBoard] = useState<Board | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    // If the id changes before this finishes, drop the stale result.
    let cancelled = false;

    async function load() {
      const [{ data: sheet }, { data: userData }] = await Promise.all([
        supabase
          .from('task_sheets')
          .select('id, name, type, caching_enabled, owner_id')
          .eq('id', id)
          .maybeSingle(),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;

      // RLS returns nothing for boards you can't access, same as a deleted one.
      if (!sheet) {
        setStatus('missing');
        return;
      }

      let premium = false;
      if (userData.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_premium')
          .eq('id', userData.user.id)
          .maybeSingle();
        premium = profile?.is_premium ?? false;
      }
      if (cancelled) return;

      setIsPremium(premium);
      setBoard(sheet);
      setStatus('ready');
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/'); // opened from a deep link: no history
  }

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Brand.colors.sprout} />
      </View>
    );
  }

  if (status === 'missing' || !board) {
    return (
      <View style={styles.center}>
        <Text style={styles.missingTitle}>This board isn’t available</Text>
        <Text style={styles.missingText}>It may have been deleted, or you no longer have access.</Text>
        <Pressable onPress={goBack} hitSlop={10}>
          <Text style={styles.backText}>‹ Boards</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <TaskListScreen
      board={board}
      isPremium={isPremium}
      onBack={goBack}
      onRenamed={(newName) => setBoard((prev) => (prev ? { ...prev, name: newName } : prev))}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: Brand.colors.paper,
  },
  missingTitle: { fontFamily: Brand.fonts.display, fontSize: 20, color: Brand.colors.ink },
  missingText: { fontFamily: Brand.fonts.body, fontSize: 14, color: Brand.colors.muted, textAlign: 'center' },
  backText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15, marginTop: 8 },
});
