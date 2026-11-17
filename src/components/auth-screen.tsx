import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Brand } from '@/constants/brand';
import { supabase } from '../../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const trimmedEmail = email.trim().toLowerCase();

  async function sendCode() {
    setLoading(true);
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOtp({ email: trimmedEmail });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setCode('');
      setStage('code');
    }
    setLoading(false);
  }

  async function verifyCode() {
    setLoading(true);
    setErrorMsg('');
    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: code.trim(),
      type: 'email',
    });
    // On success the root layout sees the new session and opens the app.
    if (error) setErrorMsg(error.message);
    setLoading(false);
  }

  const isCodeStage = stage === 'code';

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.container}>
      <Image source={require('@/assets/images/icon.png')} style={styles.logo} contentFit="contain" />

      {isCodeStage ? (
        <>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>We sent a sign-in code to {trimmedEmail}</Text>
          <TextInput
            style={styles.input}
            placeholder="Sign-in code"
            placeholderTextColor={Brand.colors.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={verifyCode}
            maxLength={8}
            autoFocus
          />
        </>
      ) : (
        <>
          <Text style={styles.title}>Nolista</Text>
          <Text style={styles.subtitle}>family, made simple</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Brand.colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => trimmedEmail && sendCode()}
          />
        </>
      )}

      {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

      <Pressable
        style={[styles.button, (loading || (isCodeStage ? !code.trim() : !trimmedEmail)) && styles.buttonDisabled]}
        onPress={isCodeStage ? verifyCode : sendCode}
        disabled={loading || (isCodeStage ? !code.trim() : !trimmedEmail)}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{isCodeStage ? 'Sign in' : 'Send code'}</Text>
        )}
      </Pressable>

      {isCodeStage && (
        <View style={styles.secondaryRow}>
          <Pressable onPress={sendCode} disabled={loading} hitSlop={8}>
            <Text style={styles.secondaryText}>Resend code</Text>
          </Pressable>
          <Text style={styles.dot}>·</Text>
          <Pressable
            onPress={() => {
              setStage('email');
              setErrorMsg('');
            }}
            hitSlop={8}
          >
            <Text style={styles.secondaryText}>Use a different email</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: Brand.colors.stone },
  logo: { width: 96, height: 96, alignSelf: 'center', marginBottom: 16, borderRadius: 22 },
  title: {
    fontFamily: Brand.fonts.displayItalic,
    fontSize: 30,
    color: Brand.colors.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Brand.fonts.body,
    fontSize: 14,
    color: Brand.colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    backgroundColor: Brand.colors.paper,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontFamily: Brand.fonts.body,
    fontSize: 16,
    color: Brand.colors.ink,
    textAlign: 'center',
  },
  button: {
    backgroundColor: Brand.colors.sprout,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: Brand.fonts.bodyBold, color: '#fff', fontSize: 15 },
  secondaryRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 },
  secondaryText: { fontFamily: Brand.fonts.bodyBold, color: Brand.colors.sprout, fontSize: 14 },
  dot: { color: Brand.colors.muted },
  error: {
    fontFamily: Brand.fonts.body,
    color: Brand.colors.danger,
    marginBottom: 12,
    textAlign: 'center',
  },
});
