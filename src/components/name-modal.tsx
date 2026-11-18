import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Brand } from '@/constants/brand';
import { friendlyError } from '@/utils/errors';
import { cleanName, MAX_NAME_LENGTH } from '@/utils/names';
import { supabase } from '../../lib/supabase';

/** Asks for (or edits) the name other people see on shared boards. */
export default function NameModal({
  visible,
  initialName,
  title = 'What should we call you?',
  onClose,
  onSaved,
}: {
  visible: boolean;
  initialName?: string | null;
  title?: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initialName ?? '');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function reset() {
    setDraft(initialName ?? '');
    setErrorMsg('');
  }

  async function save() {
    const name = cleanName(draft);
    if (!name) {
      setErrorMsg(`Enter a name up to ${MAX_NAME_LENGTH} characters.`);
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name })
      .eq('id', userData.user?.id ?? '');
    setSaving(false);
    if (error) {
      setErrorMsg(friendlyError(error));
      return;
    }
    onSaved(name);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onShow={reset}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>People you share boards with will see this name.</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Your name"
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            maxLength={MAX_NAME_LENGTH}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={onClose} hitSlop={10} disabled={saving}>
              <Text style={styles.laterText}>Not now</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  card: { backgroundColor: Brand.colors.paper, borderRadius: 18, padding: 22 },
  title: { fontFamily: Brand.fonts.display, fontSize: 21, color: Brand.colors.ink },
  body: { fontFamily: Brand.fonts.body, fontSize: 13.5, color: Brand.colors.muted, marginTop: 6, marginBottom: 16 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontFamily: Brand.fonts.body,
    fontSize: 16,
    color: Brand.colors.ink,
  },
  error: { color: Brand.colors.danger, fontFamily: Brand.fonts.body, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 20, marginTop: 18 },
  laterText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.muted, fontSize: 14 },
  saveBtn: {
    backgroundColor: Brand.colors.sprout,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 22,
    minWidth: 84,
    alignItems: 'center',
  },
  saveText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 15 },
});
