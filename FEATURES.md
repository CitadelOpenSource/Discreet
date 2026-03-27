# Discreet — Complete Feature List

> Communication Without Compromise.

Every feature in Discreet, organized by category. This is a living document updated with each release.

---

## End-to-End Encryption

| Feature | Standard | Status |
|---------|----------|--------|
| Message encryption | AES-256-GCM via MLS (RFC 9420) | ✅ Shipped |
| Voice encryption | SFrame (RFC 9605) via Insertable Streams | ✅ Shipped |
| Video encryption | SFrame on all media tracks | ✅ Shipped |
| Screen share encryption | SFrame on display capture tracks | ✅ Shipped |
| Key rotation | Per-epoch via MLS group key agreement | ✅ Shipped |
| Forward secrecy | New keys per epoch, old keys deleted | ✅ Shipped |
| Key derivation | HKDF-SHA256 with per-channel salts | ✅ Shipped |
| Post-quantum KEM | ML-KEM-768 (FIPS 203) | ✅ Behind `pq` flag |
| Post-quantum signatures | ML-DSA-65 (FIPS 204) | ✅ Behind `pq` flag |
| Agent key encryption | AES-256-GCM with per-agent derived keys | ✅ Shipped |
| OAuth token encryption | AES-256-GCM, HKDF salt "discreet-oauth-v1" | ✅ Shipped |
| LDAP credential encryption | AES-256-GCM, HKDF salt "discreet-ldap-v1" | ✅ Shipped |
| Client-side search | Zero-knowledge — server never sees search queries | ✅ Shipped |
| Friends-only encryption | Decrypt only messages from your friends | ✅ Shipped |

### What the server can never see

- Message content (only ciphertext)
- Voice/video audio (only encrypted frames)
- Search queries (client-side only)
- AI conversation content (encrypted same as messages)
- File contents (encrypted before upload)

---

## Messaging

| Feature | Details | Status |
|---------|---------|--------|
| Real-time messaging | WebSocket delivery, instant display | ✅ Shipped |
| Message replies | Thread-style reply with quote preview | ✅ Shipped |
| Reactions | Emoji reactions on any message | ✅ Shipped |
| Message editing | Edit your own messages after sending | ✅ Shipped |
| Message deletion | Delete your own messages | ✅ Shipped |
| Disappearing messages | Configurable TTL per channel | ✅ Shipped |
| Message pinning | Pin with categories: Important, Action Required, Reference | ✅ Shipped |
| Pin limit | 50 pins per channel | ✅ Shipped |
| Scheduled messages | Set future send time, cancel before delivery | ✅ Shipped |
| File attachments | Upload and share files | ✅ Shipped |
| Voice messages | Record and send audio clips | ✅ Shipped |
| Message threads | Threaded replies within channels | ✅ Shipped |
| Typing indicators | See when others are typing | ✅ Shipped |
| Read receipts | Message acknowledgment tracking | ✅ Shipped |
| Mentions | @username, @everyone, @role mentions | ✅ Shipped |
| Custom emoji | Server-specific emoji | ✅ Shipped |
| Sticker packs | Translated sticker support | ✅ Shipped |
| Message bookmarks | Save messages for later | ✅ Shipped |
| Message search | Client-side encrypted search with operators | ✅ Shipped |
| Search operators | `from:user`, `has:link`, `has:file`, `is:pinned` | ✅ Shipped |

---

## Voice & Video

| Feature | Details | Status |
|---------|---------|--------|
| Voice channels | Persistent rooms, join/leave freely | ✅ Shipped |
| 1:1 voice calls | DM ring with caller notification | ✅ Shipped |
| Group voice calls | Up to 25 participants | ✅ Shipped |
| Video calls | Camera toggle, participant grid layout | ✅ Shipped |
| Add people to calls | Escalate 1:1 to group seamlessly | ✅ Shipped |
| Screen sharing | One share per channel, SFrame encrypted | ✅ Shipped |
| Picture-in-Picture | Draggable PiP window for video calls | ✅ Shipped |
| Noise suppression | Web Audio noise gate, runs before encryption | ✅ Shipped |
| Voice Activity Detection | Sensitivity slider (-60dB to -30dB) | ✅ Shipped |
| Push-to-talk | Configurable key, 200ms release delay | ✅ Shipped |
| Input level meter | Real-time green/yellow/red meter | ✅ Shipped |
| Active call mini-bar | Persistent bar with mute/deafen/hangup | ✅ Shipped |
| Leave confirmation | "Leave Voice?" / "End Call?" popup | ✅ Shipped |
| Meeting rooms | Join via code, no account required for guests | ✅ Shipped |
| Active speaker | Green border highlight on current speaker | ✅ Shipped |
| Presenter mode | Screen share fills view, cameras as thumbnails | ✅ Shipped |

### Voice architecture

All call types use one WebRTC engine with SFrame E2EE:

```
Voice channel → persistent room
Voice call    → 1:1 DM with ring
Group call    → voice call + invite
Video         → any above + camera tracks
Screen share  → any above + display capture
Meeting       → voice channel + join code
```

The server relays encrypted frames — it cannot decrypt audio or video.

---

## Servers & Channels

| Feature | Details | Status |
|---------|---------|--------|
| Server creation | Unlimited servers per user | ✅ Shipped |
| Text channels | Standard messaging channels | ✅ Shipped |
| Voice channels | Persistent voice rooms | ✅ Shipped |
| Forum channels | Threaded discussion boards | ✅ Shipped |
| Channel categories | Organize channels into collapsible groups | ✅ Shipped |
| Channel archiving | Read-only archived state, collapsible section | ✅ Shipped |
| Server discovery | Public server listing | ✅ Shipped |
| Invite links | Shareable with configurable expiry | ✅ Shipped |
| Server transfer | 4-step confirmation: select → warn → type name → password | ✅ Shipped |
| Server deletion | Safety flow: offer transfer, type name, enter password | ✅ Shipped |
| Soundboard | Server sound effects | ✅ Shipped |
| Custom roles | 32 permissions across 7 categories | ✅ Shipped |
| Permission levels | Allow / Deny / Inherit tri-state per role | ✅ Shipped |
| Automod | Bad words, caps, links, invites, zero-width bypass detection | ✅ Shipped |
| Audit log | Server action history | ✅ Shipped |
| Webhooks | HMAC-SHA256 signed, 3x retry with backoff | ✅ Shipped |

### Role permission categories

- **General**: View channels, send messages, read history, attach files, change nickname, mention everyone
- **Membership**: Create invites, kick, ban, manage nicknames
- **Channels**: Manage channels, archive, manage pins
- **Voice**: Connect, speak, mute members, move members, priority speaker
- **Moderation**: Manage messages, manage automod, view audit log
- **Administration**: Manage server, roles, invites, webhooks, scheduled messages, bots, AI agents
- **Dangerous**: Administrator, delete server, transfer ownership

---

## User Accounts & Tiers

| Tier | Requirements | Badge | Features |
|------|-------------|-------|----------|
| User | Email + password | — | All core features |
| Verified | Email confirmed | ✓ Checkmark | Verification badge (toggleable, always visible to friends) |
| Pro | Verified + paid | ★ Star | Enhanced AI, 100MB uploads, custom themes, priority voice |
| Team | Pro + org billing | 🏢 Building | SAML SSO, LDAP, shared billing, BAA eligible |
| Admin | Platform-level | 🛡 Shield | Full admin dashboard, platform management |

### Authentication methods

- Email + password (Argon2id hashed)
- TOTP 2FA (time-based one-time passwords)
- FIDO2/WebAuthn passkeys (hardware security keys, biometrics)
- OAuth 2.0 PKCE (Google, GitHub, Apple, Discord)
- SAML SSO (enterprise identity providers)
- LDAP/Active Directory sync

### What we never require

- Phone number
- Real name
- Credit card (crypto payments available)
- Government ID

---

## AI Integration

| Feature | Details | Status |
|---------|---------|--------|
| Multi-provider support | Anthropic, OpenAI, Ollama, custom endpoints, MCP | ✅ Shipped |
| Encrypted AI chat | AI conversations encrypted same as messages | ✅ Shipped |
| User-owned API keys | Encrypted at rest, write-only from UI | ✅ Shipped |
| Per-channel isolation | AI scoped per channel via MLS keys | ✅ Shipped |
| Input sanitization | Prompt injection deny-list filtering | ✅ Shipped |
| Output sanitization | Allowlist-based content filtering | ✅ Shipped |
| Memory integrity | SHA-256 verified sliding window context | ✅ Shipped |
| AI rate limiting | 10/min per channel, 50/hr per user | ✅ Shipped |
| Disable per-user | Hide all AI, zero UI presence | ✅ Shipped |
| Disable per-server | Owner blocks AI on their server (403) | ✅ Shipped |
| Platform kill switch | Admin disables all AI platform-wide | ✅ Shipped |
| Episodic memory | Encrypted facts extracted from conversations | ✅ Shipped |
| Auto-spawn agents | Keyword-triggered AI responses | ✅ Shipped |
| Bot SDK | REST API + WebSocket documentation with Python example | ✅ Shipped |

### AI security model

```
User message → Input sanitization → AI Provider API → Output sanitization → AES-256-GCM encryption → Channel delivery
```

- Server proxies all AI calls (client never contacts AI providers directly)
- AI responses pass through two sanitization layers before encryption
- Per-channel MLS keys prevent cross-channel access
- Memory integrity checked via SHA-256 hashes
- Users who disable AI see zero AI-related UI elements

---

## Privacy & Safety

| Feature | Details | Status |
|---------|---------|--------|
| Friends-only mode | Only decrypt messages from friends in public channels | ✅ Shipped |
| Per-channel exceptions | Right-click to exempt channels from friends-only | ✅ Shipped |
| Privacy toggles | Granular control over what others see | ✅ Shipped |
| Do Not Disturb | Scheduled DND with exceptions | ✅ Shipped |
| Block users | Hide messages, prevent DMs | ✅ Shipped |
| Report users | Abuse reporting with admin queue | ✅ Shipped |
| CSAM zero-tolerance | Permanent ban, metadata preserved, NCMEC reporting | ✅ Shipped |
| Warrant canary | Quarterly updated, public at /canary | ✅ Shipped |
| Nighttime mode | Scheduled dark theme, blue light filter, notification control | ✅ Shipped |

---

## Customization

| Feature | Details | Status |
|---------|---------|--------|
| Theme engine | Dark, light, OLED, custom accent colors | ✅ Shipped |
| Message density | Compact (IRC), Cozy (default), Spacious (Slack) | ✅ Shipped |
| Chat bubbles | Toggle on/off, standard or aligned layout | ✅ Shipped |
| Font size | 12-24px slider with live preview | ✅ Shipped |
| Custom hotkeys | 11 default bindings, fully rebindable | ✅ Shipped |
| Layout modes | Basic (iMessage feel), Medium, Advanced (power UI) | ✅ Shipped |
| Nighttime mode | Scheduled dark + blue light + notification muting | ✅ Shipped |
| High contrast | WCAG AA compliant, 3px focus outlines | ✅ Shipped |
| Reduce motion | Respects OS preference, manual override | ✅ Shipped |
| Advanced settings | Collapsible sections to reduce overwhelm | ✅ Shipped |

---

## Message Import

| Source | Format | Status |
|--------|--------|--------|
| Signal | ZIP export (signal_backup.json) | ✅ Shipped |
| WhatsApp | ZIP export (.txt chat files) | ✅ Shipped |
| iMessage | chat.db SQLite file | ✅ Shipped |
| Android SMS | XML export (SMS Backup & Restore) | ✅ Shipped |

Imported messages are marked with `is_imported=true` and preserve original timestamps. Each conversation becomes a group DM channel with a platform prefix (e.g., `[Signal] John Doe`).

---

## Internationalization

16 languages covering every major active conflict zone:

| Language | Code | Direction | Conflict zone coverage |
|----------|------|-----------|----------------------|
| English | en | LTR | — |
| Spanish | es | LTR | — |
| French | fr | LTR | — |
| German | de | LTR | — |
| Japanese | ja | LTR | — |
| Korean | ko | LTR | — |
| Chinese | zh | LTR | — |
| Arabic | ar | RTL | Syria, Yemen, Qatar, Gulf states |
| Farsi | fa | RTL | Iran |
| Ukrainian | uk | LTR | Ukraine |
| Russian | ru | LTR | — |
| Portuguese | pt | LTR | — |
| Hebrew | he | RTL | Israel |
| Kurdish (Sorani) | ku | RTL | Kurdistan, Iraq |
| Burmese | my | LTR | Myanmar |
| Pashto | ps | RTL | Afghanistan |

Language is auto-detected from browser settings and selectable during onboarding. RTL languages automatically set `dir="rtl"` on the document.

---

## Administration

| Feature | Details | Status |
|---------|---------|--------|
| Admin dashboard | Stats, user management, system health | ✅ Shipped |
| Abuse queue | Dismiss, warn, ban (with IP + metadata), NCMEC escalate | ✅ Shipped |
| Bug reports | User-submitted with severity and optional screenshot | ✅ Shipped |
| Health endpoint | `/health/detailed` with db, redis, connection stats | ✅ Shipped |
| Prometheus metrics | `/metrics` with request, connection, latency counters | ✅ Shipped |
| Platform settings | Global configuration from admin dashboard | ✅ Shipped |
| Platform bans | IP-based with audit trail | ✅ Shipped |
| AI kill switch | Disable all AI platform-wide instantly | ✅ Shipped |
| Waitlist | Pre-launch signup with referral tracking | ✅ Shipped |

---

## Enterprise

| Feature | Details | Status |
|---------|---------|--------|
| SAML SSO | Identity provider integration | ✅ Shipped |
| LDAP sync | Active Directory user synchronization | ✅ Shipped |
| BAA template | HIPAA business associate agreement | ✅ Shipped |
| Audit logs | Server and platform-level action tracking | ✅ Shipped |
| Team billing | Organization-level subscription management | 🔜 Post-launch |
| Self-hosting | Full deployment guide, Docker support | ✅ Shipped |

---

## Security Kernel

| Feature | Details | Status |
|---------|---------|--------|
| WebAssembly Security Kernel | Rust/WASM module in isolated Web Worker thread | ✅ Shipped |
| AES-256-GCM encryption | HKDF-SHA256 key derivation, zeroize-on-drop keys | ✅ Shipped |
| Rate-limited oracle protection | Locks kernel on anomalous usage patterns | ✅ Shipped |
| Non-extractable WebCrypto persistence | Sealed storage with `extractable: false` keys | ✅ Shipped |
| Capability-based render model | Per-message permission evaluation | ✅ Shipped |
| Trusted Types enforcement | DOM XSS sinks locked via Trusted Types API | ✅ Shipped |
| Glassworm/Shai-Hulud defense | Invisible Unicode rejection + pre-commit scanning | ✅ Shipped |
| 119+ security-focused tests | Unit, integration, and fuzz targets | ✅ Shipped |

The kernel mediates all security-critical operations. The JavaScript UI layer never touches cryptographic keys, unsanitized content, or raw permission data. See [docs/SECURITY_KERNEL.md](docs/SECURITY_KERNEL.md) for the full architecture.

---

## Infrastructure & Security

| Feature | Details | Status |
|---------|---------|--------|
| Rust backend | Axum framework, compiled, memory-safe | ✅ Shipped |
| PostgreSQL | Encrypted data at rest, WAL journaling | ✅ Shipped |
| Redis | Session management, rate limiting, caching | ✅ Shipped |
| Cloudflare | CDN, WAF, DDoS protection, HSTS preload | ✅ Shipped |
| Caddy | Automatic HTTPS via Let's Encrypt | ✅ Shipped |
| Rate limiting | Per-endpoint Redis sliding window | ✅ Shipped |
| CSRF protection | Token-based with cookie extraction | ✅ Shipped |
| Security headers | CSP, HSTS, X-Frame-Options, CORP, COEP | ✅ Shipped |
| Input validation | All endpoints validated, SSRF protection | ✅ Shipped |
| Fail2ban | SSH brute force protection | ✅ Shipped |
| cargo audit | Zero known vulnerabilities | ✅ Shipped |
| npm audit | Zero vulnerabilities (esbuild override) | ✅ Shipped |

---

## Payments (post-launch)

| Method | Provider | Privacy level |
|--------|----------|--------------|
| Bitcoin + Lightning | BTCPay Server (self-hosted) | Maximum — no KYC |
| Altcoins (ZEC, ETH, USDC, XMR) | NOWPayments | High — optional KYC |
| Credit/debit card | Stripe | Standard — Stripe handles PCI |

Email-only signup + crypto payments = genuinely anonymous premium access. Discreet never stores payment information.

---

## Mobile (planned, post-launch)

| Feature | Details | Status |
|---------|---------|--------|
| React Native app | iOS + Android | 🔜 In Development |
| BLE proximity mesh | Device-to-device, zero internet | 🔜 Post-Launch |
| X25519 key exchange | 4-emoji SAS verification | 🔜 Post-Launch |
| Multi-hop relay | 3 hops, 5min TTL, encrypted relay | 🔜 Post-Launch |
| Wi-Fi Direct voice | Zero-internet voice calls | 🔜 Post-Launch |
| Push notifications | FCM + APNs | 🔜 In Development |
| Biometric unlock | Face ID, fingerprint | 🔜 In Development |
| Offline queue | Local SQLite message buffer | 🔜 In Development |
| Raspberry Pi relays | $15 permanent mesh relay nodes | 🔜 Post-mobile |

### BLE mesh vs cellular interception

The proximity mesh uses Bluetooth Low Energy — not cellular. IMSI catchers and Stingrays intercept cellular signals. They cannot see BLE traffic. Messages are encrypted with AES-256-GCM and relayed device-to-device. No server, no DNS, no IP address, no SIM card.

---

## Desktop (pre-launch)

| Feature | Details | Status |
|---------|---------|--------|
| Tauri wrapper | Lightweight native app from web client | 🔜 Pre-Launch |
| Windows installer | .msi with SHA-256 hash | 🔜 Pre-launch |
| VirusTotal scan | Published report for every binary | 🔜 Pre-launch |

---

## Open Source

- **License**: AGPL-3.0-or-later
- **Repository**: [github.com/CitadelOpenSource/Discreet](https://github.com/CitadelOpenSource/Discreet)
- **Self-hosting**: Complete guide at [SELF_HOSTING.md](docs/SELF_HOSTING.md)
- **Contributing**: Guidelines at [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security**: Responsible disclosure at [SECURITY.md](SECURITY.md)
- **Bot SDK**: Developer documentation at [docs/BOT_SDK.md](docs/BOT_SDK.md)
- **Patent**: Nonprovisional USPTO filed — AI agents as MLS members, BLE mesh architecture

---

## Legal & Compliance

- **Terms of Service**: [/terms](/terms)
- **Privacy Policy**: [/privacy](/privacy)
- **Warrant Canary**: [/canary](/canary) — updated quarterly
- **CSAM Policy**: Zero tolerance. NCMEC reporting per 18 U.S.C. § 2258A
- **COPPA**: 13+ age requirement
- **GDPR**: Data export, deletion, right to be forgotten
- **HIPAA**: BAA template available for healthcare organizations

---

*Last updated: March 2026 — Discreet v1.0.0-alpha*
