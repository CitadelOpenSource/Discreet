
// ═══════════════════════════════════════════════════════════════
// CRYPTO ENGINE — AES-256-GCM, ECDSA identity, MLS placeholder
// ═══════════════════════════════════════════════════════════════
class CryptoEngine {
  constructor() { this.keys = new Map(); this.fingerprint = ""; }
  async init() {
    const id = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const raw = await crypto.subtle.exportKey("raw", id.publicKey);
    this.fingerprint = Array.from(new Uint8Array(raw).slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(":");
    return this.fingerprint;
  }
  async deriveKey(ch, ep = 0) {
    const e = new TextEncoder();
    const m = await crypto.subtle.importKey("raw", e.encode(`citadel:${ch}:${ep}`), { name: "PBKDF2" }, false, ["deriveKey"]);
    const k = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: e.encode("mls-group-secret"), iterations: 100000, hash: "SHA-256" }, m, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    this.keys.set(`${ch}:${ep}`, k); return k;
  }
  async encrypt(pt, ch, ep = 0) {
    let k = this.keys.get(`${ch}:${ep}`) || await this.deriveKey(ch, ep);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, k, new TextEncoder().encode(pt));
    const buf = new Uint8Array(12 + ct.byteLength); buf.set(iv); buf.set(new Uint8Array(ct), 12);
    return btoa(String.fromCharCode(...buf));
  }
  async decrypt(b64, ch, ep = 0) {
    try { let k = this.keys.get(`${ch}:${ep}`) || await this.deriveKey(ch, ep);
    const d = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: d.slice(0, 12), tagLength: 128 }, k, d.slice(12)));
    } catch { return "[decryption failed]"; }
  }
}

// ═══════════════════════════════════════════════════════════════
// SVG ICONS — Comprehensive set for all UI elements
// ═══════════════════════════════════════════════════════════════
const sv = (w, h, d, sw = "2") => (p) => <svg width={p?.s || w} height={p?.s || h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

const I = {
  Hash:   sv(16, 16, <><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>),
  Lock:   sv(12, 12, <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>, "2.5"),
  Send:   sv(18, 18, <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>),
  Plus:   sv(14, 14, <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>, "2.5"),
  Shield: sv(14, 14, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>),
  Users:  sv(16, 16, <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>),
  Log:    sv(14, 14, <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>),
  Gear:   sv(14, 14, <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>),
  Edit:   sv(14, 14, <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>),
  Trash:  sv(14, 14, <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>),
  Clip:   sv(16, 16, <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>),
  Smile:  sv(16, 16, <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></>),
  X:      sv(14, 14, <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>),
  ChevD:  sv(12, 12, <polyline points="6 9 12 15 18 9"/>),
  Crown:  sv(14, 14, <><path d="M2 20h20"/><path d="M4 20l2-14 4 6 2-8 2 8 4-6 2 14"/></>),
  Out:    sv(14, 14, <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>),
  Copy:   sv(14, 14, <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>),
  Ban:    sv(14, 14, <><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></>),
  Tag:    sv(14, 14, <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  Clip2:  sv(14, 14, <><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></>),
  Bell:   sv(14, 14, <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>),
  Pin:    sv(14, 14, <><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1V4H8v2h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z"/></>),
  Search: sv(14, 14, <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>),
  Heart:  sv(14, 14, <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>),
  AtSign: sv(14, 14, <><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/></>),
  Image:  sv(14, 14, <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>),
  DL:     sv(14, 14, <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>),
  Msg:    sv(14, 14, <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></>),
  Key:    sv(14, 14, <><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></>),
};

// ═══════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════
const T = { bg: "#07090f", sf: "#0b0d15", sf2: "#0f1119", bd: "#181c2a", tx: "#dde0ea", mt: "#5a6080", ac: "#00d4aa", ac2: "#009e7e", err: "#ff4757", warn: "#ffa502", info: "#3742fa" };

// ═══════════════════════════════════════════════════════════════
// EMOJI DATA
// ═══════════════════════════════════════════════════════════════
const EMOJIS = {
  "Quick": ["👍","👎","😂","❤️","🔥","👀","🎉","🤔","😮","💯","✅","❌","⚠️","🙏","💪","🚀","👏","😍","🥺","😭"],
  "Smileys": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊","😇","🥰","😍","🤩","😘","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","😴","😷","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","😕","😟","😮","😲","😳","🥺","😨","😰","😥","😢","😭","😱","😤","😡","😈","💀","💩","🤡","👻","👽","🤖"],
  "Hands": ["👋","🤚","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","🤝","🙏","💪"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
  "Objects": ["🔥","⭐","✨","💫","🎉","🎊","🏆","🥇","🎯","🚀","💡","📌","🔗","📝","💻","📱","🔒","🔓","🛡️","⚡","💎","🔑"],
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const fmtT = d => d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
const fmtD = d => d ? new Date(d).toLocaleString() : "";
const fmtDate = d => { if (!d) return ""; const dt = new Date(d); const now = new Date(); if (dt.toDateString() === now.toDateString()) return "Today"; const y = new Date(now); y.setDate(y.getDate()-1); if (dt.toDateString() === y.toDateString()) return "Yesterday"; return dt.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: dt.getFullYear() !== now.getFullYear() ? "numeric" : undefined }); };
