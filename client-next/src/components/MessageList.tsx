/**
 * MessageList — Pure rendering component for channel message history.
 *
 * Extracted from App.tsx. All state lives in the parent — this component
 * receives data via props and communicates via callbacks.
 */
import React, { useRef } from 'react';
import { T } from '../theme';
import * as I from '../icons';
import { useTimezone } from '../hooks/TimezoneContext';
import { Av } from './Av';
import { Markdown } from './Markdown';
import { LinkPreview } from './LinkPreview';
import { InvitePreview } from './InvitePreview';
import { EmojiPicker, getQuickReact, type CustomEmoji } from './EmojiPicker';
import { filterMessage, getProfanityLevel } from '../utils/profanityFilter';

// ─── Skeleton helpers (inline to avoid circular imports) ────────────────
const shimBase: React.CSSProperties = {
  background: 'linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.09) 50%,rgba(255,255,255,0.04) 75%)',
  backgroundSize: '400% 100%',
  animation: 'shimmer 1.5s infinite',
};
function SkeletonBar({ w = '100%', h = 14, mb = 8 }: { w?: string | number; h?: number; mb?: number }) {
  return <div style={{ ...shimBase, width: w, height: h, borderRadius: 6, marginBottom: mb }} />;
}
function SkeletonCircle({ size = 36 }: { size?: number }) {
  return <div style={{ ...shimBase, width: size, height: size, borderRadius: size / 2, flexShrink: 0 }} />;
}
function MessageSkeleton({ count = 8 }: { count?: number }) {
  return (<>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 16px', animation: `fadeIn 0.3s ${i * 0.04}s both` }}>
        <SkeletonCircle size={36} />
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <SkeletonBar w={`${60 + (i * 23) % 60}px`} h={12} mb={0} />
            <SkeletonBar w={40} h={10} mb={0} />
          </div>
          <SkeletonBar w={`${40 + (i * 17) % 55}%`} h={13} mb={4} />
          {i % 3 === 0 && <SkeletonBar w={`${25 + (i * 11) % 40}%`} h={13} mb={0} />}
        </div>
      </div>
    ))}
  </>);
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface Msg {
  id: string;
  author_id: string;
  content_ciphertext: string;
  mls_epoch: number;
  created_at: string;
  reply_to_id?: string;
  parent_message_id?: string;
  reply_count?: number;
  mentioned_user_ids?: string[];
  text?: string;
  authorName?: string;
  priority?: string;
  is_auto_reply?: boolean;
}

export interface MessageListProps {
  messages: Msg[];
  currentUserId: string;
  channelId: string;
  channelName: string;
  serverId?: string;
  isReadOnly: boolean;

  // Display settings
  msgDensity: 'comfortable' | 'compact' | 'cozy';
  chatFontSize: number;
  showLinkPreviews: boolean;

  // State from parent
  highlightedMsg: string | null;
  failedMessages: Record<string, any>;
  bookmarkedIds: Set<string>;
  reactions: Record<string, any[]>;
  ackCounts: Record<string, { ack: number; total: number; myAck: boolean }>;
  pollVotes: Record<string, number | null>;
  serverEmoji: CustomEmoji[];
  joinedServerIds: string[];
  agentDisclosure: string | null;

  // Loading states
  loadingMessages: boolean;
  showMessagesSkeleton: boolean;
  loadingMore: boolean;

  // Name resolution
  getName: (uid: string) => string;
  getRawUsername: (uid: string) => string;
  renderPlatformBadge: (uid: string) => React.ReactNode;
  getMembers: () => { user_id: string; username: string; display_name?: string }[];
  getProfanityServerId: () => string | null;

  // Callbacks
  onScroll: (scrollTop: number) => void;
  onLoadMore: () => Promise<void>;
  onContextMenu: (e: React.MouseEvent, m: Msg) => void;
  onProfileClick: (userId: string, pos: { x: number; y: number }) => void;
  onReply: (m: Msg) => void;
  onReact: (msgId: string, emoji: string) => void;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onEmojiTarget: (msgId: string) => void;
  onPin: (msgId: string) => Promise<void>;
  onBookmark: (m: Msg) => void;
  onReport: (m: Msg) => void;
  onRetryFailed: (tempId: string) => void;
  onAck: (msgId: string) => Promise<void>;
  onVotePoll: (pollId: string, optionIdx: number, prevVote: number | null) => void;
  onOpenThread: (m: Msg) => void;
  onDismissDisclosure: () => void;
  onJoinedServer: () => void;

  // Refs
  msgEndRef: React.RefObject<HTMLDivElement>;
}

// ─── Component ──────────────────────────────────────────────────────────

export function MessageList(props: MessageListProps) {
  const tzCtx = useTimezone();
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    messages, currentUserId, channelId, channelName, isReadOnly,
    msgDensity, chatFontSize, showLinkPreviews,
    highlightedMsg, failedMessages, bookmarkedIds, reactions, ackCounts, pollVotes,
    serverEmoji, joinedServerIds, agentDisclosure,
    loadingMessages, showMessagesSkeleton, loadingMore,
    getName, getRawUsername, renderPlatformBadge, getMembers, getProfanityServerId,
    onScroll, onLoadMore, onContextMenu, onProfileClick, onReply,
    onReact, onToggleReaction, onEmojiTarget, onPin, onBookmark, onReport,
    onRetryFailed, onAck, onVotePoll, onOpenThread, onDismissDisclosure, onJoinedServer,
    msgEndRef,
  } = props;

  // Virtual scroll
  const MSG_H = msgDensity === 'compact' ? 38 : msgDensity === 'cozy' ? 64 : 52;
  const BUFFER = 20;
  const containerH = scrollRef.current?.clientHeight || 600;
  const scrollTop = scrollRef.current?.scrollTop || 0;
  const startIdx = Math.max(0, Math.floor(scrollTop / MSG_H) - BUFFER);
  const endIdx = Math.min(messages.length, Math.ceil((scrollTop + containerH) / MSG_H) + BUFFER);
  const visibleMessages = messages.slice(startIdx, endIdx);

  const profanityServerId = getProfanityServerId();
  const profanityLevel = profanityServerId ? getProfanityLevel(profanityServerId) : 'off';
  const members = getMembers();

  return (
    <div
      ref={scrollRef}
      onScroll={async (e) => {
        const el = e.currentTarget;
        onScroll(el.scrollTop);
        if (el.scrollTop < 50 && messages.length >= 50 && !loadingMore) {
          await onLoadMore();
        }
      }}
      className={`density-${msgDensity}`}
      role="log"
      aria-live="polite"
      aria-label="Message history"
      style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}
    >
      {/* Load more skeleton */}
      {loadingMore && (
        <div style={{ padding: '4px 0' }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 16px' }}>
              <SkeletonCircle size={36} />
              <div style={{ flex: 1, paddingTop: 2 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <SkeletonBar w={`${50 + (i * 19) % 50}px`} h={12} mb={0} />
                </div>
                <SkeletonBar w={`${30 + (i * 23) % 50}%`} h={13} mb={0} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent disclosure banner */}
      {agentDisclosure && (
        <div style={{ background: '#1a1a2e', borderLeft: '3px solid #f0b232', borderRadius: 12, padding: 12, margin: '8px 16px 8px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🛡️</span>
          <span style={{ flex: 1, fontSize: 13, color: '#e0e0e0', lineHeight: 1.5 }}>{agentDisclosure}</span>
          <span onClick={onDismissDisclosure} title="Dismiss" style={{ cursor: 'pointer', color: '#888', fontSize: 15, flexShrink: 0, lineHeight: 1, paddingTop: 1 }}>✕</span>
        </div>
      )}

      {/* Loading skeleton */}
      {showMessagesSkeleton && messages.length === 0 && <MessageSkeleton count={8} />}

      {/* Empty state */}
      {!loadingMessages && !showMessagesSkeleton && messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: T.mt, animation: 'fadeIn 0.25s ease' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 32, background: `${T.ac}12`, marginBottom: 16 }}><I.Hash s={28} /></div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.tx }}>Welcome to #{channelName}</div>
          <div style={{ fontSize: 13, color: T.mt, marginTop: 6, lineHeight: 1.5 }}>
            This is the start of <strong style={{ color: T.tx }}>#{channelName}</strong>. Send the first message!
          </div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}><I.Lock s={10} /> Messages are end-to-end encrypted</div>
        </div>
      )}

      {/* Virtual scroll top spacer */}
      {messages.length > 0 && <div style={{ height: startIdx * MSG_H }} />}

      {/* Message rows */}
      {visibleMessages.map((m, vi) => {
        const idx = startIdx + vi;
        const prevMsg = idx > 0 ? messages[idx - 1] : null;
        const curDateKey = tzCtx.formatDate(m.created_at);
        const showDateSep = !prevMsg || tzCtx.formatDate(prevMsg.created_at) !== curDateKey;
        const msgText = filterMessage(m.text || m.content_ciphertext, profanityLevel);

        const onMention = (username: string, e: React.MouseEvent) => {
          const mentioned = members.find(u => u.username === username || u.display_name === username);
          if (mentioned) onProfileClick(mentioned.user_id, { x: e.clientX, y: e.clientY });
        };
        const mentionStyle = (username: string): React.CSSProperties => {
          const mentioned = members.find(u => u.username === username || u.display_name === username);
          const isSelf = mentioned?.user_id === currentUserId;
          return { background: isSelf ? 'rgba(0,212,170,0.2)' : 'rgba(88,101,242,0.2)', color: isSelf ? T.ac : '#5865F2', padding: '0 3px', borderRadius: 3, cursor: 'pointer', fontWeight: 600 };
        };

        if (m.is_auto_reply) {
          return (
            <div key={m.id} style={{ padding: '2px 16px 2px 62px', fontSize: 13, color: T.mt, fontStyle: 'italic' }}>
              {m.authorName || getName(m.author_id)} is away: {m.text}
            </div>
          );
        }

        return (
          <React.Fragment key={m.id}>
            {showDateSep && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: T.bd }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: T.mt }}>{tzCtx.dateDividerLabel(m.created_at)}</span>
                <div style={{ flex: 1, height: 1, background: T.bd }} />
              </div>
            )}

            <div
              className="msg-row"
              data-msg-id={m.id}
              onContextMenu={e => onContextMenu(e, m)}
              style={{
                display: 'flex',
                gap: msgDensity === 'compact' ? 6 : msgDensity === 'cozy' ? 12 : 10,
                padding: msgDensity === 'compact' ? '1px 16px' : msgDensity === 'cozy' ? '6px 16px' : '4px 16px',
                position: 'relative',
                background: m.priority === 'urgent' ? 'rgba(255,107,53,0.08)' : m.priority === 'important' ? 'rgba(250,166,26,0.06)' : highlightedMsg === m.id ? 'rgba(0,212,170,0.12)' : (m.mentioned_user_ids?.includes(currentUserId) ? 'rgba(0,212,170,0.06)' : 'transparent'),
                transition: 'background .15s ease',
                borderLeft: m.priority === 'urgent' ? '3px solid #ff6b35' : m.priority === 'important' ? '3px solid #faa61a' : m.author_id === currentUserId ? `2px solid ${T.ac}44` : '2px solid transparent',
              }}
              onMouseEnter={e => { if (highlightedMsg !== m.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              onMouseLeave={e => { if (highlightedMsg !== m.id) e.currentTarget.style.background = 'transparent'; }}
            >
              {/* Avatar */}
              <div className="msg-avatar" onClick={e => onProfileClick(m.author_id, { x: e.clientX, y: e.clientY })} style={{ cursor: 'pointer', flexShrink: 0 }}>
                <Av name={getName(m.author_id)} size={msgDensity === 'compact' ? 28 : msgDensity === 'cozy' ? 44 : 36} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Reply indicator */}
                {m.reply_to_id && <div style={{ fontSize: 11, color: T.mt, marginBottom: 2, paddingLeft: 12, borderLeft: `2px solid ${T.bd}` }}>↩ replying to a message</div>}

                {/* Name + badges + timestamp */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="msg-name" onClick={e => onProfileClick(m.author_id, { x: e.clientX, y: e.clientY })} title={getRawUsername(m.author_id)} style={{ fontWeight: 600, fontSize: msgDensity === 'compact' ? 12 : 14, color: m.author_id === currentUserId ? T.ac : T.tx, cursor: 'pointer' }}>{getName(m.author_id)}</span>
                  {renderPlatformBadge(m.author_id)}
                  {m.priority === 'urgent' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(255,107,53,0.2)', color: '#ff6b35' }}>URGENT</span>}
                  {m.priority === 'important' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(250,166,26,0.2)', color: '#faa61a' }}>IMPORTANT</span>}
                  {msgDensity === 'compact' && <span title={tzCtx.formatFullTooltip(m.created_at)} style={{ fontSize: 9, color: T.mt, cursor: 'default', whiteSpace: 'nowrap' }}>{tzCtx.formatRelative(m.created_at)}</span>}
                  <span style={{ flex: 1 }} />
                  {msgDensity !== 'compact' && <span title={tzCtx.formatFullTooltip(m.created_at)} style={{ fontSize: 10, color: T.mt, cursor: 'default', whiteSpace: 'nowrap' }}>{tzCtx.formatRelative(m.created_at)}</span>}
                </div>

                {/* Message text */}
                <div className="msg-text" style={{ fontSize: chatFontSize, lineHeight: msgDensity === 'compact' ? 1.3 : msgDensity === 'cozy' ? 1.6 : 1.5, wordBreak: 'break-word', opacity: failedMessages[m.id] ? 0.5 : 1 }}>
                  <Markdown text={msgText} onMention={onMention} mentionStyle={mentionStyle} />
                </div>

                {/* Failed message retry */}
                {failedMessages[m.id] && (
                  <div onClick={() => onRetryFailed(m.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)', color: T.err, fontSize: 11, cursor: 'pointer', fontWeight: 600 }} title="Click to retry sending">
                    ⚠ Failed — click to retry
                  </div>
                )}

                {/* Urgent ack bar */}
                {m.priority === 'urgent' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '4px 10px', borderRadius: 6, background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.2)' }}>
                    {ackCounts[m.id] ? (
                      <span style={{ fontSize: 11, color: '#ff6b35', fontWeight: 600 }}>{ackCounts[m.id].ack}/{ackCounts[m.id].total} acknowledged</span>
                    ) : (
                      <span style={{ fontSize: 11, color: T.mt }}>Acknowledgement required</span>
                    )}
                    <span style={{ flex: 1 }} />
                    {(!ackCounts[m.id] || !ackCounts[m.id].myAck) && m.author_id !== currentUserId && (
                      <button onClick={() => onAck(m.id)} style={{ padding: '3px 12px', borderRadius: 5, border: 'none', background: '#ff6b35', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Acknowledge</button>
                    )}
                    {ackCounts[m.id]?.myAck && <span style={{ fontSize: 10, color: '#3ba55d' }}>✓ Acknowledged</span>}
                  </div>
                )}

                {/* Important indicator */}
                {m.priority === 'important' && (
                  <div style={{ fontSize: 10, color: '#faa61a', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>⚠ Important message</div>
                )}

                {/* Invite previews */}
                {(msgText.match(/https?:\/\/[^\s<>]*\/invite\/[A-Za-z0-9]+\/?/g) || []).map((invUrl: string, i: number) => (
                  <InvitePreview key={`inv-${m.id}-${i}`} url={invUrl} joinedServerIds={joinedServerIds} onJoined={onJoinedServer} />
                ))}

                {/* Attachments */}
                {(m as any).attachments?.map((a: any) => (
                  <div key={a.id || a.url} style={{ marginTop: 4 }}>
                    {a.content_type?.startsWith('image/') ? (
                      <img src={a.url} alt={a.filename} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8 }} />
                    ) : (
                      <a href={a.url} target="_blank" rel="noopener" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: T.sf2, borderRadius: 6, border: `1px solid ${T.bd}`, color: T.ac, fontSize: 12, textDecoration: 'none' }}>
                        <I.Download /> {a.filename || 'Download'} {a.size ? `(${(a.size / 1024).toFixed(0)}KB)` : ''}
                      </a>
                    )}
                  </div>
                ))}

                {/* Link previews */}
                {showLinkPreviews && m.text && <LinkPreview text={msgText} />}

                {/* Reactions */}
                {reactions[m.id]?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {Object.entries(reactions[m.id].reduce((acc: any, r: any) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(([emoji, count]) => {
                      const mine = (reactions[m.id] || []).some(r => r.emoji === emoji && r.user_id === currentUserId);
                      return (
                        <span key={emoji} onClick={() => onToggleReaction(m.id, emoji)} title={mine ? 'Remove reaction' : 'Add reaction'} style={{ padding: '1px 6px', background: mine ? `${T.ac}22` : T.sf2, borderRadius: 4, fontSize: 12, cursor: 'pointer', border: `1px solid ${mine ? T.ac : T.bd}`, color: mine ? T.ac : T.tx, fontWeight: mine ? 600 : 400, transition: 'background .1s, border-color .1s' }}>
                          {emoji} {count as number}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Thread reply count */}
                {(m.reply_count ?? 0) > 0 && (
                  <div onClick={() => onOpenThread(m)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', background: `${T.ac}14`, borderRadius: 8, cursor: 'pointer', fontSize: 11, color: T.ac, fontWeight: 600, border: `1px solid ${T.ac}22`, transition: 'background .15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = `${T.ac}22`}
                    onMouseLeave={e => e.currentTarget.style.background = `${T.ac}14`}>
                    <I.Reply /> {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
                  </div>
                )}
              </div>

              {/* Hover action bar */}
              <div className="msg-actions" style={{ position: 'absolute', top: -4, right: 16, display: 'none', gap: 2, background: T.sf, borderRadius: 4, border: `1px solid ${T.bd}`, padding: 2, zIndex: 10 }}>
                {getQuickReact().map(em => (
                  <span key={em} onClick={() => onReact(m.id, em)} style={{ cursor: 'pointer', padding: '2px 4px', fontSize: 14 }} title={em}>{em}</span>
                ))}
                <span onClick={() => onEmojiTarget(m.id)} style={{ cursor: 'pointer', padding: '2px 4px', fontSize: 12, color: T.mt }} title="More reactions">＋</span>
                <span style={{ width: 1, background: T.bd, margin: '0 2px' }} />
                <span onClick={() => onReply(m)} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="Reply"><I.Reply /></span>
                <span onClick={() => onPin(m.id)} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="Pin">📌</span>
                <span onClick={() => onBookmark(m)} style={{ cursor: 'pointer', padding: '2px 4px', color: bookmarkedIds.has(m.id) ? T.ac : T.mt, fontSize: 12 }} title={bookmarkedIds.has(m.id) ? 'Remove bookmark' : 'Bookmark'}><I.Bookmark /></span>
                {m.author_id !== currentUserId && <span onClick={() => onReport(m)} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="Report message"><I.Flag /></span>}
                <span onClick={e => onContextMenu(e, m)} style={{ cursor: 'pointer', padding: '2px 4px', color: T.mt, fontSize: 12 }} title="More">⋯</span>
              </div>
            </div>
          </React.Fragment>
        );
      })}

      {/* Virtual scroll bottom spacer */}
      {messages.length > 0 && <div style={{ height: (messages.length - endIdx) * MSG_H }} />}
      <div ref={msgEndRef} />
    </div>
  );
}
