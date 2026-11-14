import { FormEvent, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppButton } from './AppButton';
import { supabase } from '../lib/supabase';
import { colors, radius, shadow } from '../lib/theme';

export function SignInScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<'email' | 'password' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setLoading(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: password.trim() });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    await onSignedIn();
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.hero}>
          <View style={styles.logo}><Ionicons name="navigate" size={30} color="#fff" /></View>
          <Text style={styles.title}>Field Sales</Text>
          <Text style={styles.subtitle}>Sign in to manage your visits, orders and route.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <View style={[styles.field, focused === 'email' && styles.fieldFocused]}>
            <Ionicons name="mail-outline" size={20} color={colors.muted} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocused('email')}
              onBlur={() => setFocused(null)}
              placeholder="you@company.com"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={[styles.field, focused === 'password' && styles.fieldFocused]}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocused('password')}
              onBlur={() => setFocused(null)}
              placeholder="Enter your password"
              placeholderTextColor="#94a3b8"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="current-password"
              onSubmitEditing={() => void submit()}
            />
            <Pressable onPress={() => setShowPassword((current) => !current)} hitSlop={12} accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.muted} />
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <AppButton title="Sign in" loading={loading} disabled={loading} onPress={() => void submit()} style={styles.submit} />
        </View>

        <Text style={styles.footer}>Secure sign-in · Your location is recorded only during your work day</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: 22, gap: 22 },
  hero: { alignItems: 'center', gap: 8 },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', ...shadow },
  title: { fontSize: 30, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg + 4, padding: 20, gap: 8, ...shadow },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 6 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: '#f8fafc' },
  fieldFocused: { borderColor: colors.brand, backgroundColor: '#fff' },
  input: { flex: 1, paddingVertical: 13, fontSize: 16, color: colors.ink },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 10, marginTop: 6 },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: '600' },
  submit: { marginTop: 12, minHeight: 50 },
  footer: { textAlign: 'center', color: colors.muted, fontSize: 12 },
});