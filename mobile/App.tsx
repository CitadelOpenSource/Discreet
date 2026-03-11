import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from './src/api/CitadelAPI';
import AuthScreen from './src/screens/AuthScreen';
import MainScreen from './src/screens/MainScreen';

// ── Navigation types ────────────────────────────────────────────────────

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

// ── Theme colours (matches Discreet web client) ──────────────────────────

export const C = {
  bg:  '#07090f',
  sf:  '#0f1219',
  sf2: '#161d2b',
  bd:  '#1e2d40',
  tx:  '#e0e4ea',
  mt:  '#666b7a',
  ac:  '#00d2aa',
  ac2: '#00a896',
  err: '#ff4757',
  warn:'#faa61a',
};

// ── Splash screen ───────────────────────────────────────────────────────

function SplashScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
      <Text style={{ fontSize: 72, marginBottom: 20 }}>🛡️</Text>
      <Text style={{ fontSize: 28, fontWeight: '800', color: C.tx, letterSpacing: 1 }}>Discreet</Text>
      <Text style={{ fontSize: 13, color: C.mt, marginTop: 6 }}>Zero-knowledge encrypted messaging</Text>
      <ActivityIndicator size="small" color={C.ac} style={{ marginTop: 32 }} />
    </View>
  );
}

// ── Root component ──────────────────────────────────────────────────────

export default function App() {
  const [splash, setSplash]  = useState(true);
  const [ready, setReady]    = useState(false);
  const [authed, setAuthed]  = useState(false);

  useEffect(() => {
    // Show splash for at least 1 second, then resolve auth
    const splashTimer = setTimeout(() => setSplash(false), 1000);
    api.init().then(() => {
      setAuthed(!!api.token);
      setReady(true);
    });
    return () => clearTimeout(splashTimer);
  }, []);

  if (splash || !ready) {
    return <SplashScreen />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={authed ? 'Main' : 'Auth'}
        >
          <Stack.Screen name="Auth">
            {props => <AuthScreen {...props} onAuth={() => setAuthed(true)} />}
          </Stack.Screen>
          <Stack.Screen name="Main">
            {props => <MainScreen {...props} onLogout={() => setAuthed(false)} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
