# Roadmap

Last updated: March 12, 2026

## Done

**Core platform:**
- 44 Rust backend modules, 184+ API routes, 33+ database migrations
- 29+ React components, 18,500+ lines of TypeScript
- E2EE messaging (MLS RFC 9420 + PBKDF2-AES-256-GCM fallback)
- Voice and video (WebRTC + SFrame E2EE, RFC 9605)
- Servers, channels, categories, roles, invites, bans
- Direct messages and group DMs
- File sharing (encrypted blob upload/download)
- Polls, reactions, pinned messages, typing indicators
- Calendar, events, RSVP
- Encrypted document editor
- Guest meeting join (browser-only, no signup)

**AI agents (patent-pending):**
- 14 specialist agent personas
- Multi-provider LLM integration (Anthropic, OpenAI, Ollama, MCP, Custom)
- Server-side encrypted API key storage (AES-256-GCM)
- Encrypted episodic memory (agents learn and remember, zero-knowledge)
- Auto-response on @mention and keyword triggers
- Mandatory disclosure banners

**Security:**
- Argon2id password hashing with 2FA TOTP
- JWT + HttpOnly refresh cookies, session revocation
- OWASP security headers (CSP, HSTS, X-Frame-Options)
- CSRF double-submit cookie protection
- Rate limiting (registration, login, API)
- Platform-level permission tiers (Admin, Dev, Premium, Verified, Unverified, Guest)
- Server-level RBAC (22 permission bitflags)
- Developer API tokens (SHA-256 hashed, revocable)
- Account deletion (GDPR cascade)

**Clients:**
- Vite + React web client (served at root)
- Tauri desktop (Windows, configured for macOS/Linux)
- React Native mobile (Android, 12 files, 5,000+ lines)
- Internationalization framework (12 languages, RTL support)

**SFrame voice E2EE (S1-S7 complete):**
- Rust SFrame crate with WASM bindings
- Browser insertable streams + Web Worker
- Key rotation with 2-second overlap window
- Mobile pre-encryption via react-native-quick-crypto

## In progress

**Deployment:**
- Oracle Cloud VM provisioned (ARM A1, 6GB RAM, Ubuntu 22.04)
- Caddy reverse proxy for automatic HTTPS
- Cloudflare DNS (discreetai.net)
- Resend SMTP for email verification

**Pre-launch polish:**
- Admin dashboard with telemetry and user management
- Platform-level account banning (IP + account)
- Branding cleanup (internal Citadel references → Discreet)
- Documentation consolidation

## Next (post-launch)

**Proximity mesh communication (the game changer):**
- P1: BLE service discovery (react-native-ble-plx)
- P2: Pseudonymous ID + X25519 key exchange
- P3: Encrypted BLE messaging with 512-byte chunking
- P4: Radar screen UI (RSSI-based distance rings)
- P5: Proximity chat UI
- P6: Multi-hop relay (onion-routing-lite, max 3 hops)
- P7: Wi-Fi Direct voice (WebRTC + SFrame, no internet)
- P8: Online sync bridge (re-encrypt under MLS before upload)

**Platform growth:**
- Stripe integration for Pro tier
- GitHub Sponsors and community funding
- Plugin/extension SDK for community developers
- Channel owner analytics
- iOS App Store submission
- Google Play Store submission

**Protocol advancement:**
- Full MLS key exchange replacing PBKDF2 fallback
- Post-quantum key exchange (ML-KEM + ML-DSA)
- Federation between self-hosted instances
- Encrypted database backups
- Centralized log aggregation and alerting

## Non-goals

Things we're intentionally not building:
- Game streaming (not a gaming platform)
- Social media features (no stories, no feeds)
- Advertising infrastructure (never)
- Backdoors or lawful intercept capabilities (never)
