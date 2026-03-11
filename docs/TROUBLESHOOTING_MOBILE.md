# Troubleshooting — Mobile App (React Native)

## Setup

### Prerequisites
- Node.js 18+
- Android Studio (for Android SDK, emulator)
- Xcode 15+ (iOS, Mac only)
- Java 17 (Android builds)

### First-time setup
```bash
cd mobile
npm install
```

### Android SDK
Set `ANDROID_HOME` environment variable:
- Windows: `C:\Users\<you>\AppData\Local\Android\sdk`
- Mac: `~/Library/Android/sdk`
- Linux: `~/Android/Sdk`

## Common Errors

### "Cannot find module @react-native-firebase"
Firebase requires native linking. After `npm install`:
```bash
# Android: add google-services.json to mobile/android/app/
# iOS: add GoogleService-Info.plist to mobile/ios/
```
Follow: https://rnfirebase.io/

### CSRF token errors
React Native doesn't use browser cookies. The mobile `CitadelAPI.ts` reads the `Set-Cookie` response header and stores the CSRF token in AsyncStorage, then echoes it as `X-CSRF-Token`.

### WebSocket disconnects in background
By design — stays alive 5 minutes after backgrounding, then disconnects to save battery. Reconnects instantly with exponential backoff when the app returns to foreground.

### "Network request failed"
1. Check `SERVER_URL` in `mobile/src/api/CitadelAPI.ts` — must point to your server
2. For local dev: use your PC's LAN IP (e.g., `http://192.168.4.43:3000`), not `localhost`
3. Android emulator uses `10.0.2.2` for host machine's localhost
4. Ensure server is bound to `0.0.0.0` (not `127.0.0.1`)

### Android emulator can't reach server
```bash
adb reverse tcp:3000 tcp:3000
```
This forwards the emulator's port 3000 to your host machine.

### "Unable to load script" (Android)
```bash
npx react-native start --reset-cache
```

### iOS build fails
```bash
cd ios && pod install && cd ..
npx react-native run-ios
```

## Development Workflow

### Android
```bash
# Start Metro bundler
npx react-native start

# In another terminal
npx react-native run-android
```

### iOS (Mac only)
```bash
npx react-native start
npx react-native run-ios
```

### Changing server URL
Edit `mobile/src/api/CitadelAPI.ts`:
```typescript
export const SERVER_URL = 'http://192.168.4.43:3000';  // LAN IP for local dev
// export const SERVER_URL = 'https://discreet.chat';   // Production
```

## Architecture
- Shares TypeScript types and API client with web
- AsyncStorage replaces browser localStorage
- WebSocket with exponential backoff (1s → 2s → 4s → ... → 30s cap)
- Push notifications via Firebase Cloud Messaging (Android) / APNs (iOS)
- 5-minute background WebSocket grace period
- React Navigation stack (Auth → Main)

## Proximity Mode

### BLE not discovering any devices
1. Ensure Bluetooth is ON on both devices
2. Check permissions: BLUETOOTH_SCAN, BLUETOOTH_ADVERTISE, ACCESS_FINE_LOCATION (Android)
3. Both devices must have Proximity Mode enabled in Settings
4. Range: ~10-100m depending on environment (walls reduce range)
5. Emulators don't support BLE — use physical devices

### "BLE advertising failed"
- Some Android devices limit BLE advertising. Check `BleManager.state()` returns "PoweredOn"
- Android 12+: requires BLUETOOTH_ADVERTISE permission at runtime
- iOS: ensure NSBluetoothAlwaysUsageDescription is in Info.plist

### Wi-Fi Direct voice not connecting
1. Both devices need Wi-Fi enabled (but not connected to a network)
2. One device must be group owner ("Start Voice"), others join
3. Android only — iOS uses MultipeerConnectivity instead
4. Check: ACCESS_WIFI_STATE and CHANGE_WIFI_STATE permissions granted
5. Some devices have Wi-Fi Direct disabled by manufacturer

### Messages not syncing after coming back online
1. Check AsyncStorage for `proximity_outbox` — should contain queued messages
2. NetInfo may not detect connectivity change immediately (up to 5s delay)
3. Manual sync: go to Settings → Proximity & Offline → force sync button
4. If messages are stuck, "Clear Offline Message Queue" resets the outbox

### Proximity voice quality is poor
- Wi-Fi Direct bandwidth is ~250 Mbps, so this shouldn't be a bandwidth issue
- Check distance — Wi-Fi Direct range is ~200m, quality degrades beyond 150m
- Reduce number of participants (max 8 recommended)
- Ensure no other Wi-Fi Direct groups are active on the same channel
