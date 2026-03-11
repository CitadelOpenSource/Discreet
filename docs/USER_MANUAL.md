# CITADEL USER MANUAL
## v0.23.1-alpha — Complete Guide

> **For setup/deployment instructions, see [`LAUNCH_NOW.md`](../LAUNCH_NOW.md)**

---

## GETTING STARTED

### Creating an Account

Citadel offers three account tiers:

**Guest (Zero Friction)** — Click "Join as Guest" on the login screen. No username, password, or email required. You get full access to voice, text, and AI bots. Guest accounts auto-expire after 30 days of inactivity.

**Registered (Privacy-First)** — Create a username and password. No email required. Full features forever, including creating and owning servers.

**Verified (Full Features)** — Add and confirm your email address. Unlocks password recovery, email notifications, and Citadel Pro eligibility.

To upgrade: Settings → Profile → add credentials, or Settings → Security → verify email.

### Navigating the Interface

- **Left rail** — Server icons. Click to switch servers. "+" to create/join.
- **Sidebar** — Channels, DMs, Friends, Explore.
- **Chat area** — Messages, voice connected bar, input toolbar.
- **Right panel** — Member list with roles and online status.

---

## SETTINGS (12 Tabs)

### Appearance
- **Theme**: Dark, Onyx (OLED Black), Light, Midnight
- **Accent Color**: 8 color swatches
- **Font**: DM Sans, Inter, System UI, JetBrains Mono, Georgia
- **Font Size**: Small (13px), Medium (15px), Large (18px), Extra Large (20px)
- **Message Spacing**: Cozy, Compact, Roomy
- **Chat Width**: Narrow, Normal, Wide, Full Width
- **Toggles**: Compact mode, link embeds, avatars, timestamps, join/leave messages, animated emoji, typing indicators, sticker previews, smooth scrolling

### Voice & Audio
- **Input Mode**: Voice Activity (auto-detect) or Push to Talk (hold key)
- **Voice Sensitivity**: Slider for VAD threshold
- **Devices**: Input, Output, Camera (detected from system)
- **Input/Output Volume**: 0-200% sliders
- **Audio Processing Chain** (OBS-grade):
  - Noise Gate: threshold, hold time, attack, release, range (5 params)
  - Compressor: threshold, ratio, attack, release, gain (5 params)
  - Expander: threshold, ratio, attack, release (4 params)
  - Noise Suppression, Echo Cancellation, Auto Gain Control
  - Voice Normalization, Audio Ducking
- **5-Band Equalizer**: 60Hz, 250Hz, 1kHz, 4kHz, 16kHz (-12 to +12 dB each)
- **EQ Presets**: Flat, Rock, Hip-Hop, Pop, Country, EDM, Jazz, Classical, Bass Boost, Vocal/Podcast

### Video
- Camera resolution (480p-1080p) and FPS (15-60)
- In-chat playback: default volume, playback speed (0.5x-2x)
- Toggles: autoplay, loop short videos, picture-in-picture, hardware acceleration

### Streaming (OBS-Style)
- **Output**: Resolution (480p-1440p), FPS (15-60)
- **Encoder**: Auto, H.264/NVENC, VP8, VP9, AV1
- **Rate Control**: CBR, VBR, CQP
- **Video Bitrate**: 500-12,000 kbps slider
- **Audio Bitrate**: 64-320 kbps
- **Advanced**: Keyframe interval, profile (baseline/main/high), downscale filter (bilinear/bicubic/lanczos), color format (NV12/I420/I444)
- **Toggles**: Stream preview, system audio capture, show cursor, low latency

### My Profile
- Display name, username, avatar upload (2MB max)
- Bio (190 chars), custom status

### Privacy
- DM privacy: Everyone / Friends only / Nobody
- Friend request privacy: Everyone / Friends of friends / Nobody
- Toggles: Hide online status from non-friends, hide activity, block stranger DMs, require mutual friends for requests

### Security
- Two-Factor Authentication (TOTP) setup
- Change Password
- Active Sessions
- Encryption Key Fingerprint
- **Account Deletion**: Double confirmation + password verification. Irreversible.

### Notifications
- Level: All messages / Mentions only / Nothing
- Auto-idle timeout: 1min to 1hr or Never
- Toggles: Auto-show images, GIFs, auto-play videos

### Accessibility
- Reduce Motion, High Contrast, Screen Reader, Large Click Targets, Focus Indicators, Dyslexia-Friendly Font
- UI Zoom (80-150%), Color Saturation (0-200%)

### Keybinds (10 rebindable)
Push to Talk, Toggle Mute, Toggle Deafen, Search, Emoji Picker, GIF Picker, Edit Last Message, Reply to Last, Mark as Read, Settings

### Advanced
- WebSocket reconnect interval, message cache size, image quality
- Developer Mode, Raw Ciphertext, Performance Overlay, Verbose Logs, Experimental Features
- Developer Tools (when Dev Mode ON): API tester, WS monitor, quick endpoints, live info
- Danger Zone: Reset all settings, Export settings

---

## VOICE & VIDEO

### Joining Voice
Click any voice channel in the sidebar. Allow microphone access when prompted. The Voice Connected bar appears at the bottom of the sidebar with controls: Mic, Deafen, Camera, Screen Share, SFX (Soundboard).

### Per-User Volume
When in a voice channel with others, individual volume sliders (0-200%) appear below the voice level meter. Adjust each person independently.

### Screen Sharing
Click "Share" in the voice bar. Select a screen or window. All participants see your screen in the video grid.

### Soundboard
Click "SFX" in the voice bar. Click any sound clip to play it for everyone in the channel. Server owners can upload clips (up to 50 per server, 500KB each) via Server Settings.

### Watch Together
Type `/watch <youtube-url>` in chat while in a voice channel. An embedded YouTube player appears for everyone. Type `/stopwatch` to end.

---

## AI BOTS (Patent-Pending)

### Spawning a Bot
From the Home screen, click any bot card (14 specialists available). A private encrypted channel is created instantly. All conversations are E2EE — the server cannot read them.

### Available Personas
General (🤖), Code Wizard (💻), Game Master (🎮), Music Bot (🎵), Companion (💬), Story Weaver (📝), Meme Lord (😂), Researcher (🔬), Art Director (🎨), Fitness Coach (💪), Legal Advisor (⚖️), Finance Guide (💰), Security Analyst (🔒), Health Guide (🏥)

### NSFW Bots
Available only to verified accounts with USE_NSFW_AI permission granted by server owner.

---

## SERVER MANAGEMENT

### Creating a Server
Click "+" → Create Server. Choose a template (Custom, Gaming, Community, Study, Creator, Work). Templates auto-create channels and a themed AI bot.

### Channel Types
- **Text**: Standard messaging with E2EE
- **Voice**: Real-time audio/video with WebRTC
- **Forum**: Threaded discussions with titles, tags, pin/lock

### Roles & Permissions (18 bitflags)
Server owners create roles with granular permissions. Each permission individually controls what users see in menus:
- KICK_MEMBERS: sees Kick option
- BAN_MEMBERS: sees Ban option
- MANAGE_ROLES: sees role assignment
- MANAGE_CHANNELS: can create/edit/delete channels
- MANAGE_SERVER: can edit server settings
- SPAWN_AI: can create AI bot channels (ON by default)
- ADMINISTRATOR: bypasses all checks

### Events
Server Settings → Events. Create events with title, description, datetime, location. Members RSVP: Going / Interested / Not Going.

### Custom Emoji
Server Settings → Emoji. Upload up to 50 per server. Use in chat with `:emoji_name:` syntax.

### Server Discovery
Server Settings → Overview → "List in Public Discovery" toggle. Published servers appear in the Explore tab.

---

## ENCRYPTION

### How It Works
All messages are encrypted in your browser using AES-256-GCM before being sent. The server stores only ciphertext. Encryption keys are derived from channel IDs via PBKDF2 (100,000 iterations).

### What the Server Cannot See
- Message content (text, files, voice messages)
- AI bot conversations
- File contents (encrypted before upload)
- Search queries (client-side only)

### What the Server Can See
- Metadata: who sent a message, when, to which channel
- File sizes (not content)
- Online/offline status
- Server membership

---

## KEYBOARD SHORTCUTS

| Action | Default Key |
|--------|------------|
| Push to Talk | ` (backtick) |
| Toggle Mute | M |
| Toggle Deafen | D |
| Search | / |
| Emoji Picker | E |
| GIF Picker | G |
| Edit Last Message | ↑ |
| Reply to Last | R |
| Mark as Read | Escape |
| Settings | , |

All shortcuts rebindable in Settings → Keybinds.

---

## SLASH COMMANDS

| Command | Description |
|---------|-------------|
| /ban username | Ban a user |
| /kick username | Kick a user |
| /role username rolename | Assign role |
| /audit | Open audit log |
| /settings | Server settings |
| /invite | Create invite |
| /pin | Pin last message |
| /emoji | Open emoji picker |
| /watch url | Start Watch Together |
| /stopwatch | End Watch Together |

---

*Citadel — Privacy is not a feature. It's a right.*

---

## IMAGE LIGHTBOX

Click any image in chat to open it fullscreen. Controls:
- Click background or ✕ to close
- "Open Original" opens in new tab
- "Download" saves to your device

## NOTIFICATION SOUNDS

5 built-in sounds (Web Audio API, no files needed):
- **Message**: Rising chirp on new messages
- **Mention**: Triple tone on @mentions
- **Join**: Ascending tone on voice join
- **Leave**: Descending tone on voice leave
- **Call**: Ring tone on incoming calls

Configure in Settings → Notifications: Mute toggle, volume slider, test buttons.

## EMOJI

11 categories with 820+ emojis including:
- **Flags**: 140+ country flags rendered via Twemoji (displays correctly on all platforms including Windows)

Flag emojis use Twitter's Twemoji library for consistent cross-platform rendering.

---

## BOT CONFIGURATION (Owners/Admins)

Right-click any bot in the member list → "Configure Bot" to open the configuration panel.

### 5 Configuration Tabs:

**General** — Bot name, description, persona selection (14 specialists), enable/disable toggle.

**Behavior** — Response mode: Auto (responds to all), Mention Only (@bot to trigger), Silent (slash commands only). In DMs, bots ALWAYS auto-respond. Greeting message, response prefix, persistent/temporary toggle.

**Personality** — System prompt defining the bot's knowledge, tone, and behavior. Voice style selector (12 options). Temperature slider: 0.0 (precise) to 1.0 (creative).

**Limits** — Max response length (256-4000 tokens). Rate limit (5-60 per minute or unlimited). Blocked topics list.

**Advanced** — Bot identity info, danger zone with remove button.

---

## Proximity Mode (Coming Soon)

### What Is Proximity Mode?
Proximity Mode lets you discover and message nearby Discreet users without internet. Your phone uses Bluetooth and Wi-Fi to communicate directly with other phones running Discreet.

### When Would I Use It?
- Internet is down (natural disaster, power outage)
- At a crowded event with no cell service
- In a remote area without connectivity
- When you want maximum privacy (no server involved at all)

### How to Enable
1. Open Settings → Proximity & Offline
2. Toggle "Proximity Mode" ON
3. A green 📡 badge appears in your status bar
4. The "Nearby" tab shows discovered users

### Messaging
Tap a discovered user to start an encrypted text conversation. Messages are encrypted with AES-256-GCM — the same encryption used in normal mode. Nobody else can read them.

### Voice Calls
Tap "Start Voice Channel" to create a local voice channel. Your phone becomes a mini-server. Up to 8 people can join. Voice is encrypted with DTLS-SRTP.

### What Happens When Internet Returns?
Messages you sent while offline are automatically uploaded to the server. Messages sent to you while you were offline are downloaded. Everything merges seamlessly — you don't need to do anything.

### Stealth Mode
If you want to see who's nearby WITHOUT revealing your own presence, enable "Stealth Mode" in Proximity settings. Your phone will scan for other users but won't broadcast its own beacon.

### Range
- Bluetooth text: ~100 meters (30m indoors, 100m outdoors)
- Wi-Fi Direct voice: ~200 meters
- With Raspberry Pi relay nodes: range extends by ~100m per relay
