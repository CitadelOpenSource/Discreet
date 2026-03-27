# Roadmap

Last updated: March 2026

## Shipped (v1.0.0-alpha)

**Platform:**
- Rust/Axum backend: 50+ modules, 184+ API routes, 105 database migrations, 106 unit tests
- React/TypeScript frontend: 1,392 modules, 6 themes, 3 layout modes, 16 languages
- End-to-end encrypted messaging via MLS (RFC 9420) with AES-256-GCM
- End-to-end encrypted voice and video via SFrame (RFC 9605)
- Servers, channels, categories, roles with 22 permission bitflags
- Direct messages, group DMs, message threads
- File sharing with automatic EXIF stripping for privacy
- Polls, reactions, pinned messages (3 categories), typing indicators, read receipts
- Calendar, events, RSVP, encrypted document editor
- Guest meeting join (browser-only, no account required)
- Disappearing messages with configurable TTL per channel
- Scheduled messages with cancel-before-delivery
- Message search with operators (from:, has:link, has:file, is:pinned)
- Voice messages, custom emoji, soundboard, stickers
- Automod with bad word filter, invite detection, URL shortener blocking, zero-width character bypass detection
- Webhooks for external integrations
- Import system for migrating from other platforms
- Link previews with SSRF protection and Redis caching

**Accounts and authentication:**
- Email signup, anonymous signup with BIP-39 12-word seed phrase, OAuth (Google, GitHub, Discord, Apple)
- No phone number required — ever
- Argon2id password hashing, FIDO2/WebAuthn passkeys, TOTP 2FA
- JWT with HttpOnly refresh cookies, session revocation
- 7 account tiers: anonymous, unverified, verified, pro, team, admin, founder
- Tester tier with read-only admin dashboard access
- Username validation: 2-30 chars, case-insensitive uniqueness, reserved name blocking, slur filter with leetspeak normalization
- Display name changes limited to 3 per month (unlimited for admin/tester)
- Account suspension (prevents login and deletion)
- Account burn button with typed confirmation

**AI agents (patent pending):**
- Multi-provider LLM integration (Anthropic, OpenAI, Ollama, MCP, custom endpoints)
- Encrypted API key storage (AES-256-GCM with per-agent derived keys)
- Encrypted episodic memory (agents learn per-channel, zero-knowledge)
- Auto-response on @mention and keyword triggers
- 3-level disable: per-user, per-server, platform-wide kill switch
- AI sandbox with defense-in-depth isolation
- Mandatory AI disclosure banners

**Security:**
- OWASP security headers (CSP, HSTS, X-Frame-Options, Permissions-Policy, CORP, COOP)
- CSRF double-submit cookie protection
- Redis-backed sliding window rate limiting on every endpoint
- Rate limit multipliers by role (admin 100x, owner 3x, mod 2x, anonymous 0.5x)
- Input validation on all fields with SSRF protection (blocks private IPs, cloud metadata endpoints)
- Control character rejection, WebSocket origin validation
- Cloudflare Turnstile CAPTCHA for anonymous registration
- Platform audit logging for all admin actions
- Zero vulnerabilities: cargo audit clean, npm audit clean, cargo clippy zero warnings

**Admin dashboard:**
- Platform overview with live counters (online users, signups, messages)
- User search with filters (tier, status, date range, verification)
- User detail view with full activity history, all login IPs, registration IP
- Admin actions: ban, suspend, unsuspend, force password reset, disable disappearing messages, restrict channel creation, flag as high risk
- Audit log viewer with filters
- Banned/suspended/high-risk user panels with search presets
- AI kill switch, anonymous registration toggle, maintenance mode
- Tester promotion panel

**Internationalization:**
- 16 languages: English, Spanish, French, German, Japanese, Korean, Chinese, Arabic, Farsi, Ukrainian, Russian, Portuguese, Hebrew, Kurdish, Burmese, Pashto
- RTL support for Arabic, Farsi, Hebrew, Kurdish, Pashto
- BIP-39 seed phrase UI localized (mnemonic words remain English per standard)

**Themes and UX:**
- 7 themes: Midnight (default), Daylight, OLED Black, Terminal, Phosphor (CRT scanlines), Arcade (pixel font), Vapor (vaporwave pastels)
- 3 layout modes: Simple, Standard, Power
- 150+ user/server/channel settings with auto-save
- Per-channel notification overrides (mute with duration, keyword alerts)
- Nighttime mode, blue light filter, high contrast mode
- PiP video window, FaceTime-style call UI
- Mobile-responsive with bottom tab bar, swipe-to-reply, native camera access

**Self-hosting:**
- AGPL-3.0 license
- Three-command setup via scripts/setup.sh
- Docker Compose for PostgreSQL + Redis
- Caddyfile for automatic HTTPS
- Systemd service file included
- Complete .env.example with every variable documented

**Security Kernel (complete, March 2026):**
- WebAssembly Security Kernel: Rust crate compiled to WASM, running in isolated Web Worker
- AES-256-GCM encryption/decryption with HKDF-SHA256 key derivation, zeroize-on-drop
- 12 field validators mirroring server-side rules exactly (usernames, emails, URLs with SSRF protection)
- Content sanitization pipeline: HTML stripping (ammonia), Glassworm/Shai-Hulud invisible Unicode defense, control character rejection
- Capability-based render model: per-message permission evaluation, structured formatting spans
- Rate-limited oracle protection: sliding window counters (100 decrypt/10s, 50 sign/10s, 200 validate/10s)
- Non-extractable WebCrypto sealed storage for kernel state persistence
- Trusted Types enforcement with CSP `require-trusted-types-for 'script'`
- SRI hash computation for Worker and WASM artifacts
- Glassworm pre-commit hook for supply chain attack defense
- 119+ tests (unit + integration), 3 fuzz targets
- React wiring: kernel-first encrypt/decrypt with legacy fallback, KernelContent renderer, kernel validation cross-checks
- Kernel health check API for Settings UI

## In Progress

- Production deployment to Oracle Cloud ARM VM
- Cloudflare DNS and SSL configuration
- Resend email verification flow
- TURN server (coturn) for NAT traversal
- Post-quantum cryptography (ML-KEM-768 + ML-DSA-65) behind feature flag
- Theme engine with 80 CSS variables and structural skins

## Next

**Mobile apps:**
- React Native for iOS and Android
- Push notifications via FCM + APNs
- Biometric unlock, offline message queue
- Camera and gallery integration

**BLE proximity mesh:**
- Device-to-device encrypted messaging over Bluetooth — invisible to IMSI catchers
- X25519 key exchange with 4-emoji SAS verification
- Multi-hop relay (3 hops, 5-minute TTL)
- Wi-Fi Direct voice calls with zero internet
- Radar screen UI with RSSI-based distance rings

**Desktop apps:**
- Tauri v2 wrapper for Windows, macOS, Linux
- Single-instance mode, native notifications

**Platform growth:**
- BTCPay Server for Bitcoin/Lightning payments
- Stripe for card payments, NOWPayments for altcoins
- Pro tier ($5/month) with 100MB uploads, enhanced AI, custom themes
- Team tier with SAML SSO, LDAP sync, BAA for healthcare
- Stalwart self-hosted mail server (replacing Resend)
- Plugin/extension SDK
- Security audit (targeting NLnet/Cure53 funded audit)

**Protocol advancement:**
- Federation between self-hosted instances
- Matrix bridge
- Encrypted database backups

## Non-goals

- Advertising infrastructure (never)
- Backdoors or lawful intercept of message content (never — we cannot read your messages)
- Social media features (no stories, no feeds, no algorithmic timelines)
- Telemetry or analytics collection (zero tracking, zero data collection)
