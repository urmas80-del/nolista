import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { Session } from '@supabase/supabase-js';
import { useFonts, Fraunces_500Medium, Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces';
import { Karla_400Regular, Karla_700Bold } from '@expo-google-fonts/karla';

import { Brand } from '@/constants/brand';
import { clearReminders, syncReminders } from '@/utils/reminders';
import { supabase } from '../../lib/supabase';

// Keep the native splash (NoLista logo) up until fonts and session are ready.
// Called at module scope, as the expo-splash-screen docs recommend.
SplashScreen.preventAutoHideAsync();

// Show due-date reminders even while the app is open.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Tapping a reminder opens its board (or Home if it covers several). */
function openFromNotification(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const boardId = response.notification.request.content.data?.boardId;
  if (typeof boardId === 'string') router.push({ pathname: '/board/[id]', params: { id: boardId } });
  else router.navigate('/');
  Notifications.clearLastNotificationResponse();
}

// The brand palette is light-only, so the app is light-only (see app.json).
const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: Brand.colors.paper, primary: Brand.colors.sprout },
};

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Karla_400Regular,
    Karla_700Bold,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const ready = !checkingSession && fontsLoaded;

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  const signedIn = !!session;

  // Reminders: rebuild on sign-in/start and each time the app is left (so
  // changes made meanwhile, by you or others, are included). Signed out: none.
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    if (!signedIn) {
      clearReminders();
      return;
    }
    syncReminders();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'background') syncReminders();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    // A tap that launched the app from closed.
    openFromNotification(Notifications.getLastNotificationResponse());
    return () => {
      appState.remove();
      tapped.remove();
    };
  }, [ready, signedIn]);

  if (!ready) {
    return null;
  }

  return (
    // Gesture root: needed for drag-to-reorder in lists.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={theme}>
        <StatusBar style="dark" />
        {/* Screens draw their own headers; the Stack gives native push/back. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="board/[id]" />
            <Stack.Screen name="people" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
