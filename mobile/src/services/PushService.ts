/**
 * PushService — Firebase Cloud Messaging + Notifee local notifications.
 *
 * DEPENDENCIES (add to mobile/package.json and run `npm install`):
 *   @react-native-firebase/app       "^20.0.0"
 *   @react-native-firebase/messaging "^20.0.0"
 *   @notifee/react-native            "^9.0.0"
 *
 * ANDROID SETUP:
 *   1. Place google-services.json in android/app/
 *   2. In android/build.gradle add:
 *        classpath 'com.google.gms:google-services:4.4.2'
 *   3. In android/app/build.gradle add at bottom:
 *        apply plugin: 'com.google.gms.google-services'
 *
 * IOS SETUP:
 *   1. Place GoogleService-Info.plist in ios/<AppName>/
 *   2. Enable Push Notifications + Background Modes (Remote notifications) in Xcode
 *   3. cd ios && pod install
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERVER-SIDE TODO (Rust/Axum — citadel_user_handlers.rs):
 *
 *   POST /api/v1/users/@me/push-token
 *   Body: { token: string, platform: "android" | "ios" }
 *   Auth: JWT Bearer
 *
 *   1. Store the FCM token in a `push_tokens` table:
 *        CREATE TABLE push_tokens (
 *          user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *          token     TEXT NOT NULL,
 *          platform  TEXT NOT NULL DEFAULT 'android',
 *          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *          PRIMARY KEY (user_id, platform)
 *        );
 *
 *   2. When a message is created for a channel, find offline members and
 *      send FCM push via Google's FCM HTTP v1 API:
 *        POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
 *        Body: {
 *          message: {
 *            token: "<device_fcm_token>",
 *            notification: { title: "#{channel} — {server}", body: "{author}: {preview}" },
 *            data: { server_id, channel_id, message_id }
 *          }
 *        }
 *      Use a service account key (GOOGLE_APPLICATION_CREDENTIALS env var) or
 *      the `fcm_token` crate for Rust.
 *
 *   DELETE /api/v1/users/@me/push-token
 *   Removes the token on logout so the device stops receiving pushes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { api } from '../api/CitadelAPI';

// ── Channel IDs (Android notification channels) ───────────────────────────

const CHANNEL_MESSAGES = 'discreet_messages';
const CHANNEL_MENTIONS = 'discreet_mentions';

// ── Navigation ref (set from App.tsx) ─────────────────────────────────────

type NavRef = {
  navigate: (screen: string, params?: Record<string, string>) => void;
} | null;

let _navRef: NavRef = null;

/** Call this from App.tsx once NavigationContainer is ready. */
export function setNavRef(ref: NavRef) {
  _navRef = ref;
}

// ── Deep-link helper ──────────────────────────────────────────────────────

function navigateToMessage(data?: Record<string, string>) {
  if (!_navRef || !data?.server_id) return;
  // Navigate to Main then let it select the server/channel.
  // The actual sub-navigation (server + channel selection) can be extended
  // by adding a pendingNavigation state to MainScreen and reading it on mount.
  _navRef.navigate('Main', {
    serverId:  data.server_id,
    channelId: data.channel_id,
  });
}

// ── Android notification channels ─────────────────────────────────────────

async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id:         CHANNEL_MESSAGES,
    name:       'Messages',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound:      'default',
    vibration:  true,
  });
  await notifee.createChannel({
    id:         CHANNEL_MENTIONS,
    name:       'Mentions & DMs',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound:      'default',
    vibration:  true,
    lights:     true,
    lightColor: '#00d2aa',
  });
}

// ── Display a local notification via Notifee ──────────────────────────────

async function showLocalNotification(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
) {
  const { notification, data } = remoteMessage;
  const title = notification?.title ?? 'Discreet';
  const body  = notification?.body  ?? '';
  if (!body) return;

  const isMention =
    data?.is_mention === 'true' || data?.is_dm === 'true';

  await notifee.displayNotification({
    title,
    body,
    data: data as Record<string, string>,
    android: {
      channelId:   isMention ? CHANNEL_MENTIONS : CHANNEL_MESSAGES,
      importance:  AndroidImportance.HIGH,
      smallIcon:   'ic_notification',   // must exist in android/app/src/main/res/drawable/
      color:       '#00d2aa',
      pressAction: { id: 'default' },
      // Group messages from the same channel into a thread
      groupId:     data?.channel_id,
    },
    ios: {
      sound:        'default',
      badgeCount:   1,
      foregroundPresentationOptions: {
        alert: true,
        badge: true,
        sound: true,
      },
    },
  });
}

// ── Register FCM token with the backend ───────────────────────────────────

async function registerToken(token: string) {
  try {
    await api.fetch('/users/@me/push-token', {
      method: 'POST',
      body: JSON.stringify({
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });
    console.log('[push] FCM token registered with server');
  } catch (err) {
    console.warn('[push] Failed to register FCM token:', err);
  }
}

async function unregisterToken() {
  try {
    await api.fetch('/users/@me/push-token', { method: 'DELETE' });
  } catch {}
}

// ── Permission request ────────────────────────────────────────────────────

async function requestPermission(): Promise<boolean> {
  // Notifee handles the iOS permission dialog; Android 13+ also needs it.
  const settings = await notifee.requestPermission();
  const granted  =
    settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
    settings.authorizationStatus === AuthorizationStatus.PROVISIONAL;

  if (!granted) {
    console.log('[push] Notification permission denied');
  }
  return granted;
}

// ── Background message handler (registered at module level) ───────────────
//
// Must be called before any other code — React Native fires this even when
// the app is killed.  Register it at the top of mobile/index.js:
//
//   import { backgroundMessageHandler } from './src/services/PushService';
//   messaging().setBackgroundMessageHandler(backgroundMessageHandler);

export async function backgroundMessageHandler(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage,
) {
  console.log('[push] background message', remoteMessage.messageId);
  await ensureAndroidChannels();
  await showLocalNotification(remoteMessage);
}

// ── Notifee foreground event handler (tap / dismiss) ─────────────────────

function registerNotifeeEventHandler() {
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      navigateToMessage(detail.notification?.data as Record<string, string>);
    }
  });
}

// ── Initial notification (app opened via tap while killed) ────────────────

async function handleInitialNotification() {
  // FCM initial notification
  const initial = await messaging().getInitialNotification();
  if (initial?.data) {
    // Small delay to let navigation mount
    setTimeout(() => navigateToMessage(initial.data as Record<string, string>), 500);
  }

  // Notifee initial event
  const notifeeInitial = await notifee.getInitialNotification();
  if (notifeeInitial?.notification?.data) {
    setTimeout(
      () => navigateToMessage(notifeeInitial.notification.data as Record<string, string>),
      500,
    );
  }
}

// ── Main initialisation ───────────────────────────────────────────────────

export async function initPushService(): Promise<() => void> {
  await ensureAndroidChannels();

  const permitted = await requestPermission();
  if (!permitted) return () => {};

  // Get / refresh FCM token and register with the backend
  const token = await messaging().getToken();
  console.log('[push] FCM token:', token.slice(0, 20) + '…');
  await registerToken(token);

  // If the token rotates, re-register
  const unsubTokenRefresh = messaging().onTokenRefresh(async newToken => {
    console.log('[push] FCM token refreshed');
    await registerToken(newToken);
  });

  // Foreground FCM messages — FCM alone won't show a heads-up notification
  // when the app is in the foreground; Notifee does it instead.
  const unsubForeground = messaging().onMessage(async remoteMessage => {
    console.log('[push] foreground message', remoteMessage.messageId);
    await showLocalNotification(remoteMessage);
  });

  // Notification tap while app is in the background (not killed)
  const unsubBackgroundTap = messaging().onNotificationOpenedApp(remoteMessage => {
    navigateToMessage(remoteMessage.data as Record<string, string>);
  });

  // Notifee foreground event handler (tap on Notifee-displayed notifications)
  registerNotifeeEventHandler();

  // Handle initial notification (app launched by tapping a notification)
  await handleInitialNotification();

  // Return cleanup function for when the user logs out
  return async () => {
    unsubTokenRefresh();
    unsubForeground();
    unsubBackgroundTap();
    await unregisterToken();
  };
}
