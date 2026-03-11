# Discreet — Roadmap

*Last updated: March 7, 2026*

## ✅ Phase 1 — Core Features (DONE)
- 44 Rust backend modules, 14,191 lines, 184 API routes
- 29 React components, 18,115 lines
- E2EE (MLS RFC 9420 + PBKDF2-AES-GCM fallback)
- Voice/Video WebRTC + screen share
- AI Agent framework (8+ presets, 26-field config, LLM engine tab)
- Gamification, events, polls, watch parties, meetings
- Forum channels, threaded discussions
- Custom emoji, GIF picker, URL previews
- 80+ user settings across 12 tabs
- Server settings: channels, members, roles, bots, categories

## ✅ Phase 2 — Security Hardening (DONE)
- 17/18 OWASP items (pen testing remaining)
- CSP, HSTS, CSRF, 2FA TOTP, account lockout
- File upload validation, session revocation, invite expiry
- Email verification flow (Resend-ready)
- GDPR data export
- Admin dashboard + server health monitor

## ✅ Phase 3 — Feature Wiring (DONE)
- [x] Calendar suite (monthly grid, events, RSVP, meeting integration)
- [x] Encrypted document editor (rich text, auto-save, sharing)
- [x] Guest meeting join (browser-only, /meet/:code, no signup)
- [x] Tier system (Guest → Verified → Pro, feature gating)
- [x] LLM bot engine (OpenAI/Anthropic/Ollama/Custom)
- [x] Unread bold channels + count badges
- [x] Auto-join default channel on server select
- [x] Typing indicators (debounced, WS broadcast)
- [x] Pinned messages panel (📌 button, side panel)
- [x] Friend request from right-click context menu
- [x] Poll voting with progress bars
- [x] Reaction wiring (add/remove/toggle)
- [x] Group DMs (create, list, send, load)
- [x] Duplicate #general fix (DB unique index)
- [x] Default channel configuration (server owner setting)

## ✅ Phase 4 — Native Apps (DONE)
- [x] Tauri desktop: compiling, running, system tray, close-to-tray
- [x] React Native mobile: 12 files, 5,098 lines, auth + chat + DM + settings + voice
- [ ] Tauri production build (.msi)
- [ ] React Native production build (APK)

## ⬜ Phase 5 — Public Launch
- [ ] File provisional patent ($75) — 18 claims, covers everything
- [ ] Oracle Cloud deployment (free tier)
- [ ] Resend SMTP (email verification)
- [ ] Custom domain + SSL (discreet.chat)
- [ ] Clean GitHub repo (new repo, one push, no internal docs)
- [ ] Reddit / HN / Product Hunt launch
- [ ] Landing page

## 🔨 Phase 6 — Proximity Mesh Communication (IN PROGRESS — THE GAME CHANGER)
- [ ] BLE proximity discovery (find nearby Discreet users)
- [ ] Encrypted BLE text messaging (no internet needed)
- [ ] Wi-Fi Direct voice channels ("cold spot" — phone as server)
- [ ] Raspberry Pi relay nodes ($50 solar-powered mesh extenders)
- [ ] Hybrid online/offline auto-fallback
- [ ] Offline message queue + sync on reconnect
- [ ] Desktop BLE via Web Bluetooth API
- [ ] Stealth mode (listen only, don't broadcast)

## ⬜ Phase 7 — Post-Launch Features
- [ ] Breakout rooms in voice
- [ ] Meeting notes (auto-generated)
- [ ] Live captions (Web Speech API)
- [ ] Background blur / virtual backgrounds
- [ ] Noise cancellation (Web Audio API)
- [ ] Encrypted spreadsheet editor
- [ ] Course builder (modules, quizzes)
- [ ] Stripe payments integration
- [ ] Onboarding automations
- [ ] Hand raise in voice
- [ ] Privacy Health Score dashboard

## ⬜ Phase 8 — Revenue
- [ ] Citadel Pro ($5/mo cosmetics, unlimited servers)
- [ ] Citadel Teams ($12/user/mo SSO, compliance)
- [ ] Citadel Enterprise (custom pricing, SLA)
- [ ] Managed hosting service
- [ ] Plugin marketplace
- [ ] Proximity mesh licensing (emergency services, military, humanitarian)

## Stats
- **40,270 code lines** across 104+ source files
- **325 commits** in 12 days
- **18 patent claims** drafted (AI agents, encrypted streaming, proximity mesh)
- **$0 spent**
