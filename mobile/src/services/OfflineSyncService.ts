/**
 * OfflineSyncService — Offline message queue and automatic sync on reconnect.
 *
 * ── Outbox ─────────────────────────────────────────────────────────────────
 * Messages sent while offline are written to AsyncStorage under
 * 'proximity_outbox' as a JSON array of OutboxMessage.  Messages with a
 * channelId are uploaded to the server when connectivity returns; those without
 * one (pure BLE-only messages) stay in the queue until a channelId is provided.
 *
 * ── Sync flow (offline → online) ───────────────────────────────────────────
 *   1. Read the outbox and group entries by channelId.
 *   2. For each channel: fetch the latest server messages (download).
 *   3. Upload each queued message via the normal message API.
 *   4. Merge downloaded server messages with the newly uploaded messages,
 *      sort by timestamp, and deduplicate by ID.
 *   5. Write back only the messages that failed to upload; clear successes.
 *   6. Return a SyncResult so the caller can show a "Synced N messages" toast.
 *
 * ── Startup ─────────────────────────────────────────────────────────────────
 * Call startConnectivityWatch() once at app startup (e.g. in a MainScreen
 * useEffect).  It listens for NetInfo state changes and fires sync on every
 * offline → online transition.  It also performs an immediate sync on startup
 * if the outbox is non-empty and the device is already online.
 */

import NetInfo, { NetInfoState, NetInfoSubscription } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CitadelAPI } from '../api/CitadelAPI';

// ── Storage key ───────────────────────────────────────────────────────────────

const STORE_OUTBOX = 'proximity_outbox';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A message sent while offline, persisted for later server upload. */
export interface OutboxMessage {
  /** Locally unique ID (timestamp + random suffix). */
  id:        string;
  /** Intended recipient pseudoId (informational, may be empty for channel msgs). */
  recipient: string;
  /** Plaintext message content. */
  content:   string;
  /** Unix ms timestamp when the message was queued. */
  timestamp: number;
  /**
   * Server channel to upload to when online.
   * Empty string = BLE-only message; skipped during server sync.
   */
  channelId: string;
}

/** Returned by sync() — describes what happened. */
export interface SyncResult {
  /** Messages successfully uploaded to the server. */
  uploaded:   number;
  /** Server messages fetched that were newer than the oldest outbox entry. */
  downloaded: number;
  /** Messages that failed to upload (remain in the outbox). */
  failed:     number;
  /**
   * channelId → merged + sorted message array (server messages + uploaded stubs).
   * MainScreen can inject these into the current channel view.
   */
  channelMessages: Record<string, any[]>;
}

// ── OfflineSyncService ────────────────────────────────────────────────────────

class OfflineSyncService {
  private _syncing  = false;
  private _wasOnline: boolean | null = null;
  private _netUnsub: NetInfoSubscription | null = null;

  // ── Outbox ──────────────────────────────────────────────────────────────

  /** Append a message to the offline outbox. */
  async enqueue(msg: Omit<OutboxMessage, 'id'>): Promise<void> {
    const entry: OutboxMessage = {
      ...msg,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    try {
      const raw   = await AsyncStorage.getItem(STORE_OUTBOX);
      const queue: OutboxMessage[] = raw ? JSON.parse(raw) : [];
      queue.push(entry);
      await AsyncStorage.setItem(STORE_OUTBOX, JSON.stringify(queue));
    } catch {}
  }

  /** Read the current outbox without modifying it. */
  async getOutbox(): Promise<OutboxMessage[]> {
    try {
      const raw = await AsyncStorage.getItem(STORE_OUTBOX);
      return raw ? (JSON.parse(raw) as OutboxMessage[]) : [];
    } catch {
      return [];
    }
  }

  /** Permanently remove all outbox entries. */
  async clearOutbox(): Promise<void> {
    await AsyncStorage.removeItem(STORE_OUTBOX).catch(() => {});
  }

  // ── Sync ────────────────────────────────────────────────────────────────

  /**
   * Perform a full offline→online sync.
   *
   *   1. Read the outbox and group by channelId.
   *   2. For each channel, fetch the latest 200 server messages (download step).
   *   3. Upload each outbox entry via api.sendMessage().
   *   4. Merge server messages with the uploaded entries, sort by timestamp.
   *   5. Write back only failures; successes are removed.
   */
  async sync(api: CitadelAPI): Promise<SyncResult> {
    if (this._syncing) {
      return { uploaded: 0, downloaded: 0, failed: 0, channelMessages: {} };
    }
    this._syncing = true;

    const result: SyncResult = {
      uploaded:        0,
      downloaded:      0,
      failed:          0,
      channelMessages: {},
    };

    try {
      const outbox = await this.getOutbox();
      if (outbox.length === 0) return result;

      // Group by channelId; entries with no channelId cannot be server-synced.
      const byChannel = new Map<string, OutboxMessage[]>();
      const noChannel: OutboxMessage[] = [];

      for (const msg of outbox) {
        if (!msg.channelId) {
          noChannel.push(msg);
          continue;
        }
        const group = byChannel.get(msg.channelId) ?? [];
        group.push(msg);
        byChannel.set(msg.channelId, group);
      }

      // Messages that stay in the outbox after this sync attempt.
      const remaining: OutboxMessage[] = [...noChannel];

      for (const [channelId, msgs] of byChannel) {
        // Sort ascending by timestamp before processing.
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        const oldestTs = msgs[0].timestamp;

        // ── Step 1: Download ───────────────────────────────────────────────
        let serverMsgs: any[] = [];
        try {
          const raw = await api.getMessagesBatch(channelId, 200);
          serverMsgs = Array.isArray(raw) ? raw : [];
          // Count only messages that arrived while we were offline.
          const newFromServer = serverMsgs.filter((m: any) => {
            const ts = m.created_at ? new Date(m.created_at).getTime() : 0;
            return ts > oldestTs;
          });
          result.downloaded += newFromServer.length;
        } catch {}

        // ── Step 2: Upload ─────────────────────────────────────────────────
        const uploaded:   OutboxMessage[] = [];
        const uploadFail: OutboxMessage[] = [];

        for (const msg of msgs) {
          try {
            await api.sendMessage(channelId, msg.content, 0);
            result.uploaded++;
            uploaded.push(msg);
          } catch {
            result.failed++;
            uploadFail.push(msg);
          }
        }

        // Keep failed uploads in the outbox.
        remaining.push(...uploadFail);

        // ── Step 3: Merge ──────────────────────────────────────────────────
        // Combine server messages with optimistic stubs for successfully
        // uploaded entries, dedup by ID, then sort by creation timestamp.
        const uploadedStubs = uploaded.map(m => ({
          id:         `prox-${m.id}`,
          author_id:  api.userId ?? '',
          text:       m.content,
          content_ciphertext: m.content,
          created_at: new Date(m.timestamp).toISOString(),
          authorName: api.username ?? 'You',
          _isStub:    true,
        }));

        const allMsgs = [...serverMsgs, ...uploadedStubs];
        const seen    = new Set<string>();
        result.channelMessages[channelId] = allMsgs
          .filter((m: any) => {
            const key = String(m.id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a: any, b: any) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
          });
      }

      // Persist only what failed.
      await AsyncStorage.setItem(STORE_OUTBOX, JSON.stringify(remaining));

    } catch {
      // Swallow unexpected errors — the outbox is unchanged if we can't write.
    } finally {
      this._syncing = false;
    }

    return result;
  }

  // ── Connectivity watch ───────────────────────────────────────────────────

  /**
   * Register a NetInfo listener that triggers sync on every offline→online
   * transition.  Also immediately syncs if the outbox is non-empty and the
   * device is already online at startup.
   *
   * @param api     The CitadelAPI singleton.
   * @param onSync  Called after each successful sync with the result.
   * @param onOffline Called when connectivity is lost (optional UI feedback).
   * @returns Cleanup function — call in a useEffect return.
   */
  startConnectivityWatch(
    api:       CitadelAPI,
    onSync:    (result: SyncResult) => void,
    onOffline?: () => void,
  ): () => void {
    const handleState = async (state: NetInfoState) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;

      if (!online && this._wasOnline === true) {
        // Online → offline transition.
        onOffline?.();
      }

      if (online && this._wasOnline === false) {
        // Offline → online transition: run sync.
        const result = await this.sync(api);
        if (result.uploaded > 0 || result.downloaded > 0) {
          onSync(result);
        }
      }

      this._wasOnline = online;
    };

    // Startup: resolve current state and sync immediately if outbox is non-empty.
    NetInfo.fetch().then(async state => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      this._wasOnline = online;

      if (online) {
        const outbox = await this.getOutbox();
        if (outbox.length > 0) {
          const result = await this.sync(api);
          if (result.uploaded > 0 || result.downloaded > 0) {
            onSync(result);
          }
        }
      }
    }).catch(() => {});

    if (this._netUnsub) this._netUnsub();
    this._netUnsub = NetInfo.addEventListener(handleState);

    return () => {
      this._netUnsub?.();
      this._netUnsub = null;
    };
  }

  /** Stop the active connectivity listener. */
  stopConnectivityWatch(): void {
    this._netUnsub?.();
    this._netUnsub = null;
  }

  /** Current cached online state (null = not yet determined). */
  get isOnline(): boolean | null {
    return this._wasOnline;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: OfflineSyncService | null = null;

export function getOfflineSyncService(): OfflineSyncService {
  if (!_instance) _instance = new OfflineSyncService();
  return _instance;
}
