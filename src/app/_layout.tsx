import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { useFonts, Fraunces_500Medium, Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces';
import { Karla_400Regular, Karla_700Bold } from '@expo-google-fonts/karla';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { supabase } from '../../lib/supabase';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
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

  if (checkingSession || !fontsLoaded) {
    return null;
  }

  const signedIn = !!session;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
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
