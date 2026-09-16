import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { supabase } from '../../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function sendCode() {
    setLoading(true);
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setStage('code');
    }
    setLoading(false);
  }

  async function verifyCode() {
    setLoading(true);
    setErrorMsg('');
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) setErrorMsg(error.message);
    setLoading(false);
  }

  if (stage === 'code') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Enter your code</Text>
        <Text style={styles.subtitle}>Sent to {email}</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your code"
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
          maxLength={8}
        />
        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
        <Pressable style={styles.button} onPress={verifyCode} disabled={loading}>
          <Text style={styles.buttonText}>Verify & sign in</Text>
        </Pressable>
        <Pressable style={styles.buttonSecondary} onPress={() => setStage('email')}>
          <Text style={styles.buttonSecondaryText}>Use a different email</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nolista</Text>
      <Text style={styles.subtitle}>Enter your email to get a sign-in code</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
      <Pressable style={styles.button} onPress={sendCode} disabled={loading || !email}>
        <Text style={styles.buttonText}>Send code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#EDEAE3' },
  title: { fontSize: 28, fontWeight: '600', marginBottom: 8, textAlign: 'center', color: '#2B2A28' },
  subtitle: { fontSize: 14, marginBottom: 24, textAlign: 'center', color: '#8B887F' },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, fontSize: 15, textAlign: 'center' },
  button: { backgroundColor: '#4C7A5E', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  buttonSecondary: { padding: 14, alignItems: 'center', marginTop: 8 },
  buttonSecondaryText: { color: '#4C7A5E', fontWeight: '700', fontSize: 15 },
  error: { color: '#A8462F', marginBottom: 12, textAlign: 'center' },
});