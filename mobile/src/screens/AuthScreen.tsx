import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../../App';
import { C } from '../../App';
import { api } from '../api/CitadelAPI';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────

type AuthScreenProps = {
  navigation: StackNavigationProp<RootStackParamList, 'Auth'>;
  onAuth: () => void;
};

type Mode = 'login' | 'register';

// ── Component ─────────────────────────────────────────────────────────────

export default function AuthScreen({ navigation, onAuth }: AuthScreenProps) {
  const [mode, setMode]           = useState<Mode>('login');
  const [username, setUsername]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  const submit = async () => {
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required.');
      return;
    }
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await api.login(username.trim(), password)
        : await api.register(username.trim(), password, email.trim() || undefined);

      if (res.ok) {
        // If "Remember me" is off, wipe the tokens from storage so the next
        // app launch shows the auth screen again. The current session continues
        // using the in-memory token.
        if (!rememberMe) {
          await api.forgetCredentials();
        }
        onAuth();
        navigation.replace('Main');
      } else {
        const msg = res.data?.error?.message || res.data?.message || 'Authentication failed.';
        setError(msg);
      }
    } catch {
      setError('Network error. Check your connection and server URL.');
    } finally {
      setLoading(false);
    }
  };

  const continueAsGuest = async () => {
    setLoading(true);
    try {
      const res = await api.registerGuest();
      if (res.ok) { onAuth(); navigation.replace('Main'); }
      else setError('Guest login unavailable.');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo / wordmark */}
        <View style={s.logoWrap}>
          <View style={s.logoCircle}>
            <Text style={s.logoText}>D</Text>
          </View>
          <Text style={s.appName}>Discreet</Text>
          <Text style={s.tagline}>End-to-end encrypted messaging</Text>
        </View>

        {/* Card */}
        <View style={s.card}>
          {/* Mode toggle */}
          <View style={s.tabs}>
            <TouchableOpacity
              style={[s.tab, mode === 'login' && s.tabActive]}
              onPress={() => { setMode('login'); setError(''); }}
            >
              <Text style={[s.tabLabel, mode === 'login' && s.tabLabelActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tab, mode === 'register' && s.tabActive]}
              onPress={() => { setMode('register'); setError(''); }}
            >
              <Text style={[s.tabLabel, mode === 'register' && s.tabLabelActive]}>Register</Text>
            </TouchableOpacity>
          </View>

          {/* Fields */}
          <Text style={s.label}>USERNAME</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={setUsername}
            placeholder="your_username"
            placeholderTextColor={C.mt}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {mode === 'register' && (
            <>
              <Text style={s.label}>EMAIL (OPTIONAL)</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={C.mt}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </>
          )}

          <Text style={s.label}>PASSWORD</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={C.mt}
            secureTextEntry
          />

          {/* Remember me */}
          {mode === 'login' && (
            <TouchableOpacity
              style={s.rememberRow}
              onPress={() => setRememberMe(p => !p)}
              activeOpacity={0.7}
            >
              <View style={[s.checkbox, rememberMe && s.checkboxOn]}>
                {rememberMe && <Text style={s.checkmark}>✓</Text>}
              </View>
              <Text style={s.rememberLabel}>Remember me on this device</Text>
            </TouchableOpacity>
          )}

          {!!error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.submitBtn, loading && s.submitBtnDisabled]}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={s.submitLabel}>{mode === 'login' ? 'Sign In' : 'Create Account'}</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.guestBtn} onPress={continueAsGuest} disabled={loading}>
            <Text style={s.guestLabel}>Continue as Guest</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: C.ac,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#000',
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: C.tx,
    letterSpacing: 0.5,
  },
  tagline: {
    fontSize: 13,
    color: C.mt,
    marginTop: 4,
  },
  card: {
    backgroundColor: C.sf,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.bd,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: C.sf2,
    borderRadius: 10,
    padding: 3,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: C.ac,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: C.mt,
  },
  tabLabelActive: {
    color: '#000',
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: C.mt,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    backgroundColor: C.sf2,
    borderWidth: 1,
    borderColor: C.bd,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: C.tx,
    fontSize: 14,
    marginBottom: 14,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingVertical: 2,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: C.bd,
    backgroundColor: C.sf2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: C.ac,
    borderColor: C.ac,
  },
  checkmark: {
    fontSize: 12,
    color: '#000',
    fontWeight: '700',
    lineHeight: 14,
  },
  rememberLabel: {
    fontSize: 13,
    color: C.mt,
  },
  errorBox: {
    backgroundColor: 'rgba(255,71,87,0.08)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,71,87,0.2)',
  },
  errorText: {
    color: C.err,
    fontSize: 12,
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: C.ac,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
  guestBtn: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  guestLabel: {
    color: C.mt,
    fontSize: 13,
  },
});
