# CLAUDE.md — Project Instructions for Discreet

> This file is read by Claude Code at the start of every session.
> Every rule here exists because we learned the hard way.
> Do not skip, shortcut, or "temporarily" bypass anything below.

## What This Project Is

Discreet is an open-source, end-to-end encrypted messaging platform.
It combines Discord-quality community UX with Signal-grade cryptography.
It is patent-protected and licensed under AGPL-3.0.

**This is a security product.** Code quality is life-or-death for credibility.
Security researchers, cryptographers, and hackers WILL audit every line.
One sloppy shortcut can destroy years of work.

Stack: Rust/Axum backend, PostgreSQL, Redis, React 18/Vite 5 frontend,
React Native mobile, Tauri desktop, WASM MLS crypto module.

GitHub: CitadelOpenSource/Discreet (public)
Domain: discreetai.net
Local dev: C:\dev\Discreet2

---

## ABSOLUTE RULES — NEVER VIOLATE THESE

### 1. Never silence compiler errors
No `.unwrap_or_default()`, `.unwrap_or("")`, `.ok()`, or `let _ =` to
make errors disappear. If the type is wrong, fix the schema or query.
Every suppressed error is a potential vulnerability. Find the ROOT CAUSE.

### 2. Never use .unwrap() in handler code
Use `?` with proper error types. `.unwrap()` is only acceptable in tests
and `main.rs` startup code where panic is the correct behavior.
In handlers, `.unwrap()` = server crash = denial of service vulnerability.

### 3. Never bypass sqlx compile-time checking
All database queries use `sqlx::query!` or `sqlx::query_as!` macros.
Never use raw string queries. Never use `sqlx::query_unchecked!`.
Compile-time SQL validation is our primary defense against injection.

### 4. Never store secrets in code
No API keys, passwords, tokens, or credentials in source files.
All secrets come from environment variables or encrypted DB columns.
If you see a secret in code, STOP and flag it immediately.

### 5. Never modify the legacy client
`client/` is the legacy monolith. It is SOURCE OF TRUTH for crypto
parameters only. Never modify it. Never add features to it.
All new work goes in `client-next/` (Vite React app).

### 6. Never commit with warnings
`cargo clippy -- -D warnings` must pass before every commit.
`npm run build` must complete with zero errors.
Warnings are not suggestions — they are defects.

### 7. Never run commands on Windows
MSYS2 fork exhaustion bug crashes Claude Code bash on Windows.
**End EVERY response with code changes only. Never run commands.**
The human runs all builds, tests, and git operations from PowerShell.

### 8. Never band-aid a type mismatch
If a function returns `Option<T>` and you need `T`, don't use
`.unwrap_or_default()`. Ask WHY it's Option. Fix the upstream query
or schema. The band-aid hides a logic error that WILL surface in production.

### 9. Never add dependencies without justification
Every new crate or npm package expands attack surface.
Before adding a dependency: Is there a stdlib/existing solution?
Is the crate maintained? Does its license permit AGPL-3.0?
Does `cargo audit` flag it? State the justification in the commit message.

### 10. Never trust user input
ALL user input must be validated before use. Max lengths, allowed
characters, format checks. This applies to: usernames, server names,
channel names, message content, display names, emails, file uploads,
WebSocket messages, query parameters, path parameters, JSON bodies.

---

## CODE QUALITY STANDARDS

### Rust Backend
- All handlers return `Result<impl IntoResponse, AppError>`
- All DB queries use sqlx macros (compile-time validated)
- All new endpoints have input validation (length, format, characters)
- All rate-limited operations use Redis with fail-closed behavior
- Errors logged with `tracing::{error,warn,info,debug}`
- No `println!` or `eprintln!` — use tracing exclusively
- Public functions have doc comments explaining purpose
- Match arms are exhaustive — no `_ =>` catch-all unless justified

### React Frontend (client-next/)
- TypeScript strict mode — no `any` types unless interfacing with JS libs
- Components are functional with hooks (no class components)
- API calls use try/catch with user-visible error handling
- Loading states for every async operation (skeleton screens preferred)
- Empty states for every list that could be empty
- All interactive elements have aria-labels
- No `console.log` in committed code — use only for debugging locally
- Imports sorted: React, third-party, local components, local utils, types

### CSS/Styling
- Use existing CSS variables and theme system
- No inline styles except for truly dynamic values
- No `!important` — fix specificity instead
- Dark theme is default — test all changes in dark mode first

### Commit Messages
Format: `type: description`
Types: feat, fix, security, docs, deps, quality, chore, branding
Examples:
- `feat: notification inbox with unread count`
- `fix: timezone rendering in event reminders`
- `security: input validation on all auth endpoints`
- `quality: events and notifications verification`

---

## SECURITY REQUIREMENTS

### Every New Endpoint Must Have:
1. Authentication check (JWT validation via middleware)
2. Authorization check (user has permission for this resource)
3. Input validation (length, format, allowed characters)
4. Rate limiting (Redis-backed, fail-closed — 503 if Redis down)
5. Audit logging for sensitive operations

### Encryption Rules:
- All timestamps stored as UTC in PostgreSQL (TIMESTAMPTZ)
- AES-256-GCM for symmetric encryption (API keys, TOTP secrets)
- Argon2id for password hashing (memory=19456, iterations=2, parallelism=1)
- MLS RFC 9420 for group messaging (OpenMLS crate)
- X25519 for key exchange fallback
- Crypto parameters: `citadel:{channelId}:{epoch}`, salt `mls-group-secret`
- NEVER roll custom crypto — use audited libraries only

### Headers (set on every response):
- Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin
- Content-Security-Policy: (must include challenges.cloudflare.com)

### What Fail-Closed Means:
If Redis is down → reject the request (503), don't skip rate limiting.
If auth cache misses → query DB, don't allow unauthenticated access.
If file validation fails → reject upload, don't serve unvalidated file.
If encryption fails → drop the message, don't send plaintext.
NEVER degrade to a less-secure mode silently.

---

## FILE CONVENTIONS

### Naming:
- All NEW Rust files: `discreet_*.rs` (e.g., `discreet_input_validation.rs`)
- Existing `citadel_*.rs` files: do NOT rename yet (BRAND2 renames all at once)
- React components: PascalCase (e.g., `NotificationInbox.tsx`)
- Migrations: `NNN_description.sql` (e.g., `056_bookmarks.sql`)
- All migrations use `IF NOT EXISTS` / `IF NOT EXISTS` for idempotency

### File Structure:
```
src/                    # Rust backend (44 modules)
client-next/src/        # React/Vite frontend (active development)
client/                 # Legacy client (NEVER MODIFY — reference only)
mobile/                 # React Native app
desktop/                # Tauri desktop shell
discreet-crypto/        # WASM MLS module
migrations/             # PostgreSQL migrations (001-055+)
scripts/                # setup.sh, setup.ps1, generate-secrets.sh
docs/                   # Public documentation
docs/internal/          # Private docs (gitignored)
```

### What Goes Where:
- New backend module → `src/discreet_*.rs` + register in `src/lib.rs`
- New React page → `client-next/src/pages/`
- New React component → `client-next/src/components/`
- New migration → `migrations/NNN_*.sql` (next number in sequence)
- New documentation → `docs/` (public) or `docs/internal/` (private)

---

## TESTING REQUIREMENTS

### Before Every Commit:
```
cargo sqlx prepare          # Regenerate query cache
cargo check                 # Compile check
cargo test --lib            # Run unit tests (must be 68+ passing)
cargo clippy -- -D warnings # Zero warnings
cd client-next && npm run build && cd ..  # Frontend builds clean
```

### What to Test:
- Every crypto function: encrypt/decrypt roundtrip, wrong key rejection
- Every input validator: valid input passes, invalid input rejected
- Every new module: at minimum 3 unit tests covering happy path,
  error path, and edge case
- Rate limiters: verify they fail-closed when Redis unavailable

### What NOT to Test in Claude Code:
- Integration tests requiring live database (run manually on Oracle VM)
- WebSocket tests (require running server)
- Frontend component tests (run manually with npm test)

---

## THINGS THAT WILL GET US SCRUTINIZED

These are the exact things security researchers and OSS reviewers check:

1. **Dependency vulnerabilities** — `cargo audit` must show ZERO.
   Known exceptions go in `.cargo/audit.toml` with written justification.

2. **Outdated crypto** — We MUST upgrade OpenMLS 0.5→0.8 before launch.
   Versions 0.5 have curve25519-dalek and ed25519-dalek CVEs.

3. **Error messages that leak info** — Login must return same error for
   "user not found" and "wrong password". Never reveal which failed.

4. **SQL injection** — Impossible with sqlx macros, but reviewers check.
   Never use string interpolation in queries. Ever.

5. **XSS in messages** — All user content must be escaped before rendering.
   React does this by default, but verify any `dangerouslySetInnerHTML`.

6. **CORS misconfiguration** — Never `*` in production. Explicit origins only.

7. **JWT in query params** — WebSocket auth passes JWT in query string.
   This is a known HIGH finding. Document the mitigation (short-lived tokens,
   TLS only, no server-side logging of query params).

8. **Rate limiting everything** — Registration, login, message send,
   file upload, API calls. If it's not rate-limited, it's a DoS vector.

9. **SBOM and license compliance** — Every dependency must be AGPL-compatible.
   GPL, MIT, Apache 2.0, BSD are fine. SSPL, Commons Clause are NOT.

10. **Reproducible builds** — Goal for post-launch. Document the build
    environment so anyone can verify the binary matches the source.

---

## BRANDING RULES

- Product name in UI: "Discreet" (never "Citadel" in user-facing text)
- New files: `discreet_` prefix
- Existing files: keep `citadel_` until BRAND2 renames all at once
- GitHub org: CitadelOpenSource (stays)
- Copyright: "Copyright (C) 2026 Citadel Open Source LLC"
- Patent references: "Patent Pending" only — no claim details in code

---

## COMMON MISTAKES TO AVOID

These have happened in past sessions. Don't repeat them:

1. **Adding .unwrap_or() to fix a type error** — This hides bugs.
   Fix the actual type mismatch upstream.

2. **Creating a new component without wiring it to real data** —
   Every UI component must fetch from or post to a real API endpoint.
   No hardcoded mock data in production code.

3. **Forgetting to register new modules in lib.rs** —
   Every new `src/discreet_*.rs` file needs `pub mod discreet_*;` in lib.rs.

4. **Migration without IF NOT EXISTS** — Migrations must be idempotent.
   Use CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

5. **Leaving TODO/FIXME in committed code** — Either fix it now or
   create a tracked issue. No "temporary" shortcuts.

6. **Not checking the migration number** — Always verify the next
   available migration number. Conflicts break deployment.
   Current: check `migrations/` for the highest number.

7. **Importing from legacy client** — `client/` is dead code for reference.
   Never import from it. Never link to it. Never add to it.

8. **Console.log left in production** — Remove all console.log before commit.
   Use proper error boundaries and user-facing error messages instead.

9. **Missing error handling on fetch calls** — Every API call needs
   try/catch with appropriate user feedback on failure.

10. **Hardcoding URLs** — API base URL comes from environment/config.
    Never hardcode localhost, IP addresses, or domain names in components.

---

## PRIVACY-FIRST DEFAULTS

Discreet is a privacy product. Our defaults must reflect that:

- Read receipts: OFF by default
- Typing indicators: OFF by default
- Link previews: OFF by default (if enabled, client-side generation only)
- Online status: visible to friends only by default
- External calendar data: NEVER sent to Discreet server
- Telemetry/analytics: NONE. Zero tracking. Zero data collection.
- GIF search: removed (was Google Tenor — tracks users)

---

## WHEN IN DOUBT

1. Check how Signal handles it — they've been audited repeatedly
2. Check OWASP Top 10 2025 — does this introduce a new vulnerability?
3. Ask: "Would a security researcher flag this?" If maybe, fix it.
4. Ask: "Does this degrade security silently?" If yes, fail loudly instead.
5. Ask: "Can I verify this works without running the server?" If not,
   write a unit test that validates the logic independently.

---

## REMEMBER

Every line of code will be read by people who want to find flaws.
Cryptographers. Penetration testers. Competitors. Government auditors.
Open source contributors who will judge the entire project by one file.

Write code that makes them say "these people know what they're doing."

Not "good enough." Not "we'll fix it later." Not "nobody will notice."

The standard is: would you trust this code with YOUR private messages?

If the answer isn't an immediate yes, keep working.
