/**
 * CitadelAPI — React Native edition.
 *
 * Adapted from client/src/api/CitadelAPI.ts:
 *  - localStorage  → AsyncStorage
 *  - document.cookie CSRF → AsyncStorage-based CSRF token cache
 *  - window.location / WS_BASE → SERVER_URL constant
 *  - FileReader (browser API) → base64 string accepted directly
 *
 * CSRF note: the double-submit cookie pattern is a browser-only concern.
 * React Native's fetch does not automatically send cookies, so we read the
 * Set-Cookie response header on the first mutating request, store the token
 * in AsyncStorage, and echo it back as X-CSRF-Token on subsequent mutations.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Server URL — change to your deployment address ──────────────────────

export const SERVER_URL = 'https://discreet.chat';

const API_BASE = `${SERVER_URL}/api/v1`;
const WS_BASE  = SERVER_URL.replace(/^http/, 'ws');

// ── Storage keys ─────────────────────────────────────────────────────────

const KEY_TOK   = 'd_tok';
const KEY_REF   = 'd_ref';
const KEY_UID   = 'd_uid';
const KEY_UNAME = 'd_uname';
const KEY_CSRF  = 'd_csrf';

// ── Types ─────────────────────────────────────────────────────────────────

type WsListener = (data: any) => void;

// ── Class ──────────────────────────────────────────────────────────────────

export class CitadelAPI {
  token: string | null        = null;
  refreshToken: string | null = null;
  userId: string | null       = null;
  username: string | null     = null;
  ws: WebSocket | null        = null;
  wsListeners: Set<WsListener> = new Set();
  private _userCache: Record<string, any> = {};
  private _csrfToken: string | null = null;

  // ── Initialise from persisted storage (call once on app start) ──────────

  async init(): Promise<void> {
    const [tok, ref, uid, uname, csrf] = await AsyncStorage.multiGet([
      KEY_TOK, KEY_REF, KEY_UID, KEY_UNAME, KEY_CSRF,
    ]);
    this.token        = tok[1]   ?? null;
    this.refreshToken = ref[1]   ?? null;
    this.userId       = uid[1]   ?? null;
    this.username     = uname[1] ?? null;
    this._csrfToken   = csrf[1]  ?? null;
  }

  // ── Auth storage helpers ─────────────────────────────────────────────────

  async setAuth(access: string, refresh: string, userId: string, username?: string): Promise<void> {
    this.token        = access;
    this.refreshToken = refresh;
    this.userId       = userId;
    this.username     = username || userId;
    await AsyncStorage.multiSet([
      [KEY_TOK,   access],
      [KEY_REF,   refresh],
      [KEY_UID,   userId],
      [KEY_UNAME, username || userId],
    ]);
  }

  async clearAuth(): Promise<void> {
    this.token = this.refreshToken = this.userId = this.username = null;
    this._csrfToken = null;
    await AsyncStorage.multiRemove([KEY_TOK, KEY_REF, KEY_UID, KEY_UNAME, KEY_CSRF]);
    this.disconnectWs();
  }

  // ── CSRF ─────────────────────────────────────────────────────────────────
  // React Native doesn't participate in same-origin cookie attacks, but we
  // honour the server's double-submit pattern anyway for API compatibility.
  // The token is extracted from the Set-Cookie response header once and
  // stored in AsyncStorage.

  private async getCsrfToken(): Promise<string | null> {
    return this._csrfToken;
  }

  private async updateCsrfFromResponse(res: Response): Promise<void> {
    const setCookie = res.headers.get('set-cookie') || '';
    const match = setCookie.match(/csrf_token=([^;]+)/);
    if (match) {
      this._csrfToken = match[1];
      await AsyncStorage.setItem(KEY_CSRF, this._csrfToken);
    }
  }

  // ── Core fetch wrapper ────────────────────────────────────────────────────

  async fetch(path: string, opts: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = await this.getCsrfToken();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    await this.updateCsrfFromResponse(res);

    if (res.status === 401 && this.refreshToken) {
      const ok = await this.tryRefresh();
      if (ok) {
        headers['Authorization'] = `Bearer ${this.token}`;
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          const csrf = await this.getCsrfToken();
          if (csrf) headers['X-CSRF-Token'] = csrf;
        }
        return fetch(`${API_BASE}${path}`, { ...opts, headers });
      }
    }
    return res;
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      if (res.ok) {
        const d = await res.json();
        this.token = d.access_token;
        await AsyncStorage.setItem(KEY_TOK, this.token!);
        return true;
      }
    } catch {}
    await this.clearAuth();
    return false;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async register(u: string, p: string, e?: string) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p, email: e || undefined, device_name: 'mobile' }),
    });
    const d = await res.json();
    if (res.ok) await this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async login(u: string, p: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: u, password: p, device_name: 'mobile' }),
    });
    const d = await res.json();
    if (res.ok) await this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  async logout() { await this.fetch('/auth/logout', { method: 'POST' }); await this.clearAuth(); }

  async registerGuest() {
    const res = await fetch(`${API_BASE}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const d = await res.json();
    if (res.ok && d.access_token) await this.setAuth(d.access_token, d.refresh_token, d.user.id, d.user.username);
    return { ok: res.ok, data: d };
  }

  // ── Servers ───────────────────────────────────────────────────────────────

  async listServers() { return (await this.fetch('/servers')).json(); }
  async createServer(name: string) { return (await this.fetch('/servers', { method: 'POST', body: JSON.stringify({ name }) })).json(); }
  async createInvite(sid: string) { return (await this.fetch(`/servers/${sid}/invites`, { method: 'POST', body: JSON.stringify({ max_uses: 100, expires_in_hours: 168 }) })).json(); }
  async joinServer(sid: string, code: string) { return this.fetch(`/servers/${sid}/join`, { method: 'POST', body: JSON.stringify({ invite_code: code }) }); }
  async listMembers(sid: string) { return (await this.fetch(`/servers/${sid}/members`)).json(); }
  async updateServer(sid: string, data: any) { return this.fetch(`/servers/${sid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteServer(sid: string) { return this.fetch(`/servers/${sid}`, { method: 'DELETE' }); }
  async leaveServer(sid: string) { return this.fetch(`/servers/${sid}/leave`, { method: 'POST' }); }

  // ── Channels + Categories ─────────────────────────────────────────────────

  async listChannels(sid: string) { return (await this.fetch(`/servers/${sid}/channels`)).json(); }
  async createChannel(sid: string, name: string, catId?: string | null, chType?: string) { return (await this.fetch(`/servers/${sid}/channels`, { method: 'POST', body: JSON.stringify({ name, channel_type: chType || 'text', category_id: catId || undefined }) })).json(); }
  async listCategories(sid: string) { try { const r = await this.fetch(`/servers/${sid}/categories`); return r.ok ? r.json() : []; } catch { return []; } }
  async updateChannel(cid: string, data: any) { return this.fetch(`/channels/${cid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async deleteChannel(cid: string) { return this.fetch(`/channels/${cid}`, { method: 'DELETE' }); }

  // ── Messages ──────────────────────────────────────────────────────────────

  async sendMessage(cid: string, ct: string, ep: number, replyId?: string) { return (await this.fetch(`/channels/${cid}/messages`, { method: 'POST', body: JSON.stringify({ content_ciphertext: ct, mls_epoch: ep, reply_to_id: replyId || undefined }) })).json(); }
  async getMessages(cid: string, limit = 50) { return (await this.fetch(`/channels/${cid}/messages?limit=${limit}`)).json(); }
  async editMessage(mid: string, content: string, epoch: number) { return this.fetch(`/messages/${mid}`, { method: 'PATCH', body: JSON.stringify({ content_ciphertext: content, mls_epoch: epoch }) }); }
  async deleteMessage(mid: string) { return this.fetch(`/messages/${mid}`, { method: 'DELETE' }); }
  async pinMessage(cid: string, mid: string) { return this.fetch(`/channels/${cid}/pins/${mid}`, { method: 'PUT' }); }
  async sendTyping(cid: string) { return this.fetch(`/channels/${cid}/typing`, { method: 'POST' }); }
  async getMessagesBatch(cid: string, limit = 200, before?: string) { const params = [`limit=${limit}`]; if (before) params.push(`before=${before}`); try { const r = await this.fetch(`/channels/${cid}/messages?${params.join('&')}`); return r.ok ? r.json() : []; } catch { return []; } }

  // ── Roles ─────────────────────────────────────────────────────────────────

  async listRoles(sid: string) { try { const r = await this.fetch(`/servers/${sid}/roles`); return r.ok ? r.json() : []; } catch { return []; } }
  async createRole(sid: string, name: string, color: string, permissions: number) { return this.fetch(`/servers/${sid}/roles`, { method: 'POST', body: JSON.stringify({ name, color, permissions }) }); }
  async assignRole(sid: string, uid: string, rid: string) { return this.fetch(`/servers/${sid}/members/${uid}/roles/${rid}`, { method: 'PUT' }); }
  async unassignRole(sid: string, uid: string, rid: string) { return this.fetch(`/servers/${sid}/members/${uid}/roles/${rid}`, { method: 'DELETE' }); }

  // ── DMs ───────────────────────────────────────────────────────────────────

  async listDms() { try { const r = await this.fetch('/dms'); return r.ok ? r.json() : []; } catch { return []; } }
  async createDm(uid: string) { return (await this.fetch('/dms', { method: 'POST', body: JSON.stringify({ recipient_id: uid }) })).json(); }
  async sendDmMessage(dmId: string, text: string) { return (await this.fetch(`/dms/${dmId}/messages`, { method: 'POST', body: JSON.stringify({ content: text }) })).json(); }
  async getDmMessages(dmId: string, limit = 50) { return (await this.fetch(`/dms/${dmId}/messages?limit=${limit}`)).json(); }

  // ── Friends ───────────────────────────────────────────────────────────────

  async listFriends() { try { const r = await this.fetch('/friends'); return r.ok ? r.json() : []; } catch { return []; } }
  async listIncomingRequests() { try { const r = await this.fetch('/friends/pending'); return r.ok ? r.json() : []; } catch { return []; } }
  async listOutgoingRequests() { try { const r = await this.fetch('/friends/outgoing'); return r.ok ? r.json() : []; } catch { return []; } }
  async sendFriendRequest(uid: string) { return this.fetch('/friends/request', { method: 'POST', body: JSON.stringify({ user_id: uid }) }); }
  async acceptFriend(id: string) { return this.fetch(`/friends/${id}/accept`, { method: 'POST' }); }
  async declineFriend(id: string) { return this.fetch(`/friends/${id}/decline`, { method: 'POST' }); }
  async removeFriend(id: string) { return this.fetch(`/friends/${id}`, { method: 'DELETE' }); }
  async blockUser(uid: string) { return this.fetch(`/users/${uid}/block`, { method: 'POST' }); }
  async searchUsers(q: string) { try { const r = await this.fetch(`/users/search?q=${encodeURIComponent(q)}`); return r.ok ? r.json() : []; } catch { return []; } }

  /** Remove persisted credentials without clearing in-memory state (used by "Don't remember me"). */
  async forgetCredentials(): Promise<void> {
    await AsyncStorage.multiRemove([KEY_TOK, KEY_REF, KEY_UID, KEY_UNAME, KEY_CSRF]);
  }

  // ── User / Profile ────────────────────────────────────────────────────────

  async getUser(id: string) { if (this._userCache[id]) return this._userCache[id]; try { const d = await (await this.fetch(`/users/${id}`)).json(); this._userCache[id] = d; return d; } catch { return null; } }
  async updateProfile(data: any) { return this.fetch('/users/@me', { method: 'PATCH', body: JSON.stringify(data) }); }
  async getMe() { try { return (await this.fetch('/users/@me')).json(); } catch { return null; } }
  async getSettings() { try { const r = await this.fetch('/users/@me/settings'); return r.ok ? r.json() : null; } catch { return null; } }
  async updateSettings(s: any) { return this.fetch('/users/@me/settings', { method: 'PATCH', body: JSON.stringify(s) }); }

  // ── Bots ──────────────────────────────────────────────────────────────────

  async spawnBot(sid: string, opts: { persona: string; display_name?: string; system_prompt?: string }) { return (await this.fetch(`/servers/${sid}/ai-bots`, { method: 'POST', body: JSON.stringify(opts) })).json(); }
  async listBots(sid: string) { try { const r = await this.fetch(`/servers/${sid}/ai-bots`); return r.ok ? r.json() : []; } catch { return []; } }
  async updateBotConfig(sid: string, bid: string, data: any) { return this.fetch(`/servers/${sid}/ai-bots/${bid}`, { method: 'PATCH', body: JSON.stringify(data) }); }
  async promptBot(sid: string, bid: string, prompt: string, channelId?: string) { try { const r = await this.fetch(`/servers/${sid}/ai-bots/${bid}/prompt`, { method: 'POST', body: JSON.stringify({ prompt, channel_id: channelId || undefined }) }); return r.ok ? r.json() : null; } catch { return null; } }

  // ── Reactions ─────────────────────────────────────────────────────────────

  async addReaction(cid: string, mid: string, emoji: string) { return this.fetch(`/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}`, { method: 'PUT' }); }
  async removeReaction(cid: string, mid: string, emoji: string) { return this.fetch(`/channels/${cid}/messages/${mid}/reactions/${encodeURIComponent(emoji)}`, { method: 'DELETE' }); }

  // ── Events ────────────────────────────────────────────────────────────────

  async listEvents(sid: string) { try { const r = await this.fetch(`/servers/${sid}/events`); return r.ok ? r.json() : []; } catch { return []; } }
  async createEvent(sid: string, data: any) { return (await this.fetch(`/servers/${sid}/events`, { method: 'POST', body: JSON.stringify(data) })).json(); }

  // ── File upload (base64 — caller provides encoded string) ─────────────────

  async uploadFile(channelId: string, base64: string, mimeType: string, filename: string) {
    return (await this.fetch(`/channels/${channelId}/files`, {
      method: 'POST',
      body: JSON.stringify({ encrypted_blob: base64, mime_type_hint: mimeType, filename }),
    })).json();
  }

  async downloadFile(fid: string) { return (await this.fetch(`/files/${fid}`)).json(); }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  connectWs(sid: string) {
    if (this.ws) this.ws.close();
    const wsUrl = `${WS_BASE}/ws?server_id=${sid}&token=${encodeURIComponent(this.token || '')}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen    = () => console.log('[ws] connected to', sid);
    this.ws.onmessage = (e) => { try { this.wsListeners.forEach(fn => fn(JSON.parse(e.data))); } catch {} };
    this.ws.onerror   = (e) => console.error('[ws] error:', e);
    this.ws.onclose   = (e) => { console.log('[ws] closed:', e.code); this.ws = null; };
  }

  disconnectWs() {
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  onWsEvent(fn: WsListener): () => void {
    this.wsListeners.add(fn);
    return () => this.wsListeners.delete(fn);
  }
}

// Singleton
export const api = new CitadelAPI();
