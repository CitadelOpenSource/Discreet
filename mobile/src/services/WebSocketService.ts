/**
 * WebSocketService — resilient WS connection for the Discreet mobile client.
 *
 * Features:
 *  - Exponential backoff reconnect (1 → 2 → 4 → 8 → … → 30s cap)
 *  - 30-second heartbeat ping with pong-timeout detection
 *  - AppState-aware: stays alive 5 min in background, reconnects on foreground
 *  - Typed event bus: subscribe to specific event types or '*' for all
 *  - Clean teardown: call destroy() on logout or server change
 */

import { AppState, AppStateStatus } from 'react-native';
import { SERVER_URL } from '../api/CitadelAPI';

// ── Constants ──────────────────────────────────────────────────────────────

const PING_INTERVAL_MS       = 30_000;
const PONG_TIMEOUT_MS        = 10_000;   // close & retry if no pong within 10s
const BACKGROUND_GRACE_MS    = 5 * 60 * 1000;  // 5 minutes
const BACKOFF_INITIAL_MS     = 1_000;
const BACKOFF_MAX_MS         = 30_000;
const BACKOFF_FACTOR         = 2;

// ── Types ──────────────────────────────────────────────────────────────────

export type WsEvent = Record<string, any> & { type: string };
export type WsListener = (event: WsEvent) => void;

export type WsStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export type StatusListener = (status: WsStatus) => void;

// ── Service ────────────────────────────────────────────────────────────────

export class WebSocketService {
  private serverId: string;
  private getToken: () => string | null;

  private ws: WebSocket | null            = null;
  private listeners = new Map<string, Set<WsListener>>();
  private statusListeners = new Set<StatusListener>();

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer:      ReturnType<typeof setInterval> | null = null;
  private pongTimer:      ReturnType<typeof setTimeout> | null = null;
  private bgTimer:        ReturnType<typeof setTimeout> | null = null;

  private attempt         = 0;
  private destroyed       = false;
  private appState:       AppStateStatus = 'active';
  private appStateSub:    ReturnType<typeof AppState.addEventListener> | null = null;

  // ── Constructor ──────────────────────────────────────────────────────────

  constructor(serverId: string, getToken: () => string | null) {
    this.serverId = serverId;
    this.getToken = getToken;
    this.registerAppState();
    this.connect();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Subscribe to a specific event type, or '*' for every event. */
  on(type: string, fn: WsListener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  /** Subscribe to connection status changes. */
  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Send a raw JSON payload (no-op if not connected). */
  send(payload: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Permanently shut down — call on server change or logout. */
  destroy() {
    this.destroyed = true;
    this.clearTimers();
    this.appStateSub?.remove();
    this.ws?.close();
    this.ws = null;
    this.emitStatus('disconnected');
  }

  // ── Connection ───────────────────────────────────────────────────────────

  private connect() {
    if (this.destroyed) return;

    const token = this.getToken();
    if (!token) {
      console.warn('[ws] no token — skipping connect');
      return;
    }

    this.clearTimers();
    this.emitStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const wsBase = SERVER_URL.replace(/^http/, 'ws');
    const url    = `${wsBase}/ws?server_id=${this.serverId}&token=${encodeURIComponent(token)}`;

    console.log(`[ws] connecting (attempt ${this.attempt + 1}): ${this.serverId}`);

    const ws = new WebSocket(url);
    this.ws  = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return; // stale socket
      console.log('[ws] connected');
      this.attempt = 0;
      this.emitStatus('connected');
      this.startHeartbeat();
    };

    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      // Server pong
      if (e.data === 'pong' || e.data === '{"type":"pong"}') {
        this.clearPongTimer();
        return;
      }
      try {
        const evt: WsEvent = JSON.parse(e.data);
        this.dispatch(evt);
      } catch {
        // non-JSON frame — ignore
      }
    };

    ws.onerror = () => {
      if (ws !== this.ws) return;
      console.warn('[ws] error');
    };

    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      console.log(`[ws] closed: ${e.code} ${e.reason}`);
      this.stopHeartbeat();
      if (!this.destroyed) this.scheduleReconnect();
    };
  }

  // ── Reconnect with exponential backoff ───────────────────────────────────

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.emitStatus('reconnecting');
    const delay = Math.min(
      BACKOFF_INITIAL_MS * Math.pow(BACKOFF_FACTOR, this.attempt),
      BACKOFF_MAX_MS,
    );
    console.log(`[ws] reconnecting in ${delay}ms (attempt ${this.attempt + 1})`);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        // Expect a pong within PONG_TIMEOUT_MS
        this.pongTimer = setTimeout(() => {
          console.warn('[ws] pong timeout — closing for reconnect');
          this.ws?.close();
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.clearPongTimer();
  }

  private clearPongTimer() {
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  // ── AppState: background grace period ────────────────────────────────────

  private registerAppState() {
    this.appStateSub = AppState.addEventListener('change', (next) => {
      const prev = this.appState;
      this.appState = next;

      if (next === 'active' && prev !== 'active') {
        // Came back to foreground
        console.log('[ws] foreground — reconnecting immediately');
        this.clearBgTimer();
        if (!this.destroyed) {
          // If socket is dead, reconnect now; if alive, do nothing
          if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
            this.attempt = 0; // reset backoff for manual foreground reconnect
            this.connect();
          }
        }
      } else if (next === 'background' || next === 'inactive') {
        // Start grace-period countdown
        console.log(`[ws] background — will disconnect in ${BACKGROUND_GRACE_MS / 1000}s`);
        this.bgTimer = setTimeout(() => {
          if (this.appState !== 'active' && !this.destroyed) {
            console.log('[ws] background grace expired — disconnecting');
            this.stopHeartbeat();
            this.clearReconnectTimer();
            this.ws?.close();
            this.ws = null;
            this.emitStatus('disconnected');
          }
        }, BACKGROUND_GRACE_MS);
      }
    });
  }

  private clearBgTimer() {
    if (this.bgTimer) { clearTimeout(this.bgTimer); this.bgTimer = null; }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private clearTimers() {
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.clearBgTimer();
  }

  // ── Event dispatch ────────────────────────────────────────────────────────

  private dispatch(evt: WsEvent) {
    // Listeners for this specific type
    this.listeners.get(evt.type)?.forEach(fn => fn(evt));
    // Wildcard listeners
    this.listeners.get('*')?.forEach(fn => fn(evt));
  }

  private emitStatus(s: WsStatus) {
    this.statusListeners.forEach(fn => fn(s));
  }
}

// ── Singleton manager ─────────────────────────────────────────────────────
// MainScreen creates/destroys services per server; this module just exports
// the class. The screen owns the lifecycle via useRef.
