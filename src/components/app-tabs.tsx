import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Brand } from '@/constants/brand';

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={Brand.colors.paper}
      indicatorColor={Brand.colors.sproutTint}
      iconColor={{ default: Brand.colors.muted, selected: Brand.colors.sprout }}
      labelStyle={{
        default: { color: Brand.colors.muted },
        selected: { color: Brand.colors.sproutDark },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
