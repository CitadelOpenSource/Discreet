/**
 * MessageInput — Message composition bar for channels.
 *
 * Features: text input, multi-file attachments (up to 10) with preview strip,
 * emoji/poll/gif/schedule triggers via overflow menu, @mention autocomplete,
 * slash command suggestions, typing indicator, reply/edit preview bar,
 * voice recording. Mobile: bottom sheet for attachments with
 * camera/photo/file/voice, drag-and-drop on desktop, image compression.
 */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { T, getInp } from '../theme';
import { I } from '../icons';
import { Av } from './Av';
import { SlashSuggestions } from '../hooks/useSlashCommands';
import { VoiceRecorder } from './VoiceMessage';

// ─── Constants ───────────────────────────────────────────────────────────

const MAX_FILES = 10;
const COMPRESS_MAX_PX = 2048;
const COMPRESS_QUALITY = 0.85;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

// ─── Types ───────────────────────────────────────────────────────────────

interface MemberInfo {
  user_id: string;
  username: string;
  display_name?: string;
  nickname?: string;
}

interface PendingFile {
  id: string;
  file: File;
  preview?: string; // data URL for images
  progress: number; // 0-100
  error?: string;
}

export interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileUpload: (file: File) => void;
  onTyping: () => void;
  channelName: string;
  disabled: boolean;
  isEditing: boolean;
  isMobile?: boolean;
  maxFileSize?: number; // bytes, from tier limits

  replyTo: { text?: string } | null;
  editMsg: { text?: string } | null;
  onCancelReplyEdit: () => void;

  priority?: 'normal' | 'important' | 'urgent';
  onCyclePriority?: () => void;

  onEmojiPicker: () => void;
  onPollCreate: () => void;
  onGifPicker: () => void;

  members: MemberInfo[];
  serverId?: string;
  serverOwnerId?: string;
  roles: any[];
  isGuest: boolean;

  typingNames: string[];
  onEditLastMessage: () => void;

  slashTool: string | null;
  onSlashToolClose: () => void;
  slashToolContent: React.ReactNode;

  onVoiceSend: (blob: Blob, durationMs: number, waveform: number[]) => void;
  onSchedule: () => void;

  isArchived: boolean;
  archivedDeletionDate?: string | null;

  inputRef: React.RefObject<HTMLInputElement>;
}

// ─── Overflow menu (Poll / GIF / Schedule) ──────────────────────────────

function OverflowMenu({ onPollCreate, onGifPicker, onSchedule }: { onPollCreate: () => void; onGifPicker: () => void; onSchedule: () => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(v => !v)} style={{ cursor: 'pointer', color: open ? T.ac : T.mt, padding: 4, fontSize: 18, lineHeight: 1, letterSpacing: 1, fontWeight: 700 }} title="More options" aria-label="More options">
        {'\u00B7\u00B7\u00B7'}
      </div>
      {open && (
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
          background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 160, padding: 4, zIndex: 100,
        }}>
          {[
            { label: 'Create Poll', fn: onPollCreate },
            { label: 'GIF', fn: onGifPicker },
            { label: 'Schedule Message', fn: onSchedule },
          ].map(item => (
            <div key={item.label} onClick={() => { item.fn(); setOpen(false); }}
              style={{ padding: '8px 12px', fontSize: 13, color: T.tx, borderRadius: 6, cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Image compression ───────────────────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  if (!IMAGE_TYPES.includes(file.type) || file.type === 'image/gif') return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Downscale if larger than max
      if (width > COMPRESS_MAX_PX || height > COMPRESS_MAX_PX) {
        const ratio = Math.min(COMPRESS_MAX_PX / width, COMPRESS_MAX_PX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
          resolve(compressed);
        },
        'image/jpeg',
        COMPRESS_QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─── Component ───────────────────────────────────────────────────────────

export function MessageInput(props: MessageInputProps) {
  const {
    value, onChange, onSend, onFileUpload, onTyping,
    channelName, disabled, isEditing, isMobile,
    maxFileSize,
    replyTo, editMsg, onCancelReplyEdit,
    onEmojiPicker, onPollCreate, onGifPicker,
    members, serverOwnerId, roles, isGuest,
    typingNames,
    onEditLastMessage,
    slashTool, onSlashToolClose, slashToolContent,
    onVoiceSend,
    onSchedule,
    isArchived, archivedDeletionDate,
    inputRef,
  } = props;

  const [recording, setRecording] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showFormatting, setShowFormatting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cameraPreview, setCameraPreview] = useState<{ file: File; url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingFiles.forEach(pf => { if (pf.preview) URL.revokeObjectURL(pf.preview); });
      if (cameraPreview) URL.revokeObjectURL(cameraPreview.url);
    };
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Add files (with validation + compression) ──
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const remaining = MAX_FILES - pendingFiles.length;
    if (remaining <= 0) return;
    const batch = arr.slice(0, remaining);

    const newPending: PendingFile[] = [];
    for (const raw of batch) {
      // Empty file check
      if (raw.size === 0) {
        newPending.push({
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
          file: raw,
          progress: 0,
          error: 'Cannot upload empty files',
        });
        continue;
      }

      // Size check
      if (maxFileSize && raw.size > maxFileSize) {
        newPending.push({
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
          file: raw,
          progress: 0,
          error: `File too large (${formatFileSize(raw.size)}). Max: ${formatFileSize(maxFileSize)}`,
        });
        continue;
      }

      // Compress images
      const processed = IMAGE_TYPES.includes(raw.type) ? await compressImage(raw) : raw;
      const preview = IMAGE_TYPES.includes(processed.type) ? URL.createObjectURL(processed) : undefined;

      newPending.push({
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        file: processed,
        preview,
        progress: 0,
      });
    }

    setPendingFiles(prev => [...prev, ...newPending]);
  }, [pendingFiles.length, maxFileSize]);

  // ── Remove a pending file ──
  const removeFile = (id: string) => {
    setPendingFiles(prev => {
      const removed = prev.find(f => f.id === id);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return prev.filter(f => f.id !== id);
    });
  };

  // ── Upload all pending files ──
  const uploadPending = async () => {
    const toUpload = pendingFiles.filter(f => !f.error);
    for (let i = 0; i < toUpload.length; i++) {
      const pf = toUpload[i];
      setPendingFiles(prev => prev.map(f => f.id === pf.id ? { ...f, progress: 50 } : f));
      try {
        await onFileUpload(pf.file);
        setPendingFiles(prev => prev.map(f => f.id === pf.id ? { ...f, progress: 100 } : f));
      } catch {
        setPendingFiles(prev => prev.map(f => f.id === pf.id ? { ...f, error: 'Upload failed', progress: 0 } : f));
      }
    }
    // Clear completed after a short delay
    setTimeout(() => setPendingFiles(prev => prev.filter(f => f.progress !== 100)), 800);
  };

  // ── Send message + files ──
  const handleSend = () => {
    if (pendingFiles.length > 0 && pendingFiles.some(f => !f.error)) {
      uploadPending();
    }
    if (value.trim()) {
      onSend();
    }
  };

  // ── Drag and drop (desktop) ──
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) setDragOver(false); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  // ── Camera capture handler ──
  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCameraPreview({ file, url });
    }
    e.target.value = '';
  };

  const confirmCameraPhoto = async () => {
    if (!cameraPreview) return;
    const compressed = await compressImage(cameraPreview.file);
    addFiles([compressed]);
    URL.revokeObjectURL(cameraPreview.url);
    setCameraPreview(null);
  };

  const cancelCameraPhoto = () => {
    if (cameraPreview) URL.revokeObjectURL(cameraPreview.url);
    setCameraPreview(null);
  };

  // Read-only channel notice
  if (disabled) {
    return (
      <div style={{ padding: '14px 16px', borderTop: `1px solid ${T.bd}`, textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: T.mt, fontSize: 13 }}>
          <span style={{ fontSize: 16 }}>{'\uD83D\uDCE3'}</span> This is a read-only channel.
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="message-input"
      data-component="MessageInput"
      ref={dropZoneRef}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ position: 'relative' }}
    >
      {/* ── Drag-and-drop overlay (desktop) ── */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: `${T.ac}15`, border: `2px dashed ${T.ac}`,
          borderRadius: 'var(--border-radius)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.ac }}>
            Drop files to upload (max {MAX_FILES})
          </div>
        </div>
      )}

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
          <span style={{ color: T.ac }}>{editMsg ? '\u270F\uFE0F Editing' : '\u21A9 Replying to'}</span>
          <span style={{ color: T.mt, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{editMsg?.text || replyTo?.text}</span>
          <span onClick={onCancelReplyEdit} style={{ cursor: 'pointer', color: T.mt }}>{'\u2715'}</span>
        </div>
      )}

      {/* ── Pending file preview strip ── */}
      {pendingFiles.length > 0 && (
        <div style={{
          padding: '8px 16px', borderTop: `1px solid ${T.bd}`, background: T.sf2,
          display: 'flex', gap: 8, overflowX: 'auto', alignItems: 'flex-start',
        }}>
          {pendingFiles.map(pf => (
            <div key={pf.id} style={{
              position: 'relative', width: 80, flexShrink: 0,
              borderRadius: 'var(--radius-md)', overflow: 'hidden',
              border: pf.error ? '1px solid #ff4757' : `1px solid ${T.bd}`,
              background: T.bg,
            }}>
              {pf.preview ? (
                <img src={pf.preview} alt={pf.file.name} style={{ width: 80, height: 60, objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ width: 80, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mt }}>
                  <I.Paperclip s={20} />
                </div>
              )}
              {/* Filename */}
              <div style={{ padding: '2px 4px', fontSize: 9, color: T.mt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pf.file.name}
              </div>
              {/* Error */}
              {pf.error && (
                <div style={{ padding: '2px 4px', fontSize: 8, color: '#ff4757', lineHeight: 1.3 }}>{pf.error}</div>
              )}
              {/* Progress bar */}
              {pf.progress > 0 && pf.progress < 100 && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: T.bd }}>
                  <div style={{ height: '100%', width: `${pf.progress}%`, background: T.ac, transition: 'width 0.3s' }} />
                </div>
              )}
              {/* Remove button */}
              <div onClick={() => removeFile(pf.id)} style={{
                position: 'absolute', top: 2, right: 2, width: 18, height: 18,
                borderRadius: 9, background: 'rgba(0,0,0,0.7)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 12, lineHeight: 1,
              }} aria-label="Remove file">{'\u2715'}</div>
            </div>
          ))}
          {pendingFiles.length < MAX_FILES && (
            <div onClick={() => fileInputRef.current?.click()} style={{
              width: 80, height: 60, flexShrink: 0, borderRadius: 'var(--radius-md)',
              border: `1px dashed ${T.bd}`, display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', color: T.mt,
            }}>
              <I.Plus s={20} />
            </div>
          )}
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
            <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', padding: 4, marginBottom: 4, boxShadow: '0 -4px 16px rgba(0,0,0,0.3)', maxHeight: 200, overflowY: 'auto', zIndex: 100 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, padding: '4px 8px', textTransform: 'uppercase' }}>Members</div>
              {matches.map(m => (
                <div key={m.user_id} onClick={() => onChange(value.replace(/@\w*$/, `@${m.nickname || m.display_name || m.username} `))} title={m.username} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,170,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <Av name={m.nickname || m.display_name || m.username} size={24} />
                  <span style={{ fontSize: 13 }}>{m.nickname || m.display_name || m.username}</span>
                  {m.nickname && <span style={{ fontSize: 10, color: T.mt }}>({m.username})</span>}
                  {m.user_id === serverOwnerId && <span style={{ fontSize: 9, color: '#faa61a' }}>{'\uD83D\uDC51'}</span>}
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
                  <span onClick={onSlashToolClose} style={{ cursor: 'pointer', color: T.mt, fontSize: 16, lineHeight: 1 }} title="Close (Esc)">{'\u2715'}</span>
                </div>
                {slashToolContent}
              </div>
            </div>
          </div>
        )}

        {/* Archived banner */}
        {isArchived && (
          <div style={{ padding: '10px 16px', background: 'rgba(255,165,0,0.08)', borderTop: '1px solid rgba(255,165,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13 }}>{'\uD83D\uDCE6'}</span>
            <span style={{ fontSize: 12, color: '#ffa500', fontWeight: 600 }}>This server is archived and read-only.</span>
            {archivedDeletionDate && (
              <span style={{ fontSize: 11, color: T.err, marginLeft: 4 }}>
                Scheduled for deletion on {archivedDeletionDate}.
              </span>
            )}
          </div>
        )}

        {/* Voice recorder bar (replaces input row while recording) */}
        {recording ? (
          <VoiceRecorder
            onSend={(blob, dur, wf) => { setRecording(false); onVoiceSend(blob, dur, wf); }}
            onCancel={() => setRecording(false)}
          />
        ) : (
        /* Input row */
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${T.bd}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Attach button — opens bottom sheet on mobile, file picker on desktop */}
            <div onClick={() => isMobile ? setShowAttachSheet(true) : fileInputRef.current?.click()}
              style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Attach file" aria-label="Attach file">
              <I.Plus s={20} />
            </div>
            <input
              ref={inputRef}
              value={value}
              onChange={e => { onChange(e.target.value); onTyping(); }}
              onKeyDown={e => {
                if (e.key === 'Escape') onSlashToolClose();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                if (e.key === 'ArrowUp' && !value.trim()) { e.preventDefault(); onEditLastMessage(); }
                if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); onEmojiPicker(); }
              }}
              placeholder={isEditing ? 'Edit message...' : `Message #${channelName} (encrypted)`}
              style={{ flex: 1, padding: '10px 14px', background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', color: T.tx, fontSize: 14, outline: 'none', fontFamily: 'var(--font-primary)' }}
            />
            {/* Mobile: "Aa" formatting toggle */}
            {isMobile ? (
              <div onClick={() => setShowFormatting(v => !v)} style={{ cursor: 'pointer', color: showFormatting ? T.ac : T.mt, padding: 4, fontSize: 14, fontWeight: 700 }} title="Formatting" aria-label="Show formatting">
                Aa
              </div>
            ) : (<>
              <div onClick={() => setRecording(true)} style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Voice message" aria-label="Record voice message"><I.Mic s={20} /></div>
              <div onClick={onEmojiPicker} style={{ cursor: 'pointer', color: T.mt, padding: 4 }} title="Emoji (Ctrl+E)" aria-label="Emoji"><I.Smile s={20} /></div>
              <OverflowMenu onPollCreate={onPollCreate} onGifPicker={onGifPicker} onSchedule={onSchedule} />
            </>)}
            <div onClick={handleSend} role="button" aria-label="Send message" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') handleSend(); }} style={{ padding: '8px 14px', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, borderRadius: 'var(--border-radius)', cursor: 'pointer', color: '#000', fontWeight: 700, fontSize: 13 }}>Send</div>
          </div>

          {/* Mobile formatting toolbar (hidden behind "Aa") */}
          {isMobile && showFormatting && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <div onClick={onEmojiPicker} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: T.sf2, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt }}>Emoji</div>
              <div onClick={() => setRecording(true)} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: T.sf2, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt }}>Voice</div>
              <div onClick={onPollCreate} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: T.sf2, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt }}>Poll</div>
              <div onClick={onGifPicker} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: T.sf2, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt }}>GIF</div>
              <div onClick={onSchedule} style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: T.sf2, border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt }}>Schedule</div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleCameraCapture} />
      <input ref={photoInputRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />

      {/* ── Mobile attachment bottom sheet ── */}
      {showAttachSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onClick={() => setShowAttachSheet(false)}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: T.sf, borderTop: `1px solid ${T.bd}`, borderRadius: '16px 16px 0 0', padding: '8px 0 calc(16px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -8px 32px rgba(0,0,0,0.4)' }}
            onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div style={{ width: 40, height: 4, borderRadius: 2, background: T.bd, margin: '0 auto 12px' }} />

            {[
              { icon: <I.Camera s={22} />, label: 'Camera', color: '#3498db', action: () => { cameraInputRef.current?.click(); setShowAttachSheet(false); } },
              { icon: <I.Eye s={22} />, label: 'Photo Library', color: '#2ecc71', action: () => { photoInputRef.current?.click(); setShowAttachSheet(false); } },
              { icon: <I.Paperclip s={22} />, label: 'File', color: '#9b59b6', action: () => { fileInputRef.current?.click(); setShowAttachSheet(false); } },
              { icon: <I.Mic s={22} />, label: 'Voice Message', color: '#e74c3c', action: () => { setRecording(true); setShowAttachSheet(false); } },
            ].map((item, i) => (
              <div key={i} onClick={item.action} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px', cursor: 'pointer',
              }}
                onMouseEnter={e => (e.currentTarget.style.background = T.sf2)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: `${item.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.color }}>
                  {item.icon}
                </div>
                <span style={{ fontSize: 15, fontWeight: 500, color: T.tx }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Camera preview modal ── */}
      {cameraPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 10001, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <img src={cameraPreview.url} alt="Camera capture" style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 'var(--border-radius)', objectFit: 'contain' }} />
          <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
            <button onClick={cancelCameraPhoto} style={{ padding: '12px 28px', borderRadius: 'var(--border-radius)', border: `1px solid ${T.bd}`, background: T.sf2, color: T.tx, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={confirmCameraPhoto} style={{ padding: '12px 28px', borderRadius: 'var(--border-radius)', border: 'none', background: `linear-gradient(135deg,${T.ac},${T.ac2})`, color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
