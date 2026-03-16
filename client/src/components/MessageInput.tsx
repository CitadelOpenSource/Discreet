/**
 * MessageInput — Message composition bar for channels.
 *
 * Includes: text input, file upload, emoji/poll/gif triggers, priority
 * selector, @mention autocomplete, slash command suggestions, typing
 * indicator, reply/edit preview bar, read-only notice.
 * Pure rendering — all state lives in the parent.
 */
import React, { useRef } from 'react';
import { T, getInp } from '../theme';
import * as I from '../icons';
import { Av } from './Av';
import { SlashSuggestions } from '../hooks/useSlashCommands';

// ─── Types ──────────────────────────────────────────────────────────────

interface MemberInfo {
  user_id: string;
  username: string;
  display_name?: string;
  nickname?: string;
}

export interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileUpload: (file: File) => void;
  onTyping: () => void;
  channelName: string;
  disabled: boolean;       // read-only channel
  isEditing: boolean;

  // Reply/Edit state
  replyTo: { text?: string } | null;
  editMsg: { text?: string } | null;
  onCancelReplyEdit: () => void;

  // Priority
  priority: 'normal' | 'important' | 'urgent';
  onCyclePriority: () => void;

  // Toolbar triggers
  onEmojiPicker: () => void;
  onPollCreate: () => void;
  onGifPicker: () => void;

  // @mention autocomplete
  members: MemberInfo[];
  serverId?: string;
  serverOwnerId?: string;
  roles: any[];
  isGuest: boolean;

  // Typing indicator
  typingNames: string[];

  // Up arrow edit
  onEditLastMessage: () => void;

  // Slash tools
  slashTool: string | null;
  onSlashToolClose: () => void;
  slashToolContent: React.ReactNode;

  // Archived
  isArchived: boolean;
  archivedDeletionDate?: string | null;

  // Ref
  inputRef: React.RefObject<HTMLInputElement>;
}

// ─── Component ──────────────────────────────────────────────────────────

export function MessageInput(props: MessageInputProps) {
  const {
    value, onChange, onSend, onFileUpload, onTyping,
    channelName, disabled, isEditing,
    replyTo, editMsg, onCancelReplyEdit,
    priority, onCyclePriority,
    onEmojiPicker, onPollCreate, onGifPicker,
    members, serverOwnerId, roles, isGuest,
    typingNames,
    onEditLastMessage,
    slashTool, onSlashToolClose, slashToolContent,
    isArchived, archivedDeletionDate,
    inputRef,
  } = props;

  // Read-only channel notice
  if (disabled) {
    return (
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${T.bd}`, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: T.mt, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>📣</span> This is a read-only channel.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div style={{ padding: '2px 16px 4px', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, color: T.mt, fontStyle: 'italic' }}>
            {typingNames.length === 1
              ? `${typingNames[0]} is typing`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing`
                : `${typingNames[0]} and ${typingNames.length - 1} others are typing`}
          </span>
          <span aria-hidden="true">
            <span className="typing-dot" style={{ color: T.ac }}>.</span>
            <span className="typing-dot" style={{ color: T.ac }}>.</span>
            <span className="typing-dot" style={{ color: T.ac }}>.</span>
          </span>
        </div>
      )}

      {/* Reply/Edit bar */}
      {(replyTo || editMsg) && (
        <div style={{ padding: '6px 16px', background: T.sf2, borderTop: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ color: T.ac }}>{editMsg ? '✏️ Editing' : '↩ Replying to'}</span>
          <span style={{ color: T.mt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editMsg?.text || replyTo?.text}</span>
          <span onClick={onCancelReplyEdit} style={{ cursor: 'pointer', color: T.mt }}>✕</span>
        </div>
      )}

      {/* Input area with autocomplete */}
      <div className="input-bar" style={{ position: 'relative' }}>
        {/* Slash command suggestions */}
        {value.startsWith('/') && (
          <SlashSuggestions input={value} members={members as any} roles={roles} isGuest={isGuest} onSet={onChange} />
        )}

        {/* @mention autocomplete */}
        {(() => {
          const atMatch = value.match(/@(\w*)$/);
          if (!atMatch) return null;
          const query = atMatch[1].toLowerCase();
          const matches = members.filter(m => (m.username?.toLowerCase().includes(query) || m.display_name?.toLowerCase().includes(query) || m.nickname?.toLowerCase().includes(query))).slice(0, 6);
          if (matches.length === 0) return null;
          return (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 12, padding: 4, marginBottom: 4, boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', maxHeight: 200, overflowY: 'auto', zIndex: 100 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, padding: '4px 8px', textTransform: 'uppercase' }}>Members</div>
              {matches.map(m => (
                <div key={m.user_id} onClick={() => onChange(value.replace(/@\w*$/, `@${m.nickname || m.display_name || m.username} `))} title={m.username} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,170,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <Av name={m.nickname || m.display_name || m.username} size={24} />
                  <span style={{ fontSize: 13 }}>{m.nickname || m.display_name || m.username}</span>
                  {m.nickname && <span style={{ fontSize: 10, color: T.mt }}>({m.username})</span>}
                  {m.user_id === serverOwnerId && <span style={{ fontSize: 9, color: '#faa61a' }}>👑</span>}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Slash tool overlays */}
        {slashTool && (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 16, right: 16, zIndex: 50 }}>
              <div style={{ width: 280, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>
                    {slashTool === 'calc' ? 'Calculator' : slashTool === 'convert' ? 'Unit Converter' : 'Color Picker'}
                  </span>
                  <span onClick={onSlashToolClose} style={{ cursor: 'pointer', color: T.mt, fontSize: 16, lineHeight: 1 }} title="Close (Esc)">✕</span>
                </div>
                {slashToolContent}
              </div>
            </div>
          </div>
        )}

        {/* Archived banner */}
        {isArchived && (
          <div style={{ padding: '10px 16px', background: 'rgba(255,165,0,0.08)', borderTop: '1px solid rgba(255,165,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>📦</span>
            <span style={{ fontSize: 12, color: '#ffa500', fontWeight: 600 }}>This server is archived and read-only.</span>
            {archivedDeletionDate && (
              <span style={{ fontSize: 11, color: T.err, marginLeft: 4 }}>
                Scheduled for deletion on {archivedDeletionDate}.
              </span>
            )}
          </div>
        )}

        {/* Input row */}
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.bd}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Attach file">
              <I.Paperclip />
              <input type="file" style={{ display: 'none' }} onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileUpload(file);
                e.target.value = '';
              }} />
            </label>
            <input
              ref={inputRef}
              value={value}
              onChange={e => { onChange(e.target.value); onTyping(); }}
              onKeyDown={e => {
                if (e.key === 'Escape') onSlashToolClose();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
                if (e.key === 'ArrowUp' && !value.trim()) { e.preventDefault(); onEditLastMessage(); }
                if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); onEmojiPicker(); }
              }}
              placeholder={isEditing ? 'Edit message...' : `Message #${channelName} (encrypted)`}
              style={{ flex: 1, padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 12, color: T.tx, fontSize: 14, outline: 'none', fontFamily: "'DM Sans',sans-serif" }}
            />
            <div onClick={onCyclePriority} title={`Priority: ${priority} (click to cycle)`} style={{ cursor: 'pointer', padding: 4, fontSize: 13, color: priority === 'urgent' ? '#ff6b35' : priority === 'important' ? '#faa61a' : T.mt }}>
              {priority === 'urgent' ? '🔴' : priority === 'important' ? '🟡' : '⚪'}
            </div>
            <div onClick={onEmojiPicker} style={{ cursor: 'pointer', color: T.mt, padding: 4 }}><I.Smile /></div>
            <div onClick={onPollCreate} style={{ cursor: 'pointer', color: T.mt, padding: 4, fontSize: 13 }} title="Create Poll">📊</div>
            <div onClick={onGifPicker} style={{ cursor: 'pointer', color: T.mt, padding: 4, fontSize: 11, fontWeight: 700 }} title="GIF">GIF</div>
            <div onClick={onSend} role="button" aria-label="Send message" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onSend(); }} style={{ padding: '8px 14px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, borderRadius: 12, cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13 }}>Send</div>
          </div>
        </div>
      </div>
    </>
  );
}
