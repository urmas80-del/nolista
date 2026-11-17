import { useEffect, useState } from 'react';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { useFonts, Fraunces_500Medium, Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces';
import { Karla_400Regular, Karla_700Bold } from '@expo-google-fonts/karla';

import { Brand } from '@/constants/brand';
import { supabase } from '../../lib/supabase';

// Keep the native splash (NoLista logo) up until fonts and session are ready.
// Called at module scope, as the expo-splash-screen docs recommend.
SplashScreen.preventAutoHideAsync();

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

  if (!ready) {
    return null;
  }

  const signedIn = !!session;

  return (
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
  );
}
