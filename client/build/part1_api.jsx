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
