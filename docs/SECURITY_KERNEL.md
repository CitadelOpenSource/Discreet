# Discreet Security Kernel

## Overview

Discreet uses a **WebAssembly Security Kernel** — a Rust module compiled to WASM, running in a dedicated Web Worker thread, that mediates all security-critical operations between the network transport layer and the React user interface.

The kernel is not a library that the UI calls for specific tasks. It is a **mandatory intermediary**. Every encrypted payload, every user input, every permission check, and every piece of rendered content flows through the kernel before the UI sees it.

## Architecture

```
   Network (WebSocket/HTTP)
          │
          ▼
   ┌──────────────────────────┐
   │   Web Worker Thread      │
   │   (isolated memory)      │
   │                          │
   │   WASM Security Kernel   │
   │   ├─ AES-256-GCM crypto  │
   │   ├─ Input validation    │
   │   ├─ HTML sanitization   │
   │   ├─ Permission eval     │
   │   ├─ Session management  │
   │   ├─ Oracle protection   │
   │   └─ Sealed storage      │
   └──────────────────────────┘
          │
          │ postMessage (structured clone)
          ▼
   React UI (renders capability objects)
```

## What the kernel handles

**Cryptography.** AES-256-GCM encryption and decryption with HKDF-SHA256 key derivation. All key material held in zeroize-on-drop wrappers. Nonces are 96-bit random, never reused. Derived keys are zeroized immediately after use.

**Input validation.** 12 field validators matching the server exactly — usernames, emails, passwords, display names, messages, server names, channel names, channel topics, custom status, about me, invite codes, and URLs with SSRF protection. Same reserved name list, same leetspeak normalization, same character rules.

**Content sanitization.** HTML tag stripping via ammonia (allowlist: none — messages are plaintext + markdown). Control character rejection (null bytes, BEL, ESC, etc.). Glassworm/Shai-Hulud invisible Unicode detection (variation selectors, zero-width spaces, PUA characters). Markdown parsing into structured spans.

**Permission evaluation.** Capability-based render model. The kernel computes what actions are allowed per message (edit, delete, pin, react, reply, forward, mention everyone) and returns structured capability objects. The UI renders buttons based on these capabilities — it does not compute permissions.

**Session management.** JWT validation, session state tracking (user ID, tier, admin/founder flags). State encrypted with non-extractable WebCrypto keys via sealed storage.

**Oracle protection.** Rate-limited operation monitoring. The kernel tracks decryption (100/10s), outgoing message (50/10s), and validation (200/10s) rates. Anomalous usage patterns (indicating automated exfiltration) trigger kernel lockout requiring re-authentication. Thresholds are 5-7x above normal human usage.

## What the UI handles

- Rendering kernel-produced capability objects
- Navigation and routing
- Theme application and visual styling
- User interactions (clicks, typing, scrolling)
- Network transport (WebSocket connection management)

The UI **cannot** decrypt messages, validate inputs, evaluate permissions, or access key material. It renders what the kernel provides.

## Security properties

**Web Worker thread isolation.** The kernel's WASM linear memory is inaccessible from the main JavaScript thread. Communication happens exclusively via `postMessage` with structured clone serialization. An XSS attacker on the main thread cannot read the kernel's memory, enumerate its keys, or call its internal functions.

**Memory zeroization.** All cryptographic keys, decrypted plaintext, and intermediate key derivation values are overwritten with zeros immediately after use. The `zeroize` and `secrecy` crates enforce this at the type system level — `Secret<Vec<u8>>` requires explicit `.expose_secret()` to access the inner value, and the `ZeroizeOnDrop` derive ensures cleanup even on panics.

**Non-extractable key persistence.** Kernel state is encrypted with a WebCrypto `CryptoKey` generated with `extractable: false`. JavaScript can use this key for encrypt/decrypt operations but cannot export the raw key bytes. The main thread stores the encrypted blob in IndexedDB — it holds ciphertext it cannot decrypt.

**Rate-limited oracle protection.** The kernel monitors operation frequency across three categories (decrypt, sign, validate) using sliding time windows. If usage exceeds thresholds calibrated to 5-7x normal human patterns, the kernel locks itself. All operations return `KERNEL_LOCKED` until the user re-authenticates. This prevents automated bulk exfiltration even if an attacker gains postMessage access.

**Trusted Types enforcement.** DOM injection sinks are locked down via the Trusted Types API. The `discreet-default` policy escapes all HTML and logs a security warning if invoked. Dynamic script creation (`createScript`, `createScriptURL`) throws unconditionally. The CSP header enforces `require-trusted-types-for 'script'`.

**Content Security Policy.** `script-src 'self'` with no `unsafe-eval` and no `unsafe-inline`. `worker-src 'self'` restricts Worker scripts to same origin. `trusted-types discreet-default` limits policy creation. `object-src 'none'` blocks plugins.

**Supply chain defense.** Pre-commit hooks scan all source files for invisible Unicode characters used by the Glassworm and Shai-Hulud malware families (variation selectors, zero-width spaces, PUA characters). The kernel's sanitization pipeline rejects these same characters at runtime, providing defense-in-depth.

## Honest limitations

This is not a hardware enclave. The web platform does not provide that level of isolation within a single origin.

- **Browser extensions** can modify the browser itself and potentially intercept data at the rendering layer. Users who require protection against compromised browsers should use the desktop app (Tauri v2) which provides real OS process isolation.
- **XSS on the main thread** allows an attacker to interact with the kernel through its `postMessage` API, but they cannot extract keys (non-extractable), bypass rate limits (oracle protection), or read kernel memory (Worker isolation). They can request decryptions, but the oracle will lock after 100 operations in 10 seconds.
- **Client-side permission checks** are defense-in-depth. The server remains the authoritative source of truth for access control. The kernel's capability model prevents UI-level bypass but does not replace server enforcement.
- **Side-channel attacks** on WASM (timing, cache) are theoretically possible but impractical through the Worker postMessage boundary. SharedArrayBuffer is not used between the kernel Worker and main thread.

The kernel measurably improves the security posture by reducing the trusted JavaScript surface from 1,400+ modules to approximately 50, centralizing security logic in an auditable Rust crate, and making the same core portable to desktop (real process isolation) and mobile (native FFI).

## Build and verify

```bash
cd discreet-kernel
cargo test                              # 119+ tests
cargo clippy -- -D warnings             # zero warnings
wasm-pack build --target web --release  # produces pkg/
```

## Cross-platform

The same Rust kernel crate compiles to:

- **WebAssembly** for browser (via wasm-pack)
- **Native library** for desktop (via Tauri v2, real OS process isolation)
- **Native library** for mobile (via uniffi FFI bindings)

One audited, tested, fuzzed security core. Three platforms.

## Post-Quantum Cryptography

Discreet uses a hybrid classical + post-quantum cryptographic architecture. Both classical and post-quantum algorithms must be broken to compromise any communication.

| Layer | Classical | Post-Quantum | Standard | Implementation |
|-------|-----------|-------------|----------|----------------|
| Key exchange | X25519 (ECDH) | ML-KEM-768 | NIST FIPS 203 | libcrux-ml-kem (Cryspen) |
| Signatures | Ed25519 | ML-DSA-65 | NIST FIPS 204 | Pending libcrux-ml-dsa |
| Symmetric | AES-256-GCM | — | Quantum-resistant at 128-bit security (Grover) | RustCrypto aes-gcm |
| Key derivation | HKDF-SHA256 | — | Quantum-resistant | RustCrypto hkdf |

### ML-KEM-768 implementation

The ML-KEM-768 implementation is **libcrux-ml-kem** by Cryspen:

- Formally verified for panic freedom, correctness, and secret independence using hax and F*
- FIPS 203 compliant with mandatory key validation before encapsulation
- SIMD-optimized with runtime CPU feature detection (AVX2 on x86-64, Neon on AArch64)
- Same team that verified Signal's PQXDH protocol and discovered the KyberSlash timing vulnerability
- Apache-2.0 licensed (AGPL compatible)

ML-DSA-65 signatures are gated behind a feature flag pending a formally verified implementation (libcrux-ml-dsa) on crates.io. Ed25519 signatures remain active for all credentials.

### How it works

MLS (RFC 9420) handles group key agreement using the classical cipher suite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. At the application layer, ML-KEM-768 encapsulation wraps MLS group secrets at join and rekey operations. All received public keys undergo FIPS 203 validation before use.

This hybrid approach means an attacker must break **both** X25519 and ML-KEM-768 to decrypt messages. A quantum computer capable of running Shor's algorithm breaks only the classical half — the post-quantum half remains secure.

### Why hybrid, not pure PQ

OpenMLS 0.8 does not yet support post-quantum cipher suites natively. The MLS protocol has cipher suite agility (algorithms can be upgraded without protocol changes), but no MLS implementation has shipped PQ suites in a stable release. Our application-layer hybrid approach provides PQ protection today while the ecosystem matures. When OpenMLS adds native PQ cipher suites, we will migrate from hybrid wrapping to native integration.

### Rekey schedule

Post-quantum rekeying occurs every 50 messages or every hour (matching Apple PQ3's cadence). This limits the window of compromise if any single key is exposed, regardless of whether the threat is classical or quantum.
