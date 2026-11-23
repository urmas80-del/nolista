import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps, TabListProps } from 'expo-router/ui';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Brand } from '@/constants/brand';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="settings" href="/settings" asChild>
            <TabButton>Settings</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

// `ref` is dropped: expo-router types it for a View, which RN 0.88's strict
// types won't accept on a Pressable, and the tab button doesn't need it.
export function TabButton({ children, isFocused, ref: _ref, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <View style={[styles.tabButton, isFocused && styles.tabButtonActive]}>
        <Text style={[styles.tabText, isFocused && styles.tabTextActive]}>{children}</Text>
      </View>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <View style={styles.inner}>
        <Text style={styles.brandText}>Nolista</Text>
        {props.children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: 8,
    maxWidth: 800,
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 24,
    backgroundColor: Brand.colors.paper,
  },
  brandText: {
    marginRight: 'auto',
    fontFamily: Brand.fonts.displayItalic,
    fontSize: 18,
    color: Brand.colors.ink,
  },
  tabButton: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14 },
  tabButtonActive: { backgroundColor: Brand.colors.sproutTint },
  tabText: { fontFamily: Brand.fonts.body, fontSize: 14, color: Brand.colors.muted },
  tabTextActive: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sproutDark },
  pressed: { opacity: 0.7 },
});
