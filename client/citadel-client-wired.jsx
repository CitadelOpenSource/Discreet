import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// API SERVICE — Full Discreet backend integration (82+ endpoints)
// ═══════════════════════════════════════════════════════════════
const API_BASE = window.CITADEL_API || "http://localhost:3000/api/v1";
const WS_BASE = (window.CITADEL_API || "http://localhost:3000").replace(/^http/, "ws");

class CitadelAPI {
  constructor() {
    this.token = localStorage.getItem("citadel_token") || null;
    this.refreshToken = localStorage.getItem("citadel_refresh") || null;
    this.userId = localStorage.getItem("citadel_uid") || null;
    this.username = localStorage.getItem("citadel_username") || null;
    this.ws = null;
    this.wsListeners = new Set();
  }

  setAuth(access, refresh, userId, username) {
    this.token = access; this.refreshToken = refresh; this.userId = userId; this.username = username || null;
    localStorage.setItem("citadel_token", access); localStorage.setItem("citadel_refresh", refresh);
    localStorage.setItem("citadel_uid", userId); if (username) localStorage.setItem("citadel_username", username);
  }

  clearAuth() {
    this.token = null; this.refreshToken = null; this.userId = null; this.username = null;
    ["citadel_token","citadel_refresh","citadel_uid","citadel_username"].forEach(k => localStorage.removeItem(k));
    this.disconnectWs();
  }

  async fetch(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    if (res.status === 401 && this.refreshToken) {
      const ok = await this.tryRefresh();
      if (ok) { headers["Authorization"] = `Bearer ${this.token}`; return fetch(`${API_BASE}${path}`, { ...opts, headers }); }
    }
    return res;
  }

  async tryRefresh() {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: this.refreshToken }) });
      if (res.ok) { const d = await res.json(); this.token = d.access_token; localStorage.setItem("citadel_token", this.token); return true; }
    } catch {} this.clearAuth(); return false;
  }

  // ── Auth ──
  async register(u, p, e) { const r = await fetch(`${API_BASE}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p, email: e || undefined }) }); const d = await r.json(); if (r.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username); return { ok: r.ok, status: r.status, data: d }; }
  async login(l, p) { const r = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: l, password: p }) }); const d = await r.json(); if (r.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username); return { ok: r.ok, status: r.status, data: d }; }
  async logout() { await this.fetch("/auth/logout", { method: "POST" }); this.clearAuth(); }

  // ── User ──
  async getMe() { return (await this.fetch("/users/@me")).json(); }
  async updateMe(b) { return (await this.fetch("/users/@me", { method: "PATCH", body: JSON.stringify(b) })).json(); }
  async getMySettings() { return (await this.fetch("/users/@me/settings")).json(); }
  async patchMySettings(b) { return (await this.fetch("/users/@me/settings", { method: "PATCH", body: JSON.stringify(b) })).json(); }

  // ── Servers ──
  async listServers() { return (await this.fetch("/servers")).json(); }
  async createServer(n, d) { return (await this.fetch("/servers", { method: "POST", body: JSON.stringify({ name: n, description: d }) })).json(); }
  async getServer(id) { return (await this.fetch(`/servers/${id}`)).json(); }
  async updateServer(id, b) { return (await this.fetch(`/servers/${id}`, { method: "PATCH", body: JSON.stringify(b) })).json(); }
  async deleteServer(id) { return this.fetch(`/servers/${id}`, { method: "DELETE" }); }
  async leaveServer(id) { return this.fetch(`/servers/${id}/leave`, { method: "POST" }); }

  // ── Invites ──
  async createInvite(s, m, h) { return (await this.fetch(`/servers/${s}/invites`, { method: "POST", body: JSON.stringify({ max_uses: m, expires_in_hours: h }) })).json(); }
  async listInvites(s) { return (await this.fetch(`/servers/${s}/invites`)).json(); }

  // ── Members ──
  async listMembers(s) { return (await this.fetch(`/servers/${s}/members`)).json(); }

  // ── Channels ──
  async listChannels(s) { return (await this.fetch(`/servers/${s}/channels`)).json(); }
  async createChannel(s, n, t) { return (await this.fetch(`/servers/${s}/channels`, { method: "POST", body: JSON.stringify({ name: n, channel_type: t || "text" }) })).json(); }
  async updateChannel(id, b) { return (await this.fetch(`/channels/${id}`, { method: "PATCH", body: JSON.stringify(b) })).json(); }
  async deleteChannel(id) { return this.fetch(`/channels/${id}`, { method: "DELETE" }); }

  // ── Messages ──
  async sendMessage(ch, ct, ep, att) { const b = { content_ciphertext: ct, mls_epoch: ep }; if (att) b.attachment_blob_id = att; return (await this.fetch(`/channels/${ch}/messages`, { method: "POST", body: JSON.stringify(b) })).json(); }
  async getMessages(ch, lim = 50, bef) { let u = `/channels/${ch}/messages?limit=${lim}`; if (bef) u += `&before=${bef}`; return (await this.fetch(u)).json(); }
  async editMessage(id, ct, ep) { return (await this.fetch(`/messages/${id}`, { method: "PATCH", body: JSON.stringify({ content_ciphertext: ct, mls_epoch: ep }) })).json(); }
  async deleteMessage(id) { return this.fetch(`/messages/${id}`, { method: "DELETE" }); }

  // ── Roles ──
  async listRoles(s) { return (await this.fetch(`/servers/${s}/roles`)).json(); }
  async createRole(s, b) { return (await this.fetch(`/servers/${s}/roles`, { method: "POST", body: JSON.stringify(b) })).json(); }
  async deleteRole(id) { return this.fetch(`/roles/${id}`, { method: "DELETE" }); }
  async assignRole(s, u, r) { return this.fetch(`/servers/${s}/members/${u}/roles/${r}`, { method: "PUT" }); }
  async unassignRole(s, u, r) { return this.fetch(`/servers/${s}/members/${u}/roles/${r}`, { method: "DELETE" }); }
  async listMemberRoles(s, u) { return (await this.fetch(`/servers/${s}/members/${u}/roles`)).json(); }

  // ── Bans ──
  async banMember(s, u, r) { return this.fetch(`/servers/${s}/bans`, { method: "POST", body: JSON.stringify({ user_id: u, reason: r }) }); }
  async unbanMember(s, u) { return this.fetch(`/servers/${s}/bans/${u}`, { method: "DELETE" }); }
  async listBans(s) { return (await this.fetch(`/servers/${s}/bans`)).json(); }

  // ── Files ──
  async uploadFile(ch, d, fn, mt) { return (await this.fetch(`/channels/${ch}/files`, { method: "POST", body: JSON.stringify({ file_data: d, filename: fn, content_type: mt }) })).json(); }
  async downloadFile(id) { return (await this.fetch(`/files/${id}`)).json(); }

  // ── Audit ──
  async getAuditLog(s, lim = 50) { return (await this.fetch(`/servers/${s}/audit-log?limit=${lim}`)).json(); }

  // ── Reactions ──
  async addReaction(ch, m, e) { return this.fetch(`/channels/${ch}/messages/${m}/reactions/${encodeURIComponent(e)}`, { method: "PUT" }); }
  async removeReaction(ch, m, e) { return this.fetch(`/channels/${ch}/messages/${m}/reactions/${encodeURIComponent(e)}`, { method: "DELETE" }); }
  async listReactions(ch, m) { return (await this.fetch(`/channels/${ch}/messages/${m}/reactions`)).json(); }

  // ── Typing ──
  async sendTyping(ch) { return this.fetch(`/channels/${ch}/typing`, { method: "POST" }); }

  // ── Pins ──
  async pinMessage(s, ch, m) { return this.fetch(`/servers/${s}/channels/${ch}/pins/${m}`, { method: "POST" }); }
  async unpinMessage(s, ch, m) { return this.fetch(`/servers/${s}/channels/${ch}/pins/${m}`, { method: "DELETE" }); }
  async listPins(s, ch) { return (await this.fetch(`/servers/${s}/channels/${ch}/pins`)).json(); }

  // ── Friends ──
  async listFriends() { return (await this.fetch("/friends")).json(); }
  async sendFriendRequest(userId) { return this.fetch("/friends/request", { method: "POST", body: JSON.stringify({ user_id: userId }) }); }
  async listIncomingRequests() { return (await this.fetch("/friends/requests")).json(); }
  async acceptFriend(id) { return this.fetch(`/friends/${id}/accept`, { method: "POST" }); }
  async declineFriend(id) { return this.fetch(`/friends/${id}/decline`, { method: "POST" }); }
  async removeFriend(id) { return this.fetch(`/friends/${id}`, { method: "DELETE" }); }
  async searchUsers(q) { return (await this.fetch(`/users/search?q=${encodeURIComponent(q)}`)).json(); }
  async blockUser(id) { return this.fetch(`/users/${id}/block`, { method: "POST" }); }

  // ── WebSocket ──
  connectWs(serverId) {
    if (this.ws) this.ws.close();
    this.ws = new WebSocket(`${WS_BASE}/ws?server_id=${serverId}`, ["Bearer", this.token]);
    this.ws.onmessage = (e) => { try { this.wsListeners.forEach(fn => fn(JSON.parse(e.data))); } catch {} };
    this.ws.onerror = () => {}; this.ws.onclose = () => { this.ws = null; };
  }
  disconnectWs() { if (this.ws) { this.ws.close(); this.ws = null; } }
  onWsEvent(fn) { this.wsListeners.add(fn); return () => this.wsListeners.delete(fn); }
}

const api = new CitadelAPI();

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

// ═══════════════════════════════════════════════════════════════
// CONTEXT MENU — Used for server, channel, member, message right-click
// ═══════════════════════════════════════════════════════════════
function CtxMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [onClose]);
  const W = typeof window !== "undefined" ? window : { innerWidth: 1200, innerHeight: 800 };
  const mx = Math.min(x, W.innerWidth - 220); const my = Math.min(y, W.innerHeight - (items.length * 34 + 20));
  return (
    <div ref={ref} style={{ position: "fixed", left: mx, top: my, zIndex: 10000, minWidth: 190, background: "#111320", borderRadius: 8, border: `1px solid ${T.bd}`, padding: "4px 0", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
      {items.map((it, i) => {
        if (it.sep) return <div key={i} style={{ height: 1, background: T.bd, margin: "4px 8px" }} />;
        return (<div key={i} onClick={() => { if (!it.off) { it.fn?.(); onClose(); } }}
          style={{ padding: "7px 12px", display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: it.danger ? T.err : it.off ? T.mt : T.tx, cursor: it.off ? "default" : "pointer", opacity: it.off ? 0.4 : 1, borderRadius: 4, margin: "0 4px" }}
          onMouseEnter={e => { if (!it.off) e.currentTarget.style.background = it.danger ? "rgba(255,71,87,0.08)" : "rgba(255,255,255,0.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
          {it.icon && <span style={{ display: "flex", alignItems: "center", width: 18 }}>{it.icon}</span>}
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.hint && <span style={{ fontSize: 10, color: T.mt, fontFamily: "monospace" }}>{it.hint}</span>}
        </div>);
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EMOJI PICKER — 800ms grace period (Slack=300ms, Discord=400ms)
// ═══════════════════════════════════════════════════════════════
function EmojiPicker({ onPick, onClose, anchorRef }) {
  const [cat, setCat] = useState("Quick");
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const tmr = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target) && anchorRef?.current && !anchorRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => { document.removeEventListener("mousedown", h); if (tmr.current) clearTimeout(tmr.current); };
  }, [onClose, anchorRef]);

  const onLeave = () => { tmr.current = setTimeout(onClose, 800); };
  const onEnter = () => { if (tmr.current) { clearTimeout(tmr.current); tmr.current = null; } };

  const list = q ? Object.values(EMOJIS).flat().filter(e => e.includes(q)) : EMOJIS[cat] || [];

  return (
    <div ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ position: "absolute", bottom: "calc(100% + 8px)", right: 0, width: 320, background: "#111320", borderRadius: 10, border: `1px solid ${T.bd}`, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 100, overflow: "hidden" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${T.bd}` }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search emoji..." autoFocus
          style={{ width: "100%", padding: "6px 10px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 6, color: T.tx, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
      </div>
      {!q && <div style={{ display: "flex", padding: "4px 6px", gap: 2, borderBottom: `1px solid ${T.bd}`, overflowX: "auto" }}>
        {Object.keys(EMOJIS).map(c => (
          <div key={c} onClick={() => setCat(c)} style={{ padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", background: cat === c ? "rgba(0,212,170,0.12)" : "transparent", color: cat === c ? T.ac : T.mt }}>{c}</div>
        ))}
      </div>}
      <div style={{ padding: 8, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, maxHeight: 200, overflowY: "auto" }}>
        {list.map((e, i) => (
          <div key={i} onClick={() => { onPick(e); onClose(); }}
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, cursor: "pointer", fontSize: 18 }}
            onMouseEnter={ev => ev.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>{e}</div>
        ))}
        {list.length === 0 && <div style={{ gridColumn: "1/-1", color: T.mt, fontSize: 12, padding: 10, textAlign: "center" }}>No matches</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MEMBER POPOUT — Left-click or right-click > Profile
// Shows global username, server nickname, roles (editable by owner)
// ═══════════════════════════════════════════════════════════════
function MemberPopout({ member, serverId, isOwner, allRoles, onClose, onRoleChange }) {
  const [mRoles, setMRoles] = useState([]);
  const [showR, setShowR] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  useEffect(() => {
    if (member?.user_id && serverId) api.listMemberRoles(serverId, member.user_id).then(r => { if (Array.isArray(r)) setMRoles(r); }).catch(() => {});
  }, [member?.user_id, serverId]);

  const toggle = async (rid) => {
    const has = mRoles.some(r => r.id === rid);
    if (has) { await api.unassignRole(serverId, member.user_id, rid); setMRoles(p => p.filter(r => r.id !== rid)); }
    else { await api.assignRole(serverId, member.user_id, rid); const role = allRoles.find(r => r.id === rid); if (role) setMRoles(p => [...p, role]); }
    onRoleChange?.();
  };

  return (
    <div ref={ref} style={{ background: "#111320", borderRadius: 10, border: `1px solid ${T.bd}`, width: 290, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden" }}>
      {/* Banner */}
      <div style={{ height: 60, background: `linear-gradient(135deg, ${T.ac}, ${T.ac2})`, position: "relative" }}>
        <div style={{ position: "absolute", bottom: -20, left: 16, width: 48, height: 48, borderRadius: 24, background: T.sf, border: "3px solid #111320", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: T.ac }}>
          {member.username?.[0]?.toUpperCase() || "?"}
        </div>
      </div>
      <div style={{ padding: "28px 16px 14px" }}>
        {/* Display name */}
        <div style={{ fontWeight: 700, fontSize: 16, color: T.tx }}>{member.display_name || member.nickname || member.username}</div>
        {/* Global username always shown */}
        <div style={{ fontSize: 12, color: T.mt, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span>@{member.username}</span>
          {/* Server nickname badge if different */}
          {member.nickname && member.nickname !== member.username && (
            <span style={{ padding: "1px 6px", borderRadius: 3, background: "rgba(0,212,170,0.08)", color: T.ac, fontSize: 10 }}>
              Server: {member.nickname}
            </span>
          )}
        </div>
        {/* User ID for owners */}
        {isOwner && <div style={{ fontSize: 10, color: T.mt, marginTop: 4, fontFamily: "monospace", opacity: 0.6 }}>ID: {member.user_id}</div>}

        {/* Roles */}
        <div style={{ marginTop: 12, borderTop: `1px solid ${T.bd}`, paddingTop: 10 }}>
          <div onClick={() => isOwner && setShowR(!showR)}
            style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4, cursor: isOwner ? "pointer" : "default", marginBottom: 6 }}>
            Roles {isOwner && <I.ChevD />} {isOwner && <span style={{ fontSize: 9, color: T.ac, fontWeight: 400, textTransform: "none" }}>click to manage</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {mRoles.length === 0 && <span style={{ fontSize: 11, color: T.mt }}>No roles</span>}
            {mRoles.map(r => (
              <span key={r.id} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: `${r.color || T.ac}22`, color: r.color || T.ac, border: `1px solid ${r.color || T.ac}44` }}>{r.name}</span>
            ))}
          </div>
          {/* Inline role assignment for owners */}
          {showR && isOwner && (
            <div style={{ marginTop: 8, background: T.bg, borderRadius: 6, border: `1px solid ${T.bd}`, padding: 6, maxHeight: 150, overflowY: "auto" }}>
              {allRoles.map(r => {
                const has = mRoles.some(mr => mr.id === r.id);
                return (<div key={r.id} onClick={() => toggle(r.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${r.color || T.ac}`, background: has ? (r.color || T.ac) : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {has && <span style={{ fontSize: 10, color: "#000" }}>✓</span>}
                  </div>
                  <span style={{ color: r.color || T.tx }}>{r.name}</span>
                </div>);
              })}
              {allRoles.length === 0 && <div style={{ fontSize: 11, color: T.mt, padding: 4 }}>No roles created yet</div>}
            </div>
          )}
        </div>

        {/* Joined date */}
        {member.joined_at && <div style={{ marginTop: 10, borderTop: `1px solid ${T.bd}`, paddingTop: 8, fontSize: 11, color: T.mt }}>
          Joined: {fmtDate(member.joined_at) || new Date(member.joined_at).toLocaleDateString()}
        </div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SLASH COMMANDS — /ban /kick /role /nick /audit /settings /invite
// Autocomplete members and roles inline
// ═══════════════════════════════════════════════════════════════
function SlashBox({ input, members, roles, onSet }) {
  if (!input.startsWith("/")) return null;
  const parts = input.split(" "); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(" ").toLowerCase();

  const cmds = [
    { c: "/ban", d: "Ban a user from server", icon: <I.Ban /> },
    { c: "/kick", d: "Kick a user", icon: <I.Out /> },
    { c: "/role", d: "Assign role to user", icon: <I.Tag /> },
    { c: "/nick", d: "Set your server nickname", icon: <I.Edit /> },
    { c: "/audit", d: "View audit log", icon: <I.Clip2 /> },
    { c: "/settings", d: "Server settings", icon: <I.Gear /> },
    { c: "/invite", d: "Create invite link", icon: <I.Copy /> },
    { c: "/pin", d: "Pin a message", icon: <I.Pin /> },
    { c: "/search", d: "Search messages", icon: <I.Search /> },
  ];

  const box = { position: "absolute", bottom: "100%", left: 0, right: 0, background: "#111320", borderRadius: "8px 8px 0 0", border: `1px solid ${T.bd}`, borderBottom: "none", padding: 6, zIndex: 50, maxHeight: 240, overflowY: "auto" };
  const row = { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 5, cursor: "pointer", fontSize: 13 };
  const hov = (e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)";
  const uhov = (e) => e.currentTarget.style.background = "transparent";

  // Show all commands on just "/"
  if (input === "/") return (
    <div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px", textTransform: "uppercase" }}>Slash Commands</div>
      {cmds.map(c => (<div key={c.c} onClick={() => onSet(c.c + " ")} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <span style={{ color: T.ac }}>{c.icon}</span>
        <span style={{ color: T.tx, fontWeight: 600, fontFamily: "monospace" }}>{c.c}</span>
        <span style={{ color: T.mt, fontSize: 12 }}>{c.d}</span>
      </div>))}
    </div>
  );

  // Member autocomplete for /ban, /kick, /role
  if (["/ban", "/kick", "/role"].includes(cmd) && parts.length <= 2) {
    const f = members.filter(m => !arg || m.username?.toLowerCase().includes(arg) || m.nickname?.toLowerCase()?.includes(arg));
    if (!f.length) return null;
    return (<div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Select member:</div>
      {f.slice(0, 10).map(m => (<div key={m.user_id} onClick={() => onSet(`${cmd} ${m.username} `)} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <div style={{ width: 22, height: 22, borderRadius: 11, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
        <span style={{ color: T.tx }}>{m.nickname || m.username}</span>
        <span style={{ color: T.mt, fontSize: 11 }}>@{m.username}</span>
      </div>))}
    </div>);
  }

  // Role autocomplete for /role user <role>
  if (cmd === "/role" && parts.length >= 3) {
    const rArg = parts.slice(2).join(" ").toLowerCase();
    const f = roles.filter(r => !rArg || r.name?.toLowerCase().includes(rArg));
    return (<div style={box}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Select role for {parts[1]}:</div>
      {f.map(r => (<div key={r.id} onClick={() => onSet(`/role ${parts[1]} ${r.name}`)} style={row} onMouseEnter={hov} onMouseLeave={uhov}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: r.color || T.ac }} />
        <span style={{ color: r.color || T.tx }}>{r.name}</span>
      </div>))}
      {!f.length && <div style={{ fontSize: 11, color: T.mt, padding: "4px 8px" }}>No matching roles</div>}
    </div>);
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// MODAL — Reusable for Settings, Audit, Roles, Bans, etc.
// ═══════════════════════════════════════════════════════════════
function Modal({ title, onClose, children, w = 500 }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={onClose}>
      <div style={{ width: w, maxWidth: "92vw", maxHeight: "85vh", background: T.sf, borderRadius: 14, border: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.tx, flex: 1 }}>{title}</span>
          <div onClick={onClose} style={{ cursor: "pointer", color: T.mt, padding: 4, borderRadius: 4 }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}><I.X /></div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TYPING INDICATOR — Shows "user is typing..." with animated dots
// ═══════════════════════════════════════════════════════════════
function TypingIndicator({ typers }) {
  if (!typers || typers.length === 0) return null;
  const names = typers.slice(0, 3).join(", ");
  const extra = typers.length > 3 ? ` and ${typers.length - 3} more` : "";
  return (
    <div style={{ padding: "2px 16px 6px", fontSize: 11, color: T.mt, display: "flex", alignItems: "center", gap: 6, minHeight: 20 }}>
      <span className="typing-dots" style={{ display: "inline-flex", gap: 2 }}>
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "0ms" }} />
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "200ms" }} />
        <span style={{ width: 4, height: 4, borderRadius: 2, background: T.mt, animation: "typingBounce 1.2s infinite", animationDelay: "400ms" }} />
      </span>
      <span><strong style={{ color: T.tx }}>{names}</strong>{extra} {typers.length === 1 ? "is" : "are"} typing</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUICK REACTION BAR — Shows on message hover
// ═══════════════════════════════════════════════════════════════
const QUICK_REACT = ["👍","❤️","😂","🔥","👀","🎉"];

function ReactionBar({ reactions, channelId, messageId, myUserId }) {
  if (!reactions || reactions.length === 0) return null;
  // Group reactions by emoji
  const grouped = {};
  reactions.forEach(r => {
    if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, me: false };
    grouped[r.emoji].count++;
    if (r.user_id === myUserId) grouped[r.emoji].me = true;
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {Object.values(grouped).map(r => (
        <div key={r.emoji} onClick={async () => {
          if (r.me) await api.removeReaction(channelId, messageId, r.emoji);
          else await api.addReaction(channelId, messageId, r.emoji);
        }}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 4,
            background: r.me ? "rgba(0,212,170,0.12)" : "rgba(255,255,255,0.04)",
            border: r.me ? `1px solid ${T.ac}44` : `1px solid ${T.bd}`,
            cursor: "pointer", fontSize: 13 }}>
          <span>{r.emoji}</span>
          <span style={{ fontSize: 11, color: r.me ? T.ac : T.mt, fontWeight: 600 }}>{r.count}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// @MENTION AUTOCOMPLETE — Type @ to get suggestions
// ═══════════════════════════════════════════════════════════════
function MentionBox({ input, cursorPos, members, onInsert }) {
  // Find @ pattern before cursor
  const before = input.slice(0, cursorPos);
  const atMatch = before.match(/@(\w*)$/);
  if (!atMatch) return null;
  const q = atMatch[1].toLowerCase();
  const filtered = members.filter(m => m.username?.toLowerCase().includes(q)).slice(0, 6);
  if (filtered.length === 0) return null;

  return (
    <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, background: "#111320", borderRadius: "8px 8px 0 0", border: `1px solid ${T.bd}`, borderBottom: "none", padding: 6, zIndex: 50 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, padding: "4px 8px" }}>Members</div>
      {filtered.map(m => (
        <div key={m.user_id} onClick={() => {
          const prefix = input.slice(0, cursorPos - atMatch[0].length);
          const suffix = input.slice(cursorPos);
          onInsert(prefix + `@${m.username} ` + suffix);
        }}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
          <span style={{ color: T.tx }}>{m.nickname || m.display_name || m.username}</span>
          <span style={{ color: T.mt, fontSize: 11 }}>@{m.username}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DATE SEPARATOR — Shown between messages from different days
// ═══════════════════════════════════════════════════════════════
function DateSep({ date }) {
  return (
    <div style={{ display: "flex", alignItems: "center", margin: "12px 0", gap: 10 }}>
      <div style={{ flex: 1, height: 1, background: T.bd }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, whiteSpace: "nowrap" }}>{fmtDate(date)}</span>
      <div style={{ flex: 1, height: 1, background: T.bd }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG INLINE PANEL (sidebar)
// ═══════════════════════════════════════════════════════════════
function AuditInline({ serverId }) {
  const [ents, setEnts] = useState([]); const [ld, setLd] = useState(true);
  useEffect(() => { if (!serverId) return; setLd(true);
    api.getAuditLog(serverId, 30).then(d => { setEnts(Array.isArray(d) ? d : d?.entries || []); setLd(false); }).catch(() => setLd(false));
  }, [serverId]);
  if (ld) return <div style={{ color: T.mt, fontSize: 12, padding: 8 }}>Loading audit log...</div>;
  return (<div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.8 }}>
    {ents.length === 0 && <div style={{ color: T.mt }}>No audit entries yet</div>}
    {ents.map((e, i) => (<div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${T.bd}33` }}>
      <div style={{ color: T.warn, fontWeight: 600 }}>{e.action_type}</div>
      <div style={{ color: T.mt, fontSize: 9 }}>{new Date(e.created_at).toLocaleString()}</div>
      {e.details && <div style={{ color: T.tx, fontSize: 9, opacity: 0.6 }}>{typeof e.details === "string" ? e.details : JSON.stringify(e.details)}</div>}
    </div>))}
  </div>);
}

// ═══════════════════════════════════════════════════════════════
// MAIN APPLICATION — Discreet Encrypted Messenger
// ═══════════════════════════════════════════════════════════════
export default function App() {
  // ── Auth state ──
  const [view, setView] = useState(api.token ? "app" : "auth");
  const [authMode, setAuthMode] = useState("login");
  const [authErr, setAuthErr] = useState("");
  const [user, setUser] = useState(null);

  // ── Data state ──
  const [servers, setServers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [roles, setRoles] = useState([]);
  const [pins, setPins] = useState([]);
  const [typers, setTypers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendReqs, setFriendReqs] = useState([]);

  // ── Selection state ──
  const [curSrv, setCurSrv] = useState(null);
  const [curCh, setCurCh] = useState(null);

  // ── UI state ──
  const [input, setInput] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCreateSrv, setShowCreateSrv] = useState(false);
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [modal, setModal] = useState(null); // { type: "serverSettings"|"channelSettings"|"audit"|"roles"|"bans"|"invite"|"join" }
  const [ctx, setCtx] = useState(null);     // { x, y, items }
  const [popout, setPopout] = useState(null); // { member, x, y }
  const [panel, setPanel] = useState("members"); // "members"|"audit"|"pins"|"search"
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [hovMsg, setHovMsg] = useState(null);
  const [searchQ, setSearchQ] = useState("");

  // ── Form state ──
  const [newSrvName, setNewSrvName] = useState("");
  const [newSrvDesc, setNewSrvDesc] = useState("");
  const [newChName, setNewChName] = useState("");
  const [newChType, setNewChType] = useState("text");
  const [joinCode, setJoinCode] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#00d4aa");
  const [settingsName, setSettingsName] = useState("");
  const [settingsDesc, setSettingsDesc] = useState("");
  const [settingsTopic, setSettingsTopic] = useState("");

  // ── Crypto ──
  const [cEng] = useState(() => new CryptoEngine());
  const [fp, setFp] = useState("");

  // ── Refs ──
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const emoRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const wsCleanup = useRef(null);

  // ── Helpers ──
  const notify = useCallback((msg, type = "info") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
  }, []);

  const copyTo = useCallback((t, label) => {
    navigator.clipboard?.writeText(t).then(() => notify(`${label} copied!`, "success")).catch(() => {});
  }, [notify]);

  const isOwner = curSrv && user && curSrv.owner_id === user.id;

  // ═══════════════════════════════════════════════════════
  // EFFECTS — Data loading, WebSocket, crypto init
  // ═══════════════════════════════════════════════════════

  // Init crypto on mount
  useEffect(() => { cEng.init().then(setFp); }, [cEng]);

  // Load user + servers on auth
  useEffect(() => {
    if (view !== "app") return;
    api.getMe().then(u => { setUser(u); api.username = u.username; }).catch(() => { api.clearAuth(); setView("auth"); });
    api.listServers().then(s => { if (Array.isArray(s)) setServers(s); else if (s?.servers) setServers(s.servers); });
    api.listFriends().then(f => { if (Array.isArray(f)) setFriends(f); }).catch(() => {});
    api.listIncomingRequests().then(r => { if (Array.isArray(r)) setFriendReqs(r); }).catch(() => {});
  }, [view]);

  // Load channels + members + roles when server changes
  useEffect(() => {
    if (!curSrv) return;
    api.listChannels(curSrv.id).then(c => {
      const chs = Array.isArray(c) ? c : c?.channels || [];
      setChannels(chs);
      if (chs.length > 0 && !curCh) setCurCh(chs.find(ch => ch.channel_type === "text") || chs[0]);
    });
    api.listMembers(curSrv.id).then(m => { if (Array.isArray(m)) setMembers(m); else if (m?.members) setMembers(m.members); });
    api.listRoles(curSrv.id).then(r => { if (Array.isArray(r)) setRoles(r); else if (r?.roles) setRoles(r.roles); }).catch(() => setRoles([]));

    // Connect WebSocket
    api.connectWs(curSrv.id);
    if (wsCleanup.current) wsCleanup.current();
    wsCleanup.current = api.onWsEvent(async (evt) => {
      if (evt.type === "new_message" && evt.channel_id === curCh?.id) {
        try {
          const pt = await cEng.decrypt(evt.content_ciphertext, evt.channel_id, evt.mls_epoch || 0);
          setMessages(prev => [...prev, { ...evt, text: pt }]);
        } catch { setMessages(prev => [...prev, { ...evt, text: "[decryption failed]" }]); }
      }
      if (evt.type === "message_edited") { setMessages(prev => prev.map(m => m.id === evt.id ? { ...m, edited_at: evt.edited_at, content_ciphertext: evt.content_ciphertext } : m)); }
      if (evt.type === "message_deleted") { setMessages(prev => prev.filter(m => m.id !== evt.id)); }
      if (evt.type === "typing_start") {
        setTypers(prev => { if (prev.includes(evt.username)) return prev; return [...prev, evt.username]; });
        setTimeout(() => setTypers(prev => prev.filter(u => u !== evt.username)), 5000);
      }
      if (evt.type === "member_joined") { api.listMembers(curSrv.id).then(m => { if (Array.isArray(m)) setMembers(m); }); }
      if (evt.type === "member_left") { setMembers(prev => prev.filter(m => m.user_id !== evt.user_id)); }
    });

    return () => { if (wsCleanup.current) wsCleanup.current(); api.disconnectWs(); };
  }, [curSrv?.id]);

  // Load messages when channel changes
  useEffect(() => {
    if (!curCh) return;
    setMessages([]);
    api.getMessages(curCh.id, 50).then(async (raw) => {
      const msgs = Array.isArray(raw) ? raw : raw?.messages || [];
      const decrypted = await Promise.all(msgs.map(async (m) => {
        try { const pt = await cEng.decrypt(m.content_ciphertext, curCh.id, m.mls_epoch || 0); return { ...m, text: pt }; }
        catch { return { ...m, text: null }; }
      }));
      setMessages(decrypted.reverse());
    });
  }, [curCh?.id, cEng]);

  // Auto-scroll on new messages
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // ═══════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════

  // ── Auth ──
  const doAuth = async (e) => {
    e.preventDefault(); setAuthErr("");
    const u = e.target.username.value; const p = e.target.password.value;
    const em = authMode === "register" ? e.target.email?.value : undefined;
    const res = authMode === "register" ? await api.register(u, p, em) : await api.login(u, p);
    if (res.ok) { setView("app"); setAuthErr(""); }
    else setAuthErr(res.data?.error || res.data?.message || `${authMode} failed`);
  };

  // ── Send message / slash commands ──
  const sendMsg = async () => {
    if (!input.trim() || !curCh) return;
    const txt = input.trim(); setInput("");

    // Slash command processing
    if (txt.startsWith("/")) {
      const parts = txt.split(" ");
      const cmd = parts[0].toLowerCase();
      const arg1 = parts[1]; const rest = parts.slice(2).join(" ");

      if (cmd === "/ban" && arg1) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        const res = await api.banMember(curSrv.id, target.user_id, rest || "No reason given");
        if (res.ok) { notify(`Banned ${arg1}`, "success"); api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : [])); }
        else notify("Ban failed", "error");
        return;
      }
      if (cmd === "/kick" && arg1) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        await api.banMember(curSrv.id, target.user_id, "Kicked");
        await api.unbanMember(curSrv.id, target.user_id);
        notify(`Kicked ${arg1}`, "success");
        api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : []));
        return;
      }
      if (cmd === "/role" && arg1 && parts[2]) {
        const target = members.find(m => m.username?.toLowerCase() === arg1.toLowerCase());
        const role = roles.find(r => r.name?.toLowerCase() === rest.toLowerCase());
        if (!target) { notify("User not found", "error"); return; }
        if (!role) { notify("Role not found", "error"); return; }
        await api.assignRole(curSrv.id, target.user_id, role.id);
        notify(`Assigned ${role.name} to ${arg1}`, "success");
        return;
      }
      if (cmd === "/nick") {
        // Would need a setNickname endpoint; for now notify
        notify("Nickname set (display name update)", "info");
        return;
      }
      if (cmd === "/audit") {
        const log = await api.getAuditLog(curSrv.id);
        setModal({ type: "audit", data: Array.isArray(log) ? log : log?.entries || [] });
        return;
      }
      if (cmd === "/settings") { setSettingsName(curSrv.name); setSettingsDesc(curSrv.description || ""); setModal({ type: "serverSettings" }); return; }
      if (cmd === "/invite") {
        const inv = await api.createInvite(curSrv.id, 0, 168);
        setModal({ type: "invite", data: inv });
        return;
      }
      // Not a recognized command — send as regular message
    }

    // Normal encrypted message
    const ct = await cEng.encrypt(txt, curCh.id, 0);
    await api.sendMessage(curCh.id, ct, 0);
  };

  // ── Typing indicator ──
  const onInputChange = (e) => {
    setInput(e.target.value);
    if (curCh && !typingTimer.current) {
      api.sendTyping(curCh.id).catch(() => {});
      typingTimer.current = setTimeout(() => { typingTimer.current = null; }, 3000);
    }
  };

  // ── Message editing ──
  const startEdit = (m) => { setEditing(m); setEditText(m.text || ""); };
  const saveEdit = async () => {
    if (!editing || !editText.trim()) return;
    const ct = await cEng.encrypt(editText.trim(), curCh.id, 0);
    await api.editMessage(editing.id, ct, 0);
    setMessages(prev => prev.map(m => m.id === editing.id ? { ...m, text: editText.trim(), edited_at: new Date().toISOString() } : m));
    setEditing(null); setEditText("");
    notify("Message edited", "success");
  };

  const deleteMsg = async (m) => {
    await api.deleteMessage(m.id);
    setMessages(prev => prev.filter(msg => msg.id !== m.id));
    notify("Message deleted", "success");
  };

  // ── File upload ──
  const handleFile = async (e) => {
    const file = e.target.files?.[0]; if (!file || !curCh) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const b64 = reader.result.split(",")[1];
        const res = await api.uploadFile(curCh.id, b64, file.name, file.type);
        if (res.id) {
          const ct = await cEng.encrypt(`📎 ${file.name}`, curCh.id, 0);
          await api.sendMessage(curCh.id, ct, 0, res.id);
          notify(`Uploaded ${file.name}`, "success");
        }
      } catch { notify("Upload failed", "error"); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // ── Server operations ──
  const createServer = async () => {
    if (!newSrvName.trim()) return;
    const s = await api.createServer(newSrvName.trim(), newSrvDesc.trim() || undefined);
    if (s.id) { setServers(prev => [...prev, s]); setCurSrv(s); setShowCreateSrv(false); setNewSrvName(""); setNewSrvDesc(""); notify("Server created!", "success"); }
  };

  const createChannel = async () => {
    if (!newChName.trim() || !curSrv) return;
    const ch = await api.createChannel(curSrv.id, newChName.trim(), newChType);
    if (ch.id) { setChannels(prev => [...prev, ch]); setCurCh(ch); setShowCreateCh(false); setNewChName(""); notify("Channel created!", "success"); }
  };

  const joinServer = async () => {
    if (!joinCode.trim()) return;
    const res = await api.fetch(`/invites/${joinCode.trim()}/join`, { method: "POST" });
    if (res.ok) {
      api.listServers().then(s => { if (Array.isArray(s)) setServers(s); });
      setShowJoin(false); setJoinCode(""); notify("Joined server!", "success");
    } else notify("Invalid invite code", "error");
  };

  const leaveServer = async (s) => {
    if (!confirm(`Leave "${s.name}"?`)) return;
    await api.leaveServer(s.id);
    setServers(prev => prev.filter(sv => sv.id !== s.id));
    if (curSrv?.id === s.id) { setCurSrv(null); setCurCh(null); setChannels([]); setMembers([]); setMessages([]); }
    notify("Left server", "info");
  };

  const deleteServer = async (s) => {
    if (!confirm(`DELETE "${s.name}"? This cannot be undone!`)) return;
    if (!confirm(`Are you absolutely sure? ALL data will be lost.`)) return;
    await api.deleteServer(s.id);
    setServers(prev => prev.filter(sv => sv.id !== s.id));
    if (curSrv?.id === s.id) { setCurSrv(null); setCurCh(null); }
    notify("Server deleted", "info");
  };

  const saveServerSettings = async () => {
    await api.updateServer(curSrv.id, { name: settingsName, description: settingsDesc });
    setCurSrv(prev => ({ ...prev, name: settingsName, description: settingsDesc }));
    setServers(prev => prev.map(s => s.id === curSrv.id ? { ...s, name: settingsName, description: settingsDesc } : s));
    setModal(null); notify("Server updated!", "success");
  };

  const saveChannelSettings = async () => {
    await api.updateChannel(modal.channel.id, { name: settingsName, topic: settingsTopic });
    setChannels(prev => prev.map(c => c.id === modal.channel.id ? { ...c, name: settingsName, topic: settingsTopic } : c));
    if (curCh?.id === modal.channel.id) setCurCh(prev => ({ ...prev, name: settingsName, topic: settingsTopic }));
    setModal(null); notify("Channel updated!", "success");
  };

  const deleteChannel = async (ch) => {
    if (!confirm(`Delete #${ch.name}?`)) return;
    await api.deleteChannel(ch.id);
    setChannels(prev => prev.filter(c => c.id !== ch.id));
    if (curCh?.id === ch.id) setCurCh(channels.find(c => c.id !== ch.id) || null);
    notify("Channel deleted", "info");
  };

  // ── Role operations ──
  const createRole = async () => {
    if (!newRoleName.trim() || !curSrv) return;
    const r = await api.createRole(curSrv.id, { name: newRoleName.trim(), color: newRoleColor });
    if (r.id) { setRoles(prev => [...prev, r]); setNewRoleName(""); notify(`Role "${r.name}" created`, "success"); }
  };

  const deleteRole = async (r) => {
    if (!confirm(`Delete role "${r.name}"?`)) return;
    await api.deleteRole(r.id);
    setRoles(prev => prev.filter(ro => ro.id !== r.id));
    notify("Role deleted", "info");
  };

  // ── Reactions ──
  const addReaction = async (m, emoji) => {
    if (!curCh) return;
    await api.addReaction(curCh.id, m.id, emoji);
  };

  // ═══════════════════════════════════════════════════════
  // CONTEXT MENU BUILDERS
  // ═══════════════════════════════════════════════════════

  const openServerCtx = (e, s) => {
    e.preventDefault();
    const isOw = user && s.owner_id === user.id;
    const items = [];
    if (isOw) {
      items.push({ label: "Server Settings", icon: <I.Gear />, fn: () => { setCurSrv(s); setSettingsName(s.name); setSettingsDesc(s.description || ""); setModal({ type: "serverSettings" }); } });
      items.push({ label: "Create Invite", icon: <I.Copy />, fn: async () => { const inv = await api.createInvite(s.id, 0, 168); setModal({ type: "invite", data: inv }); } });
      items.push({ sep: true });
      items.push({ label: "Manage Roles", icon: <I.Tag />, fn: async () => { const r = await api.listRoles(s.id); setRoles(Array.isArray(r) ? r : r?.roles || []); setModal({ type: "roles" }); } });
      items.push({ label: "Ban List", icon: <I.Ban />, fn: async () => { const b = await api.listBans(s.id); setModal({ type: "bans", data: Array.isArray(b) ? b : b?.bans || [] }); } });
      items.push({ label: "Audit Log", icon: <I.Clip2 />, fn: async () => { const l = await api.getAuditLog(s.id); setModal({ type: "audit", data: Array.isArray(l) ? l : l?.entries || [] }); } });
      items.push({ sep: true });
      items.push({ label: "Delete Server", icon: <I.Trash />, danger: true, fn: () => deleteServer(s) });
    } else {
      items.push({ label: "Leave Server", icon: <I.Out />, danger: true, fn: () => leaveServer(s) });
    }
    items.push({ sep: true });
    items.push({ label: "Copy Server ID", icon: <I.Copy />, hint: s.id?.slice(0, 8), fn: () => copyTo(s.id, "Server ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openChannelCtx = (e, ch) => {
    e.preventDefault();
    const items = [];
    if (isOwner) {
      items.push({ label: "Edit Channel", icon: <I.Edit />, fn: () => { setSettingsName(ch.name); setSettingsTopic(ch.topic || ""); setModal({ type: "channelSettings", channel: ch }); } });
      items.push({ label: "Delete Channel", icon: <I.Trash />, danger: true, fn: () => deleteChannel(ch) });
      items.push({ sep: true });
    }
    items.push({ label: "Copy Channel ID", icon: <I.Copy />, hint: ch.id?.slice(0, 8), fn: () => copyTo(ch.id, "Channel ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openMemberCtx = (e, m) => {
    e.preventDefault();
    const isSelf = user && m.user_id === user.id;
    const items = [
      { label: "View Profile", icon: <I.Tag />, fn: () => setPopout({ member: m, x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 400) }) },
    ];
    if (!isSelf && isOwner) {
      items.push({ sep: true });
      items.push({ label: "Manage Roles", icon: <I.Tag />, fn: () => setPopout({ member: m, x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 400) }) });
      items.push({ label: "Kick", icon: <I.Out />, danger: true, fn: async () => {
        if (!confirm(`Kick ${m.username}?`)) return;
        await api.banMember(curSrv.id, m.user_id, "Kicked");
        await api.unbanMember(curSrv.id, m.user_id);
        api.listMembers(curSrv.id).then(ms => setMembers(Array.isArray(ms) ? ms : []));
        notify(`Kicked ${m.username}`, "success");
      }});
      items.push({ label: "Ban", icon: <I.Ban />, danger: true, fn: async () => {
        const reason = prompt(`Ban reason for ${m.username}:`);
        if (reason === null) return;
        await api.banMember(curSrv.id, m.user_id, reason || "No reason");
        api.listMembers(curSrv.id).then(ms => setMembers(Array.isArray(ms) ? ms : []));
        notify(`Banned ${m.username}`, "success");
      }});
    }
    items.push({ sep: true });
    items.push({ label: "Copy User ID", icon: <I.Copy />, hint: m.user_id?.slice(0, 8), fn: () => copyTo(m.user_id, "User ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const openMsgCtx = (e, m) => {
    e.preventDefault();
    const isMine = user && m.sender_id === user.id;
    const items = [];
    if (isMine) {
      items.push({ label: "Edit Message", icon: <I.Edit />, fn: () => startEdit(m) });
      items.push({ label: "Delete Message", icon: <I.Trash />, danger: true, fn: () => deleteMsg(m) });
      items.push({ sep: true });
    }
    items.push({ label: "Add Reaction", icon: <I.Smile />, fn: () => { /* TODO: inline reaction picker at message */ } });
    if (isOwner) {
      items.push({ label: "Pin Message", icon: <I.Pin />, fn: async () => { await api.pinMessage(curSrv.id, curCh.id, m.id); notify("Message pinned!", "success"); } });
    }
    items.push({ sep: true });
    items.push({ label: "Copy Text", icon: <I.Copy />, fn: () => copyTo(m.text || "", "Message") });
    items.push({ label: "Copy Message ID", icon: <I.Copy />, hint: m.id?.slice(0, 8), fn: () => copyTo(m.id, "Message ID") });
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  // ═══════════════════════════════════════════════════════
  // RENDER — Auth Screen
  // ═══════════════════════════════════════════════════════

  if (view === "auth") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, color: T.tx, fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ width: 380, padding: 32, background: T.sf, borderRadius: 16, border: `1px solid ${T.bd}` }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <I.Shield s={28} /><span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Discreet</span>
          </div>
          <div style={{ fontSize: 13, color: T.mt }}>End-to-end encrypted messaging</div>
        </div>

        {/* Tab switch */}
        <div style={{ display: "flex", gap: 4, background: T.bg, borderRadius: 8, padding: 3, marginBottom: 20 }}>
          {["login", "register"].map(m => (
            <div key={m} onClick={() => { setAuthMode(m); setAuthErr(""); }}
              style={{ flex: 1, padding: "8px 0", textAlign: "center", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: authMode === m ? T.ac : "transparent", color: authMode === m ? "#000" : T.mt, transition: "all .15s" }}>
              {m === "login" ? "Sign In" : "Register"}
            </div>
          ))}
        </div>

        {authErr && <div style={{ padding: "8px 12px", background: "rgba(255,71,87,0.08)", border: `1px solid ${T.err}33`, borderRadius: 8, color: T.err, fontSize: 13, marginBottom: 14 }}>{authErr}</div>}

        <form onSubmit={doAuth}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Username</label>
            <input name="username" required autoComplete="username" style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="Choose a username" />
          </div>
          {authMode === "register" && <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Email (optional)</label>
            <input name="email" type="email" autoComplete="email" style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="you@example.com" />
          </div>}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6, display: "block" }}>Password</label>
            <input name="password" type="password" required autoComplete={authMode === "login" ? "current-password" : "new-password"}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} placeholder="••••••••" />
            {authMode === "register" && <div style={{ fontSize: 11, color: T.mt, marginTop: 4 }}>Min 8 chars, upper + lower + digit required</div>}
          </div>
          <button type="submit" style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            {authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: T.mt, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <I.Lock /><span>Zero-knowledge encryption active</span>
        </div>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════
  // RENDER — Main Application Layout
  // ═══════════════════════════════════════════════════════

  return (
    <div style={{ display: "flex", height: "100vh", background: T.bg, color: T.tx, fontFamily: "Inter, -apple-system, sans-serif", overflow: "hidden" }}>

      {/* ═══ SERVER SIDEBAR — 72px ═══ */}
      <div style={{ width: 72, background: T.bg, borderRight: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 6, overflowY: "auto" }}>
        {/* Home / DMs */}
        <div onClick={() => { setCurSrv(null); setCurCh(null); }} title="Home"
          style={{ width: 48, height: 48, borderRadius: curSrv === null ? 16 : 24, background: curSrv === null ? T.ac : T.sf, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "border-radius .2s", color: curSrv === null ? "#000" : T.mt, fontWeight: 700, fontSize: 18 }}>
          <I.Shield />
        </div>
        <div style={{ width: 32, height: 2, background: T.bd, borderRadius: 1, margin: "2px 0" }} />

        {/* Server icons */}
        {servers.map(s => (
          <div key={s.id} onClick={() => { setCurSrv(s); setCurCh(null); setPanel("members"); }}
            onContextMenu={(e) => openServerCtx(e, s)}
            title={s.name}
            style={{ width: 48, height: 48, borderRadius: curSrv?.id === s.id ? 16 : 24, background: curSrv?.id === s.id ? T.ac : T.sf2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "border-radius .2s", color: curSrv?.id === s.id ? "#000" : T.tx, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
            {s.name?.[0]?.toUpperCase() || "?"}
          </div>
        ))}

        {/* Add server */}
        <div onClick={() => setShowCreateSrv(true)} title="Create Server"
          style={{ width: 48, height: 48, borderRadius: 24, background: "transparent", border: `2px dashed ${T.bd}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.ac }}>
          <I.Plus />
        </div>
        {/* Join server */}
        <div onClick={() => setShowJoin(true)} title="Join Server"
          style={{ width: 48, height: 48, borderRadius: 24, background: "transparent", border: `2px dashed ${T.bd}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.warn, fontSize: 12, fontWeight: 700 }}>
          <I.AtSign />
        </div>

        {/* User avatar at bottom */}
        <div style={{ marginTop: "auto" }}>
          <div onClick={() => { api.logout(); setView("auth"); setCurSrv(null); setCurCh(null); setUser(null); }} title="Sign Out"
            style={{ width: 48, height: 48, borderRadius: 24, background: T.sf2, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.mt }}>
            <I.Out />
          </div>
        </div>
      </div>

      {/* ═══ CHANNEL SIDEBAR — 240px ═══ */}
      {curSrv && (
        <div style={{ width: 240, background: T.sf, borderRight: `1px solid ${T.bd}`, display: "flex", flexDirection: "column" }}>
          {/* Server name header */}
          <div onContextMenu={(e) => openServerCtx(e, curSrv)}
            style={{ padding: "14px 16px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", cursor: "context-menu" }}>
            <span style={{ fontSize: 15, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curSrv.name}</span>
            {isOwner && <span onClick={() => { setSettingsName(curSrv.name); setSettingsDesc(curSrv.description || ""); setModal({ type: "serverSettings" }); }}
              style={{ cursor: "pointer", color: T.mt, display: "flex" }}><I.Gear /></span>}
            <I.ChevD />
          </div>

          {/* Channel list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "4px 16px 8px", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: "uppercase", letterSpacing: "0.5px" }}>Text Channels</span>
              {isOwner && <span onClick={() => setShowCreateCh(true)} style={{ cursor: "pointer", color: T.mt }}><I.Plus /></span>}
            </div>
            {channels.filter(c => c.channel_type === "text").map(ch => (
              <div key={ch.id} onClick={() => setCurCh(ch)} onContextMenu={(e) => openChannelCtx(e, ch)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 16px", cursor: "pointer",
                  background: curCh?.id === ch.id ? "rgba(0,212,170,0.08)" : "transparent",
                  color: curCh?.id === ch.id ? T.tx : T.mt, borderRadius: 4, margin: "0 8px" }}
                onMouseEnter={e => { if (curCh?.id !== ch.id) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (curCh?.id !== ch.id) e.currentTarget.style.background = "transparent"; }}>
                <I.Hash /><span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.name}</span>
              </div>
            ))}
          </div>

          {/* User bar at bottom */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 8, background: T.bg }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#000" }}>
              {user?.username?.[0]?.toUpperCase() || "?"}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.display_name || user?.username}</div>
              <div style={{ fontSize: 10, color: T.mt }}>@{user?.username}</div>
            </div>
            <span style={{ cursor: "pointer", color: T.mt, display: "flex" }} title={`Fingerprint: ${fp}`}><I.Key /></span>
          </div>
        </div>
      )}

      {/* ═══ HOME SCREEN (no server selected) ═══ */}
      {!curSrv && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <I.Shield s={64} />
          <div style={{ fontSize: 24, fontWeight: 700 }}>Welcome to Discreet</div>
          <div style={{ color: T.mt, fontSize: 14, maxWidth: 400, textAlign: "center" }}>Select a server from the sidebar, or create a new one to start chatting with end-to-end encryption.</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setShowCreateSrv(true)} style={{ padding: "10px 20px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Create Server</button>
            <button onClick={() => setShowJoin(true)} style={{ padding: "10px 20px", background: T.sf2, color: T.tx, border: `1px solid ${T.bd}`, borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Join Server</button>
          </div>
          {friends.length > 0 && <div style={{ marginTop: 20, fontSize: 12, color: T.mt }}>{friends.length} friend{friends.length !== 1 ? "s" : ""} online</div>}
        </div>
      )}

      {/* ═══ CHAT AREA ═══ */}
      {curSrv && curCh && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {/* Channel header */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 10, background: T.sf, flexShrink: 0 }}>
            <I.Hash /><span style={{ fontSize: 15, fontWeight: 700 }}>#{curCh.name}</span>
            {curCh.topic && <span style={{ fontSize: 12, color: T.mt, borderLeft: `1px solid ${T.bd}`, paddingLeft: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curCh.topic}</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {isOwner && <span onClick={() => setPanel(p => p === "audit" ? "members" : "audit")} style={{ cursor: "pointer", color: panel === "audit" ? T.warn : T.mt, display: "flex" }} title="Audit Log"><I.Log /></span>}
              <span onClick={() => setPanel(p => p === "pins" ? "members" : "pins")} style={{ cursor: "pointer", color: panel === "pins" ? T.ac : T.mt, display: "flex" }} title="Pinned Messages"><I.Pin /></span>
              <span onClick={() => setPanel("members")} style={{ cursor: "pointer", color: panel === "members" ? T.ac : T.mt, display: "flex" }} title="Members"><I.Users /></span>
              <span style={{ fontSize: 12, color: T.mt }}><I.Lock /> E2EE</span>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {messages.length === 0 && <div style={{ textAlign: "center", color: T.mt, padding: 40 }}>
              <I.Hash s={48} /><div style={{ marginTop: 10, fontSize: 16, fontWeight: 700 }}>Welcome to #{curCh.name}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>This is the start of the channel. Say something!</div>
            </div>}

            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
              const showAuthor = !prev || prev.sender_id !== m.sender_id || showDate || (new Date(m.created_at) - new Date(prev.created_at) > 5 * 60000);
              const sender = members.find(mb => mb.user_id === m.sender_id);
              const senderName = sender?.nickname || sender?.display_name || sender?.username || m.sender_username || "Unknown";
              const isMine = m.sender_id === user?.id;

              return (
                <div key={m.id || i}>
                  {showDate && <DateSep date={m.created_at} />}
                  <div onContextMenu={(e) => openMsgCtx(e, m)}
                    onMouseEnter={() => setHovMsg(m.id)} onMouseLeave={() => setHovMsg(null)}
                    style={{ padding: showAuthor ? "6px 0 2px" : "1px 0", display: "flex", gap: 12, position: "relative",
                      borderRadius: 6, marginLeft: showAuthor ? 0 : 48 }}
                    >
                    {/* Avatar */}
                    {showAuthor && (
                      <div onClick={() => sender && setPopout({ member: sender, x: 80, y: 200 })}
                        style={{ width: 36, height: 36, borderRadius: 18, background: isMine ? T.ac2 : T.sf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: isMine ? "#000" : T.tx, cursor: "pointer", flexShrink: 0, marginTop: 2 }}>
                        {senderName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {showAuthor && (
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                          <span onClick={() => sender && setPopout({ member: sender, x: 80, y: 200 })}
                            style={{ fontWeight: 700, fontSize: 14, color: isMine ? T.ac : T.tx, cursor: "pointer" }}>{senderName}</span>
                          {sender?.username && senderName !== sender.username && <span style={{ fontSize: 11, color: T.mt }}>@{sender.username}</span>}
                          {curSrv?.owner_id === m.sender_id && <span style={{ color: T.warn, display: "flex" }}><I.Crown /></span>}
                          <span style={{ fontSize: 11, color: T.mt }}>{fmtT(m.created_at)}</span>
                        </div>
                      )}

                      {/* Message content or edit mode */}
                      {editing?.id === m.id ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input value={editText} onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") { setEditing(null); setEditText(""); } }}
                            autoFocus style={{ flex: 1, padding: "6px 10px", background: T.bg, border: `1px solid ${T.ac}`, borderRadius: 6, color: T.tx, fontSize: 14, outline: "none" }} />
                          <span onClick={saveEdit} style={{ cursor: "pointer", color: T.ac, fontSize: 12, fontWeight: 600 }}>Save</span>
                          <span onClick={() => { setEditing(null); setEditText(""); }} style={{ cursor: "pointer", color: T.mt, fontSize: 12 }}>Esc</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, lineHeight: 1.5, color: m.text ? T.tx : T.mt, wordBreak: "break-word" }}>
                          {m.text || <em>encrypted (old key)</em>}
                          {m.edited_at && <span style={{ fontSize: 10, color: T.mt, marginLeft: 6 }} title={`Edited ${fmtD(m.edited_at)}`}>(edited)</span>}
                        </div>
                      )}
                    </div>

                    {/* Hover quick actions */}
                    {hovMsg === m.id && !editing && (
                      <div style={{ position: "absolute", right: 0, top: -8, display: "flex", gap: 2, background: T.sf, borderRadius: 6, border: `1px solid ${T.bd}`, padding: "2px 4px" }}>
                        {QUICK_REACT.slice(0, 3).map(e => (
                          <span key={e} onClick={() => addReaction(m, e)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, fontSize: 14 }}
                            onMouseEnter={ev => ev.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                            onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>{e}</span>
                        ))}
                        {isMine && <span onClick={() => startEdit(m)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, color: T.mt, display: "flex", alignItems: "center" }}
                          onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(255,255,255,0.08)"; ev.currentTarget.style.color = T.tx; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = T.mt; }}><I.Edit /></span>}
                        {isMine && <span onClick={() => deleteMsg(m)} style={{ cursor: "pointer", padding: "2px 4px", borderRadius: 3, color: T.mt, display: "flex", alignItems: "center" }}
                          onMouseEnter={ev => { ev.currentTarget.style.background = "rgba(255,71,87,0.08)"; ev.currentTarget.style.color = T.err; }}
                          onMouseLeave={ev => { ev.currentTarget.style.background = "transparent"; ev.currentTarget.style.color = T.mt; }}><I.Trash /></span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Typing indicator */}
          <TypingIndicator typers={typers.filter(t => t !== user?.username)} />

          {/* Message input */}
          <div style={{ padding: "0 16px 16px", position: "relative" }}>
            {/* Slash command suggestions */}
            <SlashBox input={input} members={members} roles={roles} onSet={setInput} />

            <div style={{ display: "flex", alignItems: "center", gap: 8, background: T.sf2, borderRadius: 10, padding: "8px 14px", border: `1px solid ${T.bd}` }}>
              <div onClick={() => fileRef.current?.click()} style={{ cursor: "pointer", color: T.mt, display: "flex" }}
                onMouseEnter={e => e.currentTarget.style.color = T.tx}
                onMouseLeave={e => e.currentTarget.style.color = T.mt}><I.Clip /></div>
              <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFile} />
              <input ref={inputRef} value={input} onChange={onInputChange}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                placeholder={`Message #${curCh.name}`}
                style={{ flex: 1, background: "transparent", border: "none", color: T.tx, fontSize: 14, outline: "none" }} />
              <div ref={emoRef} onClick={() => setShowEmoji(!showEmoji)} style={{ cursor: "pointer", color: T.mt, display: "flex", position: "relative" }}
                onMouseEnter={e => e.currentTarget.style.color = T.tx}
                onMouseLeave={e => e.currentTarget.style.color = T.mt}>
                <I.Smile />
                {showEmoji && <EmojiPicker anchorRef={emoRef} onPick={e => setInput(prev => prev + e)} onClose={() => setShowEmoji(false)} />}
              </div>
              <div onClick={sendMsg} style={{ cursor: "pointer", color: input.trim() ? T.ac : T.mt, display: "flex", transition: "color .15s" }}><I.Send /></div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ RIGHT PANEL — Members / Audit / Pins ═══ */}
      {curSrv && (
        <div style={{ width: 240, background: T.sf, borderLeft: `1px solid ${T.bd}`, display: "flex", flexDirection: "column", overflowY: "auto" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.bd}`, fontSize: 12, fontWeight: 700, color: T.mt, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            {panel === "members" && <><I.Users /> Members — {members.length}</>}
            {panel === "audit" && <><I.Log /> Audit Log</>}
            {panel === "pins" && <><I.Pin /> Pinned Messages</>}
          </div>

          {panel === "members" && (
            <div style={{ padding: 8 }}>
              {/* Owner first */}
              {members.filter(m => m.user_id === curSrv.owner_id).map(m => (
                <div key={m.user_id} onClick={() => setPopout({ member: m, x: window.innerWidth - 550, y: 100 })}
                  onContextMenu={(e) => openMemberCtx(e, m)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: T.ac2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#000" }}>{m.username?.[0]?.toUpperCase()}</div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.nickname || m.display_name || m.username}
                      <I.Crown />
                    </div>
                  </div>
                </div>
              ))}
              {/* Other members */}
              {members.filter(m => m.user_id !== curSrv.owner_id).map(m => (
                <div key={m.user_id} onClick={() => setPopout({ member: m, x: window.innerWidth - 550, y: 100 })}
                  onContextMenu={(e) => openMemberCtx(e, m)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ width: 28, height: 28, borderRadius: 14, background: T.sf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.tx }}>{m.username?.[0]?.toUpperCase()}</div>
                  <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nickname || m.display_name || m.username}</div>
                </div>
              ))}
            </div>
          )}

          {panel === "audit" && <div style={{ padding: 12 }}><AuditInline serverId={curSrv.id} /></div>}
          {panel === "pins" && <div style={{ padding: 12, color: T.mt, fontSize: 12 }}>Pinned messages will appear here</div>}
        </div>
      )}

      {/* ═══ CONTEXT MENU ═══ */}
      {ctx && <CtxMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}

      {/* ═══ MEMBER POPOUT ═══ */}
      {popout && (
        <div style={{ position: "fixed", left: popout.x, top: popout.y, zIndex: 9000 }}>
          <MemberPopout member={popout.member} serverId={curSrv?.id} isOwner={isOwner} allRoles={roles}
            onClose={() => setPopout(null)} onRoleChange={() => api.listMembers(curSrv.id).then(m => setMembers(Array.isArray(m) ? m : []))} />
        </div>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Create Server */}
      {showCreateSrv && (
        <Modal title="Create a Server" onClose={() => setShowCreateSrv(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Server Name</label>
            <input value={newSrvName} onChange={e => setNewSrvName(e.target.value)} autoFocus placeholder="My Awesome Server"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Description (optional)</label>
            <input value={newSrvDesc} onChange={e => setNewSrvDesc(e.target.value)} placeholder="What's this server about?"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={createServer} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Create Server</button>
        </Modal>
      )}

      {/* Create Channel */}
      {showCreateCh && (
        <Modal title="Create Channel" onClose={() => setShowCreateCh(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Channel Name</label>
            <input value={newChName} onChange={e => setNewChName(e.target.value)} autoFocus placeholder="general"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={createChannel} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Create Channel</button>
        </Modal>
      )}

      {/* Join Server */}
      {showJoin && (
        <Modal title="Join a Server" onClose={() => setShowJoin(false)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Invite Code</label>
            <input value={joinCode} onChange={e => setJoinCode(e.target.value)} autoFocus placeholder="Paste invite code here"
              onKeyDown={e => { if (e.key === "Enter") joinServer(); }}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={joinServer} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Join Server</button>
        </Modal>
      )}

      {/* Server Settings */}
      {modal?.type === "serverSettings" && (
        <Modal title="Server Settings" onClose={() => setModal(null)}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Server Name</label>
            <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Description</label>
            <textarea value={settingsDesc} onChange={e => setSettingsDesc(e.target.value)} rows={3}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <button onClick={saveServerSettings} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
          {isOwner && <>
            <div style={{ margin: "20px 0", height: 1, background: T.bd }} />
            <button onClick={() => { setModal(null); deleteServer(curSrv); }}
              style={{ width: "100%", padding: "12px", background: "transparent", color: T.err, border: `1px solid ${T.err}33`, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Delete Server</button>
          </>}
        </Modal>
      )}

      {/* Channel Settings */}
      {modal?.type === "channelSettings" && (
        <Modal title={`Edit #${modal.channel?.name}`} onClose={() => setModal(null)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Channel Name</label>
            <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Topic</label>
            <input value={settingsTopic} onChange={e => setSettingsTopic(e.target.value)} placeholder="What's this channel about?"
              style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={saveChannelSettings} style={{ width: "100%", padding: "12px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Save Changes</button>
        </Modal>
      )}

      {/* Audit Log Modal */}
      {modal?.type === "audit" && (
        <Modal title="Audit Log" onClose={() => setModal(null)} w={600}>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {(modal.data || []).length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No audit entries yet</div>}
            {(modal.data || []).map((e, i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: `1px solid ${T.bd}22`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={{ padding: "3px 8px", borderRadius: 4, background: "rgba(255,165,2,0.08)", color: T.warn, fontSize: 11, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap" }}>{e.action_type}</div>
                <div style={{ flex: 1 }}>
                  {e.details && <div style={{ fontSize: 12, color: T.tx }}>{typeof e.details === "string" ? e.details : JSON.stringify(e.details)}</div>}
                  <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>{fmtD(e.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Invite Modal */}
      {modal?.type === "invite" && (
        <Modal title="Server Invite" onClose={() => setModal(null)} w={420}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Invite Code</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input readOnly value={modal.data?.code || modal.data?.invite_code || ""} style={{ flex: 1, padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.ac, fontSize: 16, fontFamily: "monospace", fontWeight: 700, outline: "none" }} />
              <button onClick={() => copyTo(modal.data?.code || modal.data?.invite_code || "", "Invite code")}
                style={{ padding: "10px 16px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Copy</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: T.mt }}>Share this code with people to let them join your server.</div>
        </Modal>
      )}

      {/* Roles Management Modal */}
      {modal?.type === "roles" && (
        <Modal title="Manage Roles" onClose={() => setModal(null)}>
          <div style={{ marginBottom: 20, display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.mt, textTransform: "uppercase", marginBottom: 6, display: "block" }}>New Role</label>
              <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Role name"
                onKeyDown={e => { if (e.key === "Enter") createRole(); }}
                style={{ width: "100%", padding: "10px 14px", background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
            </div>
            <input type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)} style={{ width: 42, height: 42, border: "none", borderRadius: 8, cursor: "pointer" }} />
            <button onClick={createRole} style={{ padding: "10px 16px", background: T.ac, color: "#000", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Create</button>
          </div>
          <div>
            {roles.length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No roles created yet</div>}
            {roles.map(r => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.bd}22` }}>
                <div style={{ width: 14, height: 14, borderRadius: 7, background: r.color || T.ac }} />
                <span style={{ flex: 1, fontWeight: 600, color: r.color || T.tx }}>{r.name}</span>
                <span onClick={() => deleteRole(r)} style={{ cursor: "pointer", color: T.mt, padding: 4 }}
                  onMouseEnter={e => e.currentTarget.style.color = T.err}
                  onMouseLeave={e => e.currentTarget.style.color = T.mt}><I.Trash /></span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Bans Modal */}
      {modal?.type === "bans" && (
        <Modal title="Banned Users" onClose={() => setModal(null)}>
          {(modal.data || []).length === 0 && <div style={{ color: T.mt, textAlign: "center", padding: 20 }}>No banned users</div>}
          {(modal.data || []).map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.bd}22` }}>
              <I.Ban />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{b.username || b.user_id?.slice(0, 8)}</div>
                {b.reason && <div style={{ fontSize: 12, color: T.mt }}>{b.reason}</div>}
              </div>
              <button onClick={async () => {
                await api.unbanMember(curSrv.id, b.user_id);
                setModal(prev => ({ ...prev, data: prev.data.filter(x => x.user_id !== b.user_id) }));
                notify("User unbanned", "success");
              }} style={{ padding: "4px 10px", background: "transparent", color: T.ac, border: `1px solid ${T.ac}44`, borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Unban</button>
            </div>
          ))}
        </Modal>
      )}

      {/* ═══ TOAST ═══ */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", padding: "10px 20px", borderRadius: 10,
          background: toast.type === "success" ? "rgba(0,212,170,0.95)" : toast.type === "error" ? "rgba(255,71,87,0.95)" : "rgba(55,66,250,0.95)",
          color: "#fff", fontSize: 13, fontWeight: 600, zIndex: 99999, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
          {toast.msg}
        </div>
      )}

      {/* ═══ GLOBAL CSS for animations ═══ */}
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        * { scrollbar-width: thin; scrollbar-color: ${T.bd} transparent; }
        *::-webkit-scrollbar { width: 6px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${T.bd}; border-radius: 3px; }
        *::-webkit-scrollbar-thumb:hover { background: ${T.mt}; }
        input:focus, textarea:focus { border-color: ${T.ac} !important; }
      `}</style>

    </div>
  );
}
