/**
 * ThreadView — right-side panel for viewing and replying to message threads.
 *
 * Flow:
 *   1. Mounts with a parent message + channelId.
 *   2. Calls POST /channels/:channel_id/threads  (idempotent create — server
 *      returns existing thread if one already exists for this parent message).
 *   3. Fetches replies via GET /threads/:thread_id/messages.
 *   4. User sends replies via POST /threads/:thread_id/messages.
 *
 * Exports:
 *   ThreadMessage   — shape of a thread reply
 *   ParentMsg       — minimal parent message shape expected by ThreadView
 *   ThreadViewProps
 *   ThreadView
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { T } from '../theme';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';

// ─── Types ────────────────────────────────────────────────

export interface ParentMsg {
  id:          string;
  author_id:   string;
  text?:       string;
  authorName?: string;
  created_at:  string;
}

export interface ThreadMessage {
  id:          string;
  author_id:   string;
  /** Servers may return `content` or `text` depending on version. */
  content?:    string;
  text?:       string;
  created_at:  string;
  authorName?: string;
}

interface Thread {
  id:                string;
  parent_message_id: string;
  channel_id:        string;
  title?:            string;
  message_count:     number;
  created_at:        string;
}

export interface ThreadViewProps {
  parentMessage: ParentMsg;
  channelId:     string;
  onClose:       () => void;
  getName?:      (userId: string) => string;
}

// ─── Helpers ──────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function msgText(m: ThreadMessage): string {
  return m.text || m.content || '';
}

// ─── ThreadView ───────────────────────────────────────────

export function ThreadView({ parentMessage, channelId, onClose, getName }: ThreadViewProps) {
  const resolveName = useCallback(
    (uid: string) => getName ? getName(uid) : uid.slice(0, 8),
    [getName],
  );

  const [thread,   setThread]   = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // ── Boot: create/fetch thread, then load messages ──────

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setError('');
      try {
        const t: Thread = await api.createThread(channelId, parentMessage.id);
        if (!t?.id) { setError('Could not open thread.'); return; }
        if (cancelled) return;
        setThread(t);

        const msgs: ThreadMessage[] = await api.listThreadMessages(t.id);
        if (cancelled) return;
        setMessages(Array.isArray(msgs) ? msgs : []);
      } catch {
        if (!cancelled) setError('Failed to load thread.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [channelId, parentMessage.id]);

  // Auto-scroll when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send ───────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !thread || sending) return;

    setSending(true);
    setInput('');
    try {
      const msg: ThreadMessage = await api.sendThreadMessage(thread.id, text);
      if (msg?.id) {
        setMessages(prev => [...prev, msg]);
        setThread(prev => prev ? { ...prev, message_count: prev.message_count + 1 } : prev);
      }
    } catch {
      setInput(text); // restore on failure
      setError('Failed to send message.');
      setTimeout(() => setError(''), 3000);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ─────────────────────────────────────────────

  const parentName   = parentMessage.authorName || resolveName(parentMessage.author_id);
  const replyCount   = thread ? thread.message_count || messages.length : messages.length;

  return (
    <div style={{
      width: 320, minWidth: 320,
      background: T.sf,
      borderLeft: `1px solid ${T.bd}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Sans', sans-serif",
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: `1px solid ${T.bd}`, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🧵</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Thread</span>
          {!loading && replyCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: T.mt,
              background: T.sf2, borderRadius: 8,
              padding: '2px 6px', border: `1px solid ${T.bd}`,
            }}>
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
        >
          ✕
        </button>
      </div>

      {/* ── Parent message ── */}
      <div style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${T.bd}`,
        background: `${T.ac}08`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Av name={parentName} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>{parentName}</span>
              <span style={{ fontSize: 10, color: T.mt }}>{relTime(parentMessage.created_at)}</span>
            </div>
            <div style={{
              fontSize: 13, color: T.mt, lineHeight: 1.5,
              overflow: 'hidden', display: '-webkit-box',
              WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
            }}>
              {parentMessage.text || '(encrypted message)'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Replies ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>

        {loading && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: T.mt, fontSize: 13 }}>
            Loading thread…
          </div>
        )}

        {!loading && error && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: T.err, fontSize: 12 }}>
            {error}
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 20px', color: T.mt }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No replies yet</div>
            <div style={{ fontSize: 11 }}>Be the first to reply in this thread.</div>
          </div>
        )}

        {!loading && messages.length > 0 && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 0 10px', marginBottom: 4,
            }}>
              <div style={{ flex: 1, height: 1, background: T.bd }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                {replyCount} {replyCount === 1 ? 'Reply' : 'Replies'}
              </span>
              <div style={{ flex: 1, height: 1, background: T.bd }} />
            </div>

            {messages.map((msg, i) => {
              const name = msg.authorName || resolveName(msg.author_id);
              const text = msgText(msg);
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const isGrouped = prevMsg && prevMsg.author_id === msg.author_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 5 * 60_000;

              return (
                <div
                  key={msg.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: isGrouped ? 2 : 10 }}
                >
                  {/* Avatar or spacer for grouped messages */}
                  <div style={{ width: 32, flexShrink: 0 }}>
                    {!isGrouped && <Av name={name} size={32} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {!isGrouped && (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: msg.author_id === api.userId ? T.ac : T.tx }}>
                          {name}
                        </span>
                        <span style={{ fontSize: 10, color: T.mt }}>{relTime(msg.created_at)}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: T.tx, lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {text}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div style={{
        padding: '10px 14px',
        borderTop: `1px solid ${T.bd}`,
        flexShrink: 0,
      }}>
        {error && !loading && (
          <div style={{ fontSize: 11, color: T.err, marginBottom: 6 }}>{error}</div>
        )}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: T.bg, borderRadius: 10, border: `1px solid ${T.bd}`,
          padding: '8px 10px',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={thread ? 'Reply in thread…' : 'Loading thread…'}
            disabled={!thread || sending}
            rows={1}
            style={{
              flex: 1, background: 'none', border: 'none', color: T.tx,
              fontSize: 13, resize: 'none', outline: 'none',
              fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
              maxHeight: 96, overflowY: 'auto',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !thread || sending}
            title="Send (Enter)"
            style={{
              background: input.trim() && thread ? `linear-gradient(135deg, ${T.ac}, ${T.ac2})` : T.sf2,
              border: 'none', borderRadius: 7, color: input.trim() && thread ? '#000' : T.mt,
              cursor: input.trim() && thread ? 'pointer' : 'default',
              padding: '5px 10px', fontSize: 14, lineHeight: 1, flexShrink: 0,
              transition: 'background .15s',
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 5, paddingLeft: 2 }}>
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
