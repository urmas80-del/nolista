import { useEffect, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Brand } from '@/constants/brand';
import { fromDateString, toDateString } from '@/utils/due-dates';

/**
 * Pick a due date. onPick gets 'YYYY-MM-DD', or null for "Clear".
 * Android: the system date dialog. iOS: a sheet with an inline calendar.
 */
export default function DueDatePicker({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: string | null;
  onPick: (value: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => (value ? fromDateString(value) : new Date()));

  // Android and web have no component to render; open the dialog instead.
  useEffect(() => {
    if (!visible || Platform.OS === 'ios') return;
    if (Platform.OS !== 'android') {
      Alert.alert('Not available', 'Due dates can be set in the phone app.');
      onClose();
      return;
    }
    DateTimePickerAndroid.open({
      value: value ? fromDateString(value) : new Date(),
      mode: 'date',
      neutralButton: value ? { label: 'Clear' } : undefined,
      onChange: (event, date) => {
        if (event.type === 'set' && date) onPick(toDateString(date));
        else if (event.type === 'neutralButtonPressed') onPick(null);
        onClose();
      },
    });
    // Open once per show; value/onPick changes while open don't matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (Platform.OS !== 'ios') return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => setDraft(value ? fromDateString(value) : new Date())}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <DateTimePicker
            value={draft}
            mode="date"
            display="inline"
            accentColor={Brand.colors.sprout}
            themeVariant="light"
            onChange={(_, date) => date && setDraft(date)}
          />
          <View style={styles.actions}>
            {value ? (
              <Pressable
                hitSlop={10}
                onPress={() => {
                  onPick(null);
                  onClose();
                }}
              >
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <View style={styles.rightActions}>
              <Pressable hitSlop={10} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                hitSlop={10}
                onPress={() => {
                  onPick(toDateString(draft));
                  onClose();
                }}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 18 },
  sheet: { backgroundColor: '#fff', borderRadius: 18, padding: 12 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rightActions: { flexDirection: 'row', gap: 22 },
  clearText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.danger, fontSize: 15 },
  cancelText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.muted, fontSize: 15 },
  doneText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 15 },
});
