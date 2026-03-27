/**
 * CitadelAPI — REST + WebSocket client for the Discreet backend.
 * 
 * Extracted from client/index.html monolith for the Vite migration.
 * This is the single source of truth for all API communication.
 */

const API_BASE = import.meta.env.VITE_API_URL || (window.location.origin + '/api/v1');
const WS_BASE = (() => {
  if (import.meta.env.VITE_API_URL) {
    try { return new URL(import.meta.env.VITE_API_URL).origin.replace(/^http/, 'ws'); }
    catch { /* fall through */ }
  }
  return window.location.origin.replace(/^http/, 'ws');
})();

// ── Storage abstraction ──────────────────────────────────────────────────────
// Falls back localStorage → sessionStorage → in-memory if storage is blocked.

function _detectStorage(): Storage | null {
  const key = '__d_storage_test__';
  try { localStorage.setItem(key, '1'); localStorage.removeItem(key); return localStorage; } catch {}
  try { sessionStorage.setItem(key, '1'); sessionStorage.removeItem(key); return sessionStorage; } catch {}
  return null;
}

const _backingStorage = _detectStorage();

/** True when neither localStorage nor sessionStorage is available. */
export const storageBlocked = _backingStorage === null;

// Thin wrapper so the rest of the code never touches localStorage directly.
const _memFallback: Record<string, string> = {};
export const _storage = {
  getItem(k: string): string | null {
    if (_backingStorage) return _backingStorage.getItem(k);
    return _memFallback[k] ?? null;
  },
  setItem(k: string, v: string): void {
    if (_backingStorage) _backingStorage.setItem(k, v);
    else _memFallback[k] = v;
  },
  removeItem(k: string): void {
    if (_backingStorage) _backingStorage.removeItem(k);
    else delete _memFallback[k];
  },
};

type WsListener = (data: any) => void;

// ── Debug API logger ────────────────────────────────────────────────────────
export interface DebugApiEvent {
  method: string;
  url: string;
  status: number;
  latency: number;
  timestamp: number;
}

type DebugApiListener = (event: DebugApiEvent) => void;
const _debugListeners = new Set<DebugApiListener>();
export const debugApi = {
  subscribe(fn: DebugApiListener) { _debugListeners.add(fn); return () => { _debugListeners.delete(fn); }; },
  _emit(e: DebugApiEvent) { _debugListeners.forEach(fn => fn(e)); },
};

export class CitadelAPI {
  token: string | null;
  refreshToken: string | null; // kept for mobile compat; web uses HttpOnly cookie
  userId: string | null;
  username: string | null;
  ws: WebSocket | null;
  wsListeners: Set<WsListener>;
  private _userCache: Record<string, any>;
  private _wsServerId: string | null;
  private _wsReconnectTimer: ReturnType<typeof setTimeout> | null;
  private _wsReconnectAttempt: number;
  private _wsManualClose: boolean;

  get baseUrl(): string { return API_BASE; }

  constructor() {
    // Access token is memory-only (NOT persisted) for XSS protection.
    // Refresh token lives in an HttpOnly cookie set by the server.
    this.token = null;
    this.refreshToken = null;
    this.userId = _storage.getItem('d_uid');
    this.username = _storage.getItem('d_uname');
    this.ws = null;
    this.wsListeners = new Set();
    this._userCache = {};
    this._wsServerId = null;
    this._wsReconnectTimer = null;
    this._wsReconnectAttempt = 0;
    this._wsManualClose = false;

    // Warn if cookies are not writable (privacy browsers, iframe sandboxing)
    try {
      document.cookie = '_d_test=1; SameSite=Strict; Path=/; Max-Age=0';
      if (!document.cookie.includes('_d_test')) {
        // Cookies not writable — CSRF will rely on Bearer-only auth
      }
    } catch {
      // document.cookie inaccessible — CSRF will rely on Bearer-only auth
    }
  }

  setAuth(access: string, refresh: string, userId: string, username?: string) {
    this.token = access;
    this.refreshToken = null; // web ignores body refresh token; cookie handles it
    this.userId = userId;
    this.username = username || userId;
    // Only persist non-secret identifiers.
    _storage.setItem('d_uid', userId);
    if (username) _storage.setItem('d_uname', username);
    // Clean up legacy localStorage tokens from older versions.
    _storage.removeItem('d_tok');
    _storage.removeItem('d_ref');
  }

  clearAuth() {
    this.token = null;
    this.refreshToken = null;
    this.userId = null;
    this.username = null;
    this.disconnectWs(); // Close WebSocket on auth clear
    ['d_tok', 'd_ref', 'd_uid', 'd_uname'].forEach(k => _storage.removeItem(k));
    this.disconnectWs();
  }

  private getCsrfToken(): string | null {
    const entry = document.cookie.split(';').find(c => c.trim().startsWith('csrf_token='));
    return entry ? entry.trim().slice('csrf_token='.length) : null;
  }

  async fetch(path: string, opts: RequestInit & { headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = this.getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const _t0 = performance.now();
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers, credentials: 'same-origin' });
    debugApi._emit({ method, url: path, status: res.status, latency: Math.round(performance.now() - _t0), timestamp: Date.now() });
    if (res.status === 503) {
      try {
        const clone = res.clone();
        const body = await clone.json();
        if (body.maintenance) {
          this.wsListeners.forEach(fn => fn({ type: 'maintenance_mode', message: body.error || 'Discreet is undergoing scheduled maintenance.' }));
        }
      } catch { /* not maintenance JSON */ }
      return res;
    }
    if (res.status === 401 && this.userId) {
      const ok = await this.tryRefresh();
      if (ok) {
        headers['Authorization'] = `Bearer ${this.token}`;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          const csrf = this.getCsrfToken();
          if (csrf) headers['X-CSRF-Token'] = csrf;
        }
        return fetch(`${API_BASE}${path}`, { ...opts, headers, credentials: 'same-origin' });
      }
    }
    return res;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      // Refresh token is in HttpOnly cookie — sent automatically with credentials.
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });
      if (res.ok) {
        const d = await res.json();
        this.token = d.access_token;
        return true;
      }
    } catch {}
    this.clearAuth();
    return false;
  }

  // ── Auth ──
  async register(u: string, p: string, e?: string, dob?: string) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, email: e || undefined, date_of_birth: dob || undefined, device_name: 'web', accepted_terms_at: new Date().toISOString() }),
    });
    const d = await res.json();
    if (res.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async registerAnonymous(username: string, fingerprintHash?: string, turnstileToken?: string) {
    const res = await fetch(`${API_BASE}/auth/register-anonymous`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, fingerprint_hash: fingerprintHash || undefined, turnstile_token: turnstileToken || undefined }),
    });
    const d = await res.json();
    if (res.ok) this.setAuth(d.access_token, d.refresh_token, d.user_id, username);
    return { ok: res.ok, data: d };
  }

  async loginAnonymous(username: string, recoveryPhrase: string) {
    const res = await fetch(`${API_BASE}/auth/login-anonymous`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, recovery_phrase: recoveryPhrase }),
      credentials: 'same-origin',
    });
    const d = await res.json();
    if (res.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async verifyCode(code: string) {
    const res = await this.authFetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const d = await res.json();
    if (res.ok && d.access_token) this.token = d.access_token;
    return { ok: res.ok, data: d };
  }

  async resendCode() {
    const res = await this.authFetch(`${API_BASE}/auth/resend-code`, { method: 'POST' });
    return { ok: res.ok, data: await res.json() };
  }

  async login(u: string, p: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: u, password: p, device_name: 'web' }),
    });
    const d = await res.json();
    if (res.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async logout() { await this.fetch('/auth/logout', { method: 'POST' }); this.clearAuth(); }

  async registerGuest() {
    const res = await fetch(`${API_BASE}/auth/guest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    const d = await res.json();
    if (res.ok && d.access_token) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async forgotPassword(email: string) {
    const r = await fetch(`${API_BASE}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || 'Request failed');
    return d;
  }
  async resetPassword(token: string, newPassword: string) {
    const r = await fetch(`${API_BASE}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, new_password: newPassword }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || 'Request failed');
    return d;
  }

  // ── Passkeys (WebAuthn) ──
  async passkeyRegisterStart() { return (await this.fetch('/auth/passkey/register/start', { method: 'POST' })).json(); }
  async passkeyRegisterFinish(credential: any, name?: string) { return (await this.fetch('/auth/passkey/register/finish', { method: 'POST', body: JSON.stringify({ credential, name }) })).json(); }
  async passkeyLoginStart(username: string) {
    const r = await fetch(`${API_BASE}/auth/passkey/login/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    return { ok: r.ok, data: await r.json() };
  }
  async passkeyLoginFinish(username: string, credential: any) {
    const r = await fetch(`${API_BASE}/auth/passkey/login/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, credential }), credentials: 'same-origin' });
    const d = await r.json();
    if (r.ok) this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: r.ok, data: d };
  }
  async passkeyList() { return (await this.fetch('/auth/passkey/list')).json(); }
  async passkeyDelete(id: string) { return (await this.fetch(`/auth/passkey/${id}`, { method: 'DELETE' })).json(); }

  // ── Servers ──
  async listServers() { return (await this.fetch('/servers')).json(); }
  async createServer(name: string, opts?: { enable_automod?: boolean }) { return (await this.fetch('/servers', { method: 'POST', body: JSON.stringify({ name, ...opts }) })).json(); }
  async createInvite(sid: string, opts?: { expires_at?: string | null; max_uses?: number | null; temporary?: boolean }) {
    const body: any = { temporary: opts?.temporary ?? false };
    if (opts && 'expires_at' in opts) body.expires_at = opts.expires_at;  // send null explicitly for "Never"
    if (opts?.max_uses != null) body.max_uses = opts.max_uses;
    return (await this.fetch(`/servers/${sid}/invites`, { method: 'POST', body: JSON.stringify(body) })).json();
  }
  async listInvites(sid: string) { try { const r = await this.fetch(`/servers/${sid}/invites`); return r.ok ? r.json() : []; } catch { return []; } }
  async revokeInvite(sid: string, code: string) { return this.fetch(`/servers/${sid}/invites/${code}`, { method: 'DELETE' }); }
  async joinServer(sid: string, code: string) { return this.fetch(`/servers/${sid}/join`, { method: 'POST', body: JSON.stringify({ invite_code: code }) }); }
  async resolveInvite(code: string) { const r = await this.fetch(`/invites/${code}`); if (!r.ok) throw new Error('Invalid invite'); return r.json(); }
  async listMembers(sid: string) { return (await this.fetch(`/servers/${sid}/members`)).json(); }
  async setNickname(sid: string, uid: string, nickname: string | null) { return this.fetch(`/servers/${sid}/members/${uid}/nickname`, { method: 'PUT', body: JSON.stringify({ nickname }) }); }
  async updateServer(sid: string, data: any) { return this.fetch(`/servers/${sid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteServer(sid: string) { return this.fetch(`/servers/${sid}`, { method: 'DELETE' }); }
  async leaveServer(sid: string) { return this.fetch(`/servers/${sid}/leave`, { method: 'POST' }); }
  async setServerNotificationLevel(sid: string, level: string) { return this.fetch(`/servers/${sid}/notification-level`, { method: 'PATCH', body: JSON.stringify({ notification_level: level }) }); }
  async setServerVisibility(sid: string, override_: string | null) { return this.fetch(`/servers/${sid}/visibility`, { method: 'PATCH', body: JSON.stringify({ visibility_override: override_ }) }); }

  // ── Channels + Categories ──
  async listChannels(sid: string) { return (await this.fetch(`/servers/${sid}/channels`)).json(); }
  async createChannel(sid: string, name: string, catId?: string | null, chType?: string) { return (await this.fetch(`/servers/${sid}/channels`, { method: 'POST', body: JSON.stringify({ name, channel_type: chType || 'text', category_id: catId || undefined }) })).json(); }
  async listCategories(sid: string) { try { const r = await this.fetch(`/servers/${sid}/categories`); if (!r.ok) return []; return r.json(); } catch { return []; } }
  async updateChannel(cid: string, data: any) { return this.fetch(`/channels/${cid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteChannel(cid: string) { return this.fetch(`/channels/${cid}`, { method: 'DELETE' }); }
  async archiveChannel(cid: string) { const r = await this.fetch(`/channels/${cid}/archive`, { method: 'POST' }); if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to archive' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); } }
  async unarchiveChannel(cid: string) { const r = await this.fetch(`/channels/${cid}/unarchive`, { method: 'POST' }); if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to unarchive' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); } }
  async transferServer(sid: string, newOwnerId: string) {
    const r = await this.fetch(`/servers/${sid}/transfer`, { method: 'POST', body: JSON.stringify({ new_owner_id: newOwnerId }) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Transfer failed' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
  }

  // ── Messages ──
  async sendMessage(cid: string, ct: string, ep: number, replyId?: string, parentId?: string, mentionedIds?: string[], priority?: string) { return (await this.fetch(`/channels/${cid}/messages`, { method: 'POST', body: JSON.stringify({ content_ciphertext: ct, mls_epoch: ep, reply_to_id: replyId || undefined, parent_message_id: parentId || undefined, mentioned_user_ids: mentionedIds?.length ? mentionedIds : undefined, priority: priority || undefined }) })).json(); }
  async ackMessage(mid: string) { return (await this.fetch(`/messages/${mid}/ack`, { method: 'POST' })).json(); }
  async getAcks(mid: string) { try { const r = await this.fetch(`/messages/${mid}/acks`); return r.ok ? r.json() : null; } catch { return null; } }
  async getMessages(cid: string, limit = 50) { return (await this.fetch(`/channels/${cid}/messages?limit=${limit}`)).json(); }
  async editMessage(mid: string, content: string, epoch: number) { return this.fetch(`/messages/${mid}`, { method: 'PATCH', body: JSON.stringify({ content_ciphertext: content, mls_epoch: epoch }) }); }
  async deleteMessage(mid: string) { return this.fetch(`/messages/${mid}`, { method: 'DELETE' }); }
  async bulkDeleteMessages(cid: string, ids: string[], reason?: string) { return (await this.fetch(`/channels/${cid}/messages/bulk-delete`, { method: 'POST', body: JSON.stringify({ message_ids: ids, reason }) })).json(); }
  async getMessagesBatch(cid: string, limit = 200, before?: string) { const params = [`limit=${limit}`]; if (before) params.push(`before=${before}`); try { const r = await this.fetch(`/channels/${cid}/messages?${params.join('&')}`); return r.ok ? r.json() : []; } catch { return []; } }
  async searchMessages(cid: string, q: string, limit = 50) { return (await this.fetch(`/channels/${cid}/messages/search?q=${encodeURIComponent(q)}&limit=${limit}`)).json(); }
  async getThreadReplies(mid: string) { return (await this.fetch(`/messages/${mid}/thread`)).json(); }

  // ── Roles ──
  async listRoles(sid: string) { try { const r = await this.fetch(`/servers/${sid}/roles`); return r.ok ? r.json() : []; } catch { return []; } }
  async createRole(sid: string, name: string, color: string, permissions: number) { return this.fetch(`/servers/${sid}/roles`, { method: 'POST', body: JSON.stringify({ name, color, permissions }) }); }
  async updateRole(rid: string, data: any) { return this.fetch(`/roles/${rid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteRole(sid: string, rid: string) { return this.fetch(`/roles/${rid}`, { method: 'DELETE' }); }
  async assignRole(sid: string, uid: string, rid: string) { return this.fetch(`/servers/${sid}/members/${uid}/roles/${rid}`, { method: 'PUT' }); }
  async unassignRole(sid: string, uid: string, rid: string) { return this.fetch(`/servers/${sid}/members/${uid}/roles/${rid}`, { method: 'DELETE' }); }
  async listMemberRoles(sid: string, uid: string) { try { const r = await this.fetch(`/servers/${sid}/members/${uid}/roles`); return r.ok ? r.json() : []; } catch { return []; } }

  // ── Pins ──
  async listPins(sid: string, cid: string) { try { const r = await this.fetch(`/servers/${sid}/channels/${cid}/pins`); return r.ok ? r.json() : []; } catch { return []; } }
  async pinMessage(sid: string, cid: string, mid: string, category: string = 'important') { return this.fetch(`/servers/${sid}/channels/${cid}/pins/${mid}?category=${encodeURIComponent(category)}`, { method: 'POST' }); }
  async unpinMessage(sid: string, cid: string, mid: string) { return this.fetch(`/servers/${sid}/channels/${cid}/pins/${mid}`, { method: 'DELETE' }); }

  // ── Bans ──
  async listBans(sid: string) { try { const r = await this.fetch(`/servers/${sid}/bans`); return r.ok ? r.json() : []; } catch { return []; } }
  async banUser(sid: string, uid: string, reason?: string) { return this.fetch(`/servers/${sid}/bans`, { method: 'POST', body: JSON.stringify({ user_id: uid, reason: reason || null }) }); }
  async unbanUser(sid: string, uid: string) { return this.fetch(`/servers/${sid}/bans/${uid}`, { method: 'DELETE' }); }

  // ── Audit ──
  async getAuditLog(sid: string, limit = 50) { try { const r = await this.fetch(`/servers/${sid}/audit-log?limit=${limit}`); return r.ok ? r.json() : []; } catch { return []; } }
  async verifyAuditChain(sid: string) { try { const r = await this.fetch(`/servers/${sid}/audit-log/verify`); return r.ok ? r.json() : null; } catch { return null; } }

  // ── Emoji ──
  async listEmojis(sid: string) { try { const r = await this.fetch(`/servers/${sid}/emojis`); return r.ok ? r.json() : []; } catch { return []; } }
  async uploadEmoji(sid: string, name: string, imageData: string, animated = false) { return (await this.fetch(`/servers/${sid}/emojis`, { method: 'POST', body: JSON.stringify({ name, image_data: imageData, animated }) })).json(); }
  async deleteEmoji(sid: string, eid: string) { return this.fetch(`/servers/${sid}/emojis/${eid}`, { method: 'DELETE' }); }

  // ── DMs ──
  async listDms() { try { const r = await this.fetch('/dms'); return r.ok ? r.json() : []; } catch { return []; } }
  async createDm(uid: string) { return (await this.fetch('/dms', { method: 'POST', body: JSON.stringify({ recipient_id: uid }) })).json(); }
  async sendDm(dmId: string, ct: string, ep: number) { return (await this.fetch(`/dms/${dmId}/messages`, { method: 'POST', body: JSON.stringify({ content_ciphertext: ct, mls_epoch: ep }) })).json(); }
  async getDmMessages(dmId: string, limit = 50) { return (await this.fetch(`/dms/${dmId}/messages?limit=${limit}`)).json(); }
  async sendDmMessage(dmId: string, text: string) { return (await this.fetch(`/dms/${dmId}/messages`, { method: 'POST', body: JSON.stringify({ content: text }) })).json(); }
  async sendTyping(sid: string, cid: string) { return this.fetch(`/servers/${sid}/channels/${cid}/typing`, { method: 'POST' }); }
  async kickMember(sid: string, uid: string) { return this.fetch(`/servers/${sid}/members/${uid}`, { method: 'DELETE' }); }
  async timeoutMember(sid: string, uid: string, durationSecs: number) { return this.fetch(`/servers/${sid}/members/${uid}/timeout`, { method: 'POST', body: JSON.stringify({ duration: durationSecs }) }); }

  // ── Group DMs ──
  async listGroupDms() { try { const r = await this.fetch('/group-dms'); return r.ok ? r.json() : []; } catch { return []; } }
  async createGroupDm(name: string, memberIds: string[]) { return (await this.fetch('/group-dms', { method: 'POST', body: JSON.stringify({ name, member_ids: memberIds }) })).json(); }
  async sendGroupDm(gid: string, ct: string, replyId?: string) { return (await this.fetch(`/group-dms/${gid}/messages`, { method: 'POST', body: JSON.stringify({ content_ciphertext: ct, reply_to_id: replyId || undefined }) })).json(); }
  async getGroupDmMessages(gid: string, limit = 50, before?: string) { let q = `limit=${limit}`; if (before) q += `&before=${before}`; return (await this.fetch(`/group-dms/${gid}/messages?${q}`)).json(); }
  async addGroupDmMember(gid: string, uid: string) { return (await this.fetch(`/group-dms/${gid}/members`, { method: 'POST', body: JSON.stringify({ user_id: uid }) })).json(); }

  // ── Friends ──
  async listFriends() { try { const r = await this.fetch('/friends'); return r.ok ? r.json() : []; } catch { return []; } }
  async listIncomingRequests() { try { const r = await this.fetch('/friends/requests'); return r.ok ? r.json() : []; } catch { return []; } }
  async listOutgoingRequests() { try { const r = await this.fetch('/friends/outgoing'); return r.ok ? r.json() : []; } catch { return []; } }
  async sendFriendRequest(uid: string) { return this.fetch('/friends/request', { method: 'POST', body: JSON.stringify({ user_id: uid }) }); }
  async blockUser(uid: string) { return this.fetch(`/users/${uid}/block`, { method: 'POST' }); }
  async unblockUser(uid: string) { return this.fetch(`/users/${uid}/block`, { method: 'DELETE' }); }
  async closeDm(dmId: string) { return this.fetch(`/dms/${dmId}`, { method: 'DELETE' }); }
  async createPoll(cid: string, question: string, options: string[], duration?: number) { return (await this.fetch(`/channels/${cid}/polls`, { method: 'POST', body: JSON.stringify({ question, options, duration_seconds: duration || 86400 }) })).json(); }
  async votePoll(pollId: string, optionIndex: number) { return this.fetch(`/polls/${pollId}/vote`, { method: 'POST', body: JSON.stringify({ option_index: optionIndex }) }); }
  async getPoll(pollId: string) { try { return (await this.fetch(`/polls/${pollId}`)).json(); } catch { return null; } }
  async spawnBot(sid: string, opts: { persona: string; display_name?: string; system_prompt?: string }) { return (await this.fetch(`/servers/${sid}/ai-bots`, { method: 'POST', body: JSON.stringify(opts) })).json(); }
  async listBots(sid: string) { try { const r = await this.fetch(`/servers/${sid}/ai-bots`); return r.ok ? r.json() : []; } catch { return []; } }
  async updateBot(sid: string, bid: string, data: any) { return this.fetch(`/servers/${sid}/ai-bots/${bid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async getPinnedMessages(sid: string, cid: string) { try { return (await this.fetch(`/servers/${sid}/channels/${cid}/pins`)).json(); } catch { return []; } }
  async acceptFriend(id: string) { return this.fetch(`/friends/${id}/accept`, { method: 'POST' }); }
  async declineFriend(id: string) { return this.fetch(`/friends/${id}/decline`, { method: 'POST' }); }
  async removeFriend(id: string) { return this.fetch(`/friends/${id}`, { method: 'DELETE' }); }
  async searchUsers(q: string) { try { const r = await this.fetch(`/users/search?q=${encodeURIComponent(q)}`); return r.ok ? r.json() : []; } catch { return []; } }

  // ── QR Connect ──
  async getUserQrUrl(): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const r = await fetch(`${API_BASE}/users/@me/qr`, { headers, credentials: 'same-origin' });
    if (!r.ok) throw new Error(`QR generation failed (${r.status})`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }
  async getServerInviteQrUrl(serverId: string): Promise<string> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const r = await fetch(`${API_BASE}/servers/${serverId}/invite-qr`, { headers, credentials: 'same-origin' });
    if (!r.ok) throw new Error(`QR generation failed (${r.status})`);
    const blob = await r.blob();
    return URL.createObjectURL(blob);
  }
  async resolveConnectCode(code: string): Promise<{ type: string; target_id: string }> {
    const r = await this.fetch(`/connect/${code}`);
    if (!r.ok) throw new Error('Invalid or expired connect code');
    return r.json();
  }

  // ── TURN Credentials ──
  async getTurnCredentials(): Promise<{ urls: string[]; username?: string; credential?: string; ttl: number }> {
    try {
      const r = await this.fetch('/voice/turn-credentials');
      if (r.ok) return r.json();
    } catch { /* TURN fetch failed — caller falls back to STUN-only */ }
    return { urls: ['stun:stun.l.google.com:19302'], ttl: 0 };
  }

  // ── Voice Messages ──
  async sendVoiceMessage(channelId: string, audioBlob: Blob, durationMs: number, contentCiphertext: string, mlsEpoch: number, waveform?: number[]): Promise<any> {
    const form = new FormData();
    form.append('audio', new Blob([audioBlob], { type: 'audio/ogg' }), 'voice.ogg');
    form.append('duration_ms', String(durationMs));
    form.append('content_ciphertext', contentCiphertext);
    form.append('mls_epoch', String(mlsEpoch));
    if (waveform?.length) {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(waveform)));
      form.append('waveform', b64);
    }
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const csrf = this.getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const r = await fetch(`${API_BASE}/channels/${channelId}/voice`, { method: 'POST', headers, body: form, credentials: 'same-origin' });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Voice upload failed (${r.status}): ${t}`); }
    return r.json();
  }

  // ── Files ──
  async uploadFile(channelId: string, file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const r = await this.fetch(`/channels/${channelId}/files`, {
            method: 'POST',
            body: JSON.stringify({ encrypted_blob: base64, mime_type_hint: file.type || 'application/octet-stream', filename: file.name }),
          });
          if (!r.ok) { const err = await r.text().catch(() => ''); reject(new Error(`Upload failed (${r.status}): ${err}`)); return; }
          resolve(await r.json());
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async uploadDmFile(dmId: string, file: File): Promise<any> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const r = await this.fetch(`/dms/${dmId}/files`, {
            method: 'POST',
            body: JSON.stringify({ encrypted_blob: base64, mime_type_hint: file.type || 'application/octet-stream', filename: file.name }),
          });
          resolve(await r.json());
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async downloadFile(fid: string) { return (await this.fetch(`/files/${fid}`)).json(); }
  async deleteFile(fileId: string) { return this.fetch(`/files/${fileId}`, { method: 'DELETE' }); }

  // ── User / Profile ──
  async getUser(id: string) { if (this._userCache[id]) return this._userCache[id]; try { const r = await this.fetch(`/users/${id}`); if (!r.ok) return null; const d = await r.json(); if (d?.error) return null; this._userCache[id] = d; return d; } catch { return null; } }
  async updateProfile(data: any) { return this.fetch('/users/@me', { method: 'PATCH', body: JSON.stringify(data) }); }
  async getMe() { try { const r = await this.fetch('/users/@me'); if (!r.ok) return null; const d = await r.json(); return d?.error ? null : d; } catch { return null; } }
  /** Fetch a fresh access token with current claims. Call after upgrade/verify. */
  async refreshClaims() { try { const r = await this.fetch('/auth/me/refresh'); if (r.ok) { const d = await r.json(); if (d.access_token) this.token = d.access_token; return d; } return null; } catch { return null; } }
  async getPlatformMe() { try { const r = await this.fetch('/platform/me'); return r.ok ? r.json() : null; } catch { return null; } }
  async listBugReports(limit = 50, offset = 0) { try { const r = await this.fetch(`/admin/bug-reports?limit=${limit}&offset=${offset}`); return r.ok ? r.json() : { reports: [], total: 0 }; } catch { return { reports: [], total: 0 }; } }
  async getBillingStatus() { try { const r = await this.fetch('/billing/status'); return r.ok ? r.json() : null; } catch { return null; } }
  async complianceExport(serverId: string, startDate: string, endDate: string, format: string) { const r = await this.fetch('/admin/export', { method: 'POST', body: JSON.stringify({ server_id: serverId, start_date: startDate, end_date: endDate, format }) }); if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Export failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); } return r.json(); }
  async getSettings() { try { const r = await this.fetch('/users/@me/settings'); return r.ok ? r.json() : null; } catch { return null; } }
  async updateSettings(s: any) { return this.fetch('/users/@me/settings', { method: 'PUT', body: JSON.stringify(s) }); }
  async getChannelSettings(cid: string) { try { const r = await this.fetch(`/channels/${cid}/notification-settings`); return r.ok ? r.json() : null; } catch { return null; } }
  async updateChannelSettings(cid: string, s: any) { return this.fetch(`/channels/${cid}/notification-settings`, { method: 'PUT', body: JSON.stringify(s) }); }
  async saveTimezone(timezone: string) { return this.fetch('/settings/timezone', { method: 'POST', body: JSON.stringify({ timezone }) }); }
  /** Verify password and get a single-use reauth token (5 min TTL). */
  async verifyPassword(password: string): Promise<{ reauth_token: string; expires_in: number }> {
    const r = await this.fetch('/auth/verify-password', { method: 'POST', body: JSON.stringify({ password }) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Request failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); }
    return r.json();
  }
  async changeEmail(newEmail: string, password: string, reauthToken?: string) {
    const headers: Record<string, string> = {};
    if (reauthToken) headers['X-Reauth-Token'] = reauthToken;
    const r = await this.fetch('/users/@me/email', { method: 'PUT', headers, body: JSON.stringify({ new_email: newEmail, password }) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Request failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); } return r.json();
  }
  async changePassword(currentPassword: string, newPassword: string, reauthToken?: string) {
    const headers: Record<string, string> = {};
    if (reauthToken) headers['X-Reauth-Token'] = reauthToken;
    const r = await this.fetch('/users/@me/password', { method: 'POST', headers, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Request failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); } return r.json();
  }
  async listSessions() { try { const r = await this.fetch('/auth/sessions'); return r.ok ? r.json() : []; } catch { return []; } }
  async revokeSession(id: string) { const r = await this.fetch(`/auth/sessions/${id}`, { method: 'DELETE' }); if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Request failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); } }
  async initiateVerify(sessionId: string) { return (await this.fetch(`/auth/sessions/${sessionId}/verify`, { method: 'POST' })).json(); }
  async confirmVerify(sessionId: string) { return (await this.fetch(`/auth/sessions/${sessionId}/confirm`, { method: 'POST' })).json(); }
  async revokeAllOtherSessions(reauthToken?: string) {
    const headers: Record<string, string> = {};
    if (reauthToken) headers['X-Reauth-Token'] = reauthToken;
    const r = await this.fetch('/auth/sessions/all-others', { method: 'DELETE', headers });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Request failed' })); throw new Error(e.error || e.message || `HTTP ${r.status}`); } return r.json();
  }
  async deleteAccount(reauthToken?: string) {
    const headers: Record<string, string> = {};
    if (reauthToken) headers['X-Reauth-Token'] = reauthToken;
    return this.fetch('/users/@me', { method: 'DELETE', headers });
  }

  // ── Import ──
  async createImportJob(source: string, file: File): Promise<{ id: string }> {
    const form = new FormData();
    form.append('source', source);
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const csrf = this.getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const r = await fetch(`${API_BASE}/users/@me/import`, { method: 'POST', headers, body: form, credentials: 'same-origin' });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Import failed' } })); throw new Error(e.error?.message || e.error || `Import failed (${r.status})`); }
    return r.json();
  }
  async getImportJob(id: string) {
    const r = await this.fetch(`/users/@me/import/${id}`);
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Status check failed' } })); throw new Error(e.error?.message || e.error || `Status check failed (${r.status})`); }
    return r.json();
  }

  // ── Webhooks ──
  async listWebhooks(sid: string) { try { const r = await this.fetch(`/servers/${sid}/webhooks`); return r.ok ? r.json() : []; } catch { return []; } }
  async createWebhook(sid: string, data: { name: string; url: string; channel_id?: string; events: string[]; enabled?: boolean }) {
    const r = await this.fetch(`/servers/${sid}/webhooks`, { method: 'POST', body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to create webhook' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
    return r.json();
  }
  async updateWebhook(wid: string, data: { name?: string; url?: string; events?: string[]; enabled?: boolean }) {
    const r = await this.fetch(`/webhooks/${wid}`, { method: 'PUT', body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to update webhook' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
  }
  async deleteWebhook(wid: string) {
    const r = await this.fetch(`/webhooks/${wid}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to delete webhook' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
  }
  async testWebhook(sid: string, wid: string) {
    const r = await this.fetch(`/servers/${sid}/webhooks/${wid}/test`, { method: 'POST' });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Test failed' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
    return r.json();
  }

  // ── Bots ──
  async createBot(sid: string, data: any) { return (await this.fetch(`/servers/${sid}/ai-bots`, { method: 'POST', body: JSON.stringify(data) })).json(); }
  async updateBotConfig(sid: string, bid: string, data: any) { return this.fetch(`/servers/${sid}/ai-bots/${bid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async removeBotFromServer(sid: string, bid: string) { return this.fetch(`/servers/${sid}/ai-bots/${bid}`, { method: 'DELETE' }); }
  async getAgentConfig(sid: string, bid: string) { try { const r = await this.fetch(`/servers/${sid}/ai-bots/${bid}/config`); return r.ok ? r.json() : null; } catch { return null; } }
  async putAgentConfig(sid: string, bid: string, data: any) { const r = await this.fetch(`/servers/${sid}/ai-bots/${bid}/config`, { method: 'PUT', body: JSON.stringify(data) }); return r.ok ? r.json() : null; }
  async deleteAgentMemory(sid: string, bid: string) { const r = await this.fetch(`/servers/${sid}/ai-bots/${bid}/memory`, { method: 'DELETE' }); return r.ok ? r.json() : null; }

  // ── Reactions ──
  async addReaction(cid: string, mid: string, emoji: string) { return this.fetch(`/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}`, { method: 'PUT' }); }
  async removeReaction(cid: string, mid: string, emoji: string) { return this.fetch(`/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); }

  // ── Typing ──
  async startTyping(sid: string, cid: string) { try { await this.fetch(`/servers/${sid}/channels/${cid}/typing`, { method: 'POST' }); } catch {} }

  // ── Events ──
  async listEvents(sid: string) { try { const r = await this.fetch(`/servers/${sid}/events`); return r.ok ? r.json() : []; } catch { return []; } }
  async createEvent(sid: string, data: any) { return (await this.fetch(`/servers/${sid}/events`, { method: 'POST', body: JSON.stringify(data) })).json(); }
  async rsvpEvent(eid: string, status: string) { return (await this.fetch(`/events/${eid}/rsvp`, { method: 'POST', body: JSON.stringify({ status }) })).json(); }

  // ── Notifications ──
  async listNotifications(limit = 50, before?: string) { try { const params = new URLSearchParams({ limit: String(limit) }); if (before) params.set('before', before); const r = await this.fetch(`/notifications?${params}`); return r.ok ? r.json() : []; } catch { return []; } }
  async getUnreadNotificationCount() { try { const r = await this.fetch('/notifications/unread-count'); if (r.ok) { const d = await r.json(); return d.unread_count ?? 0; } return 0; } catch { return 0; } }
  async markNotificationRead(id: string) { try { await this.fetch(`/notifications/${id}/read`, { method: 'PATCH' }); } catch {} }
  async markAllNotificationsRead() { try { await this.fetch('/notifications/read-all', { method: 'POST' }); } catch {} }

  // ── Bookmarks ──
  async createBookmark(messageId: string, channelId: string, serverId: string, note?: string) { return (await this.fetch('/bookmarks', { method: 'POST', body: JSON.stringify({ message_id: messageId, channel_id: channelId, server_id: serverId, note: note || undefined }) })).json(); }
  async listBookmarks(limit = 50, before?: string) { try { const params = new URLSearchParams({ limit: String(limit) }); if (before) params.set('before', before); const r = await this.fetch(`/bookmarks?${params}`); return r.ok ? r.json() : []; } catch { return []; } }
  async deleteBookmark(messageId: string) { return this.fetch(`/bookmarks/${messageId}`, { method: 'DELETE' }); }

  // ── AutoMod ──
  async getAutomod(sid: string) { try { const r = await this.fetch(`/servers/${sid}/automod`); return r.ok ? r.json() : null; } catch { return null; } }
  async updateAutomod(sid: string, config: any) { return this.fetch(`/servers/${sid}/automod`, { method: 'PUT', body: JSON.stringify(config) }); }

  // ── Discovery ──
  async discoverServers(query?: string, category?: string) { try { const params = new URLSearchParams(); if (query) params.set('q', query); if (category && category !== 'all') params.set('category', category); const r = await this.fetch(`/discover?${params}`); return r.ok ? r.json() : []; } catch { return []; } }
  async publishServer(serverId: string, category: string, tags: string[]) { return this.fetch(`/servers/${serverId}/publish`, { method: 'POST', body: JSON.stringify({ category, tags }) }); }
  async unpublishServer(serverId: string) { return this.fetch(`/servers/${serverId}/publish`, { method: 'DELETE' }); }

  // ── Threads ──
  async createThread(channelId: string, parentMessageId: string, title?: string) { return (await this.fetch(`/channels/${channelId}/threads`, { method: 'POST', body: JSON.stringify({ parent_message_id: parentMessageId, title: title || undefined }) })).json(); }
  async listThreads(channelId: string) { try { const r = await this.fetch(`/channels/${channelId}/threads`); return r.ok ? r.json() : []; } catch { return []; } }
  async listThreadMessages(threadId: string) { try { const r = await this.fetch(`/threads/${threadId}/messages`); return r.ok ? r.json() : []; } catch { return []; } }
  async sendThreadMessage(threadId: string, content: string) { return (await this.fetch(`/threads/${threadId}/messages`, { method: 'POST', body: JSON.stringify({ content }) })).json(); }

  // ── Meetings ──
  async createMeeting(title: string, password?: string) { return (await this.fetch('/meetings', { method: 'POST', body: JSON.stringify({ title, password: password || undefined }) })).json(); }
  async getMeeting(code: string) { try { const r = await this.fetch(`/meetings/${code}`); return r.ok ? r.json() : null; } catch { return null; } }
  async joinMeeting(code: string, password?: string) { return (await this.fetch(`/meetings/${code}/join`, { method: 'POST', body: JSON.stringify({ password: password || undefined }) })).json(); }

  // ── MLS Key Distribution (RFC 9420) ──
  async uploadKeyPackages(packages: string[]) { return (await this.fetch('/key-packages', { method: 'POST', body: JSON.stringify({ key_packages: packages }) })).json(); }
  async claimKeyPackage(userId: string) { return (await this.fetch(`/key-packages/${userId}`)).json(); }
  async submitMlsCommit(channelId: string, commit: string, epoch: number) { return this.fetch(`/channels/${channelId}/mls/commit`, { method: 'POST', body: JSON.stringify({ commit, epoch }) }); }
  async relayMlsWelcome(channelId: string, welcome: string, targetUserId: string) { return this.fetch(`/channels/${channelId}/mls/welcome`, { method: 'POST', body: JSON.stringify({ welcome, target_user_id: targetUserId }) }); }
  async getMlsInfo(channelId: string) { try { const r = await this.fetch(`/channels/${channelId}/mls/info`); return r.ok ? r.json() : null; } catch { return null; } }
  async uploadIdentityKey(signingKey: string, identityKey: string, deviceId?: string) { return this.fetch('/identity-keys', { method: 'POST', body: JSON.stringify({ signing_key: signingKey, identity_key: identityKey, device_id: deviceId || 'primary' }) }); }

  // ── Reports ──
  async submitReport(messageId: string, reason: string, details?: string) { return (await this.fetch('/reports', { method: 'POST', body: JSON.stringify({ message_id: messageId, reason, details: details || undefined }) })).json(); }
  async listReports(status = 'open', limit = 50, offset = 0) { try { const r = await this.fetch(`/admin/reports?status=${status}&limit=${limit}&offset=${offset}`); return r.ok ? r.json() : []; } catch { return []; } }
  async resolveReport(reportId: string, status: string) { return (await this.fetch(`/admin/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify({ status }) })).json(); }

  // ── Playbooks ──
  async listPlaybooks(sid: string) { try { const r = await this.fetch(`/servers/${sid}/playbooks`); return r.ok ? r.json() : []; } catch { return []; } }
  async createPlaybook(sid: string, data: { name: string; description?: string; steps?: { title: string; assignee_id?: string }[] }) { return (await this.fetch(`/servers/${sid}/playbooks`, { method: 'POST', body: JSON.stringify(data) })).json(); }
  async getPlaybook(pid: string) { try { const r = await this.fetch(`/playbooks/${pid}`); return r.ok ? r.json() : null; } catch { return null; } }
  async deletePlaybook(pid: string) { return this.fetch(`/playbooks/${pid}`, { method: 'DELETE' }); }
  async addPlaybookStep(pid: string, data: { title: string; assignee_id?: string }) { return (await this.fetch(`/playbooks/${pid}/steps`, { method: 'POST', body: JSON.stringify(data) })).json(); }
  async completePlaybookStep(pid: string, stepId: string) { return (await this.fetch(`/playbooks/${pid}/steps/${stepId}/complete`, { method: 'PATCH' })).json(); }

  // ── Channel Categories (user-level folders) ──
  async listChannelCategories(sid: string) { try { const r = await this.fetch(`/servers/${sid}/channel-categories`); return r.ok ? r.json() : []; } catch { return []; } }
  async createChannelCategory(sid: string, name: string, position?: number) { return (await this.fetch(`/servers/${sid}/channel-categories`, { method: 'POST', body: JSON.stringify({ name, position }) })).json(); }
  async updateChannelCategory(catId: string, data: { name?: string; position?: number; collapsed?: boolean }) { return this.fetch(`/channel-categories/${catId}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteChannelCategory(catId: string) { return this.fetch(`/channel-categories/${catId}`, { method: 'DELETE' }); }
  async addChannelToCategory(catId: string, channelId: string) { return this.fetch(`/channel-categories/${catId}/channels/${channelId}`, { method: 'PUT' }); }
  async removeChannelFromCategory(catId: string, channelId: string) { return this.fetch(`/channel-categories/${catId}/channels/${channelId}`, { method: 'DELETE' }); }

  // ── Scheduled Tasks ──
  async listTasks(sid: string) { try { const r = await this.fetch(`/servers/${sid}/tasks`); return r.ok ? r.json() : []; } catch { return []; } }
  async createTask(sid: string, data: { channel_id?: string; task_type: string; config?: any; cron_expr: string; enabled?: boolean }) { return (await this.fetch(`/servers/${sid}/tasks`, { method: 'POST', body: JSON.stringify(data) })).json(); }
  async deleteTask(taskId: string) { return this.fetch(`/tasks/${taskId}`, { method: 'DELETE' }); }
  async toggleTask(taskId: string) { return (await this.fetch(`/tasks/${taskId}/toggle`, { method: 'PATCH' })).json(); }

  // ── Scheduled Messages ──
  async scheduleMessage(channelId: string, data: { content_ciphertext: string; mls_epoch?: number; send_at: string }) {
    const r = await this.fetch(`/channels/${channelId}/schedule`, { method: 'POST', body: JSON.stringify(data) });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to schedule message' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
    return r.json();
  }
  async listScheduledMessages(channelId: string) { try { const r = await this.fetch(`/channels/${channelId}/scheduled`); return r.ok ? r.json() : []; } catch { return []; } }
  async cancelScheduledMessage(id: string) {
    const r = await this.fetch(`/scheduled/${id}`, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: { message: 'Failed to cancel' } })); throw new Error(e.error?.message || e.error || `HTTP ${r.status}`); }
  }

  // ── Streaming ──
  async startStream(channelId: string, title?: string, quality?: string) { try { const r = await this.fetch(`/channels/${channelId}/stream/start`, { method: 'POST', body: JSON.stringify({ title, quality: quality || '1080p' }) }); return r.ok ? r.json() : null; } catch { return null; } }
  async stopStream(channelId: string) { try { await this.fetch(`/channels/${channelId}/stream`, { method: 'DELETE' }); } catch {} }
  async getStreamStatus(channelId: string) { try { const r = await this.fetch(`/channels/${channelId}/stream`); return r.ok ? r.json() : null; } catch { return null; } }

  // ── Bot Prompting ──
  /** Send a user message to a bot for an AI response. Response arrives via WebSocket as message_create. */
  async promptBot(sid: string, bid: string, prompt: string, channelId?: string) { try { const r = await this.fetch(`/servers/${sid}/ai-bots/${bid}/prompt`, { method: 'POST', body: JSON.stringify({ prompt, channel_id: channelId || undefined }) }); return r.ok ? r.json() : null; } catch { return null; } }

  // ── Gamification ──
  async getLeaderboard(sid: string) { try { const r = await this.fetch(`/servers/${sid}/gamification/leaderboard`); return r.ok ? r.json() : []; } catch { return []; } }
  async getPoints(sid: string, uid: string) { try { const r = await this.fetch(`/servers/${sid}/gamification/points/${uid}`); return r.ok ? r.json() : null; } catch { return null; } }
  async awardPoints(sid: string, uid: string, amount: number, reason: string) { try { const r = await this.fetch(`/servers/${sid}/gamification/points`, { method: 'POST', body: JSON.stringify({ user_id: uid, amount, reason }) }); return r.ok ? r.json() : null; } catch { return null; } }

  // ── WebSocket ──
  connectWs(sid: string) {
    this._wsManualClose = false;
    this._wsServerId = sid;
    this._wsReconnectAttempt = 0;
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    this._doConnect(sid);
  }

  private _doConnect(sid: string) {
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    const wsUrl = `${WS_BASE}/ws?server_id=${sid}&token=${encodeURIComponent(this.token || '')}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this._wsReconnectAttempt = 0;
      this.wsListeners.forEach(fn => fn({ type: 'ws_status', status: 'connected' }));
    };
    this.ws.onmessage = (e) => { try { this.wsListeners.forEach(fn => fn(JSON.parse(e.data))); } catch {} };
    this.ws.onerror = () => {};
    this.ws.onclose = (e) => {
      this.ws = null;
      if (e.code === 4001) {
        this.wsListeners.forEach(fn => fn({ type: 'account_suspended', reason: e.reason || 'Account suspended' }));
        return;
      }
      if (this._wsManualClose) return;
      // Auto-reconnect with exponential backoff
      this._wsReconnectAttempt++;
      const delay = Math.min(1000 * Math.pow(2, this._wsReconnectAttempt - 1), 30000);
      this.wsListeners.forEach(fn => fn({ type: 'ws_status', status: delay >= 30000 ? 'disconnected' : 'reconnecting', attempt: this._wsReconnectAttempt }));
      this._wsReconnectTimer = setTimeout(() => {
        if (this._wsServerId === sid && !this._wsManualClose) this._doConnect(sid);
      }, delay);
    };
  }

  disconnectWs() {
    this._wsManualClose = true;
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  /** Force a reconnection attempt (e.g. user clicks Retry). */
  retryWs() {
    if (this._wsServerId && !this.ws) {
      this._wsReconnectAttempt = 0;
      this.wsListeners.forEach(fn => fn({ type: 'ws_status', status: 'reconnecting', attempt: 0 }));
      this._doConnect(this._wsServerId);
    }
  }

  onWsEvent(fn: WsListener): () => void {
    this.wsListeners.add(fn);
    return () => this.wsListeners.delete(fn);
  }
}

// Singleton instance
export const api = new CitadelAPI();
