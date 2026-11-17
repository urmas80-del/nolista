import { useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Switch, StyleSheet, Alert } from 'react-native';
import { Brand } from '@/constants/brand';
import { friendlyError } from '@/utils/errors';
import { supabase } from '../../lib/supabase';

export default function CreateBoardModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [cachingEnabled, setCachingEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_sheets').insert({
      owner_id: userData.user?.id,
      name: trimmed,
      type: 'custom',
      caching_enabled: cachingEnabled,
    });

    setSaving(false);

    if (error) {
      Alert.alert('Could not create board', friendlyError(error));
      return;
    }

    setName('');
    setCachingEnabled(false);
    onCreated();
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>New board</Text>

          <TextInput
            style={styles.input}
            placeholder="Board name"
            value={name}
            onChangeText={setName}
            autoFocus
          />

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Smart suggestions</Text>
              <Text style={styles.toggleSub}>Remember items you add, like Market does</Text>
            </View>
            <Switch
              value={cachingEnabled}
              onValueChange={setCachingEnabled}
              trackColor={{ true: Brand.colors.sprout }}
            />
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.createBtn} onPress={create} disabled={saving || !name.trim()}>
              <Text style={styles.createText}>{saving ? 'Creating…' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(43,42,40,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: Brand.colors.paper, borderRadius: 18, padding: 22 },
  title: { fontFamily: Brand.fonts.display, fontSize: 20, color: Brand.colors.ink, marginBottom: 16 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontFamily: Brand.fonts.body,
    fontSize: 15,
    marginBottom: 16,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  toggleLabel: { fontFamily: Brand.fonts.bodyBold, fontSize: 14, color: Brand.colors.ink },
  toggleSub: { fontFamily: Brand.fonts.body, fontSize: 12, color: Brand.colors.muted, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1.4,
    borderColor: '#D8D5CC',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  cancelText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.ink, fontSize: 14 },
  createBtn: { flex: 1, backgroundColor: Brand.colors.sprout, borderRadius: 12, padding: 12, alignItems: 'center' },
  createText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 14 },
});