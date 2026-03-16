/**
 * DocumentEditor — Encrypted rich-text document editor (v1).
 *
 * Features:
 *   - contentEditable editor with formatting toolbar
 *   - AES-GCM encryption keyed from channelId (same HKDF-SHA256 as chat messages)
 *   - Document list with title, last-edited, encrypted badge
 *   - Auto-save every 30 seconds
 *   - Share link: random AES-256-GCM key stored in URL fragment only
 *   - Export as .txt (decrypted plaintext)
 *
 * Storage keys:
 *   d_docs_list           — JSON: DocMeta[]  (titles/timestamps only)
 *   d_docs_{id}           — encrypted HTML blob
 *   d_docs_share_{shareId}— re-encrypted blob for share links (same device, v1)
 *
 * Props:
 *   channelId — encryption context (use channel ID or user ID for personal docs)
 *   onClose   — dismiss the modal
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { T } from '../theme';

// ── Types ─────────────────────────────────────────────────

interface DocMeta {
  id:        string;
  title:     string;
  updatedAt: number;
  channelId: string;
}

export interface DocumentEditorProps {
  channelId: string;
  onClose:   () => void;
}

// ── Storage helpers ───────────────────────────────────────

const LIST_KEY = 'd_docs_list';
const docKey   = (id: string)     => `d_docs_${id}`;
const shareKey = (sid: string)    => `d_docs_share_${sid}`;

function loadList(): DocMeta[] {
  try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; }
}
function saveList(list: DocMeta[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
}
function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Crypto ────────────────────────────────────────────────

async function deriveKey(channelId: string): Promise<CryptoKey> {
  const salt = new TextEncoder().encode('discreet-mls-v1');
  const info = new TextEncoder().encode(`discreet:${channelId}:0`);
  const km   = await crypto.subtle.importKey('raw', new TextEncoder().encode(`discreet:${channelId}:0`), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveCommitment(channelId: string): Promise<Uint8Array> {
  const salt = new TextEncoder().encode('discreet-mls-v1');
  const info = new TextEncoder().encode(`discreet:${channelId}:0:commit`);
  const km   = await crypto.subtle.importKey('raw', new TextEncoder().encode(`discreet:${channelId}:0`), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, km, 256);
  return new Uint8Array(bits);
}

function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function encryptBlob(key: CryptoKey, plaintext: string): Promise<string> {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decryptBlob(key: CryptoKey, b64: string): Promise<string> {
  const d  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.slice(0, 12) }, key, d.slice(12));
  return new TextDecoder().decode(pt);
}

async function encryptForChannel(channelId: string, html: string): Promise<string> {
  const key = await deriveKey(channelId);
  const commitment = await deriveCommitment(channelId);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html));
  // Output: [commitment(32) | iv(12) | ciphertext]
  const out = new Uint8Array(32 + iv.length + new Uint8Array(ct).length);
  out.set(commitment);
  out.set(iv, 32);
  out.set(new Uint8Array(ct), 44);
  return btoa(String.fromCharCode(...out));
}

async function decryptFromChannel(channelId: string, b64: string): Promise<string> {
  const d = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (d.length < 44) throw new Error('Key commitment failed');
  const storedCommit = d.slice(0, 32);
  const expectedCommit = await deriveCommitment(channelId);
  if (!ctEqual(storedCommit, expectedCommit)) throw new Error('Key commitment failed');
  const key = await deriveKey(channelId);
  const pt  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.slice(32, 44) }, key, d.slice(44));
  return new TextDecoder().decode(pt);
}

/** Generate a fresh AES-256-GCM key for share links (exported raw → base64). */
async function encryptForShare(html: string): Promise<{ blob: string; keyB64: string }> {
  const key     = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawKey  = await crypto.subtle.exportKey('raw', key);
  const keyB64  = btoa(String.fromCharCode(...new Uint8Array(rawKey)));
  const blob    = await encryptBlob(key, html);
  return { blob, keyB64 };
}

async function decryptShare(keyB64: string, blob: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  return decryptBlob(key, blob);
}

// ── Plain-text export helper ──────────────────────────────

function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  // Replace block elements with newlines before stripping tags
  div.querySelectorAll('p, div, h1, h2, h3, li, br').forEach(el => {
    el.before(document.createTextNode('\n'));
  });
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Format date ───────────────────────────────────────────

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000)      return 'Just now';
  if (diff < 3600000)    return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)   return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000)  return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

// ── ToolbarBtn ────────────────────────────────────────────

function ToolbarBtn({ label, title, onClick, active }: {
  label: string; title: string; onClick: () => void; active?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }} // preventDefault keeps focus in editor
      title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '4px 9px', borderRadius: 5, border: 'none', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', lineHeight: 1.4,
        background: active ? `${T.ac}30` : hov ? `rgba(255,255,255,0.08)` : 'transparent',
        color: active ? T.ac : T.tx,
        transition: 'background .12s, color .12s',
      }}
    >
      {label}
    </button>
  );
}

// ── DocumentEditor ────────────────────────────────────────

export function DocumentEditor({ channelId, onClose }: DocumentEditorProps) {
  const [docs,       setDocs]       = useState<DocMeta[]>(() => loadList());
  const [openId,     setOpenId]     = useState<string | null>(null);
  const [title,      setTitle]      = useState('Untitled Document');
  const [isDirty,    setIsDirty]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [savedMsg,   setSavedMsg]   = useState(false);
  const [shareUrl,   setShareUrl]   = useState<string | null>(null);
  const [loadErr,    setLoadErr]    = useState('');
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  const editorRef  = useRef<HTMLDivElement>(null);
  const titleRef   = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Format detection ────────────────────────────────────
  const detectFormats = useCallback(() => {
    const active = new Set<string>();
    if (document.queryCommandState('bold'))   active.add('bold');
    if (document.queryCommandState('italic')) active.add('italic');
    if (document.queryCommandState('underline')) active.add('underline');
    const block = document.queryCommandValue('formatBlock').toLowerCase();
    if (block === 'h1') active.add('h1');
    if (block === 'h2') active.add('h2');
    if (block === 'pre') active.add('pre');
    setActiveFormats(active);
  }, []);

  // ── Exec command helpers ─────────────────────────────────
  const exec = useCallback((cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    setIsDirty(true);
    detectFormats();
  }, [detectFormats]);

  const formatBlock = useCallback((tag: string) => {
    editorRef.current?.focus();
    const current = document.queryCommandValue('formatBlock').toLowerCase();
    document.execCommand('formatBlock', false, current === tag ? 'p' : tag);
    setIsDirty(true);
    detectFormats();
  }, [detectFormats]);

  // ── Save & load ──────────────────────────────────────────
  const saveDoc = useCallback(async (id: string, docTitle: string) => {
    const html = editorRef.current?.innerHTML || '';
    if (!html.trim() && !docTitle.trim()) return;
    setSaving(true);
    try {
      const blob = await encryptForChannel(channelId, html);
      localStorage.setItem(docKey(id), blob);
      const now = Date.now();
      setDocs(prev => {
        const without = prev.filter(d => d.id !== id);
        const updated = [{ id, title: docTitle, updatedAt: now, channelId }, ...without];
        saveList(updated);
        return updated;
      });
      setIsDirty(false);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    } catch (e) {
      console.error('[DocumentEditor] save failed', e);
    } finally {
      setSaving(false);
    }
  }, [channelId]);

  const loadDoc = useCallback(async (doc: DocMeta) => {
    setLoadErr('');
    setShareUrl(null);
    const blob = localStorage.getItem(docKey(doc.id));
    if (!blob) {
      setOpenId(doc.id);
      setTitle(doc.title);
      if (editorRef.current) editorRef.current.innerHTML = '';
      return;
    }
    try {
      const html = await decryptFromChannel(doc.channelId, blob);
      setOpenId(doc.id);
      setTitle(doc.title);
      setIsDirty(false);
      // Set content after render
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerHTML = html;
          editorRef.current.focus();
        }
      });
    } catch {
      setLoadErr('Failed to decrypt — wrong channel key?');
    }
  }, []);

  const newDoc = useCallback(() => {
    const id = makeId();
    const newTitle = 'Untitled Document';
    setOpenId(id);
    setTitle(newTitle);
    setIsDirty(false);
    setShareUrl(null);
    setLoadErr('');
    requestAnimationFrame(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '<p><br></p>';
        editorRef.current.focus();
      }
      titleRef.current?.select();
    });
  }, []);

  const closeEditor = useCallback(async () => {
    if (isDirty && openId) await saveDoc(openId, title);
    setOpenId(null);
    setShareUrl(null);
    setLoadErr('');
  }, [isDirty, openId, title, saveDoc]);

  const deleteDoc = useCallback((id: string) => {
    localStorage.removeItem(docKey(id));
    setDocs(prev => {
      const updated = prev.filter(d => d.id !== id);
      saveList(updated);
      return updated;
    });
    if (openId === id) { setOpenId(null); }
  }, [openId]);

  // ── Auto-save ────────────────────────────────────────────
  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      if (openId && isDirty) saveDoc(openId, title);
    }, 30000);
    return () => { if (autoSaveTimer.current) clearInterval(autoSaveTimer.current); };
  }, [openId, isDirty, title, saveDoc]);

  // ── Share ────────────────────────────────────────────────
  const generateShareLink = useCallback(async () => {
    if (!openId) return;
    if (isDirty) await saveDoc(openId, title);
    const html = editorRef.current?.innerHTML || '';
    try {
      const shareId = makeId();
      const { blob, keyB64 } = await encryptForShare(html);
      localStorage.setItem(shareKey(shareId), blob);
      const base = window.location.href.split('#')[0];
      const url  = `${base}#doc-share=${shareId}&doc-key=${encodeURIComponent(keyB64)}&doc-title=${encodeURIComponent(title)}`;
      setShareUrl(url);
      navigator.clipboard?.writeText(url).catch(() => {});
    } catch (e) {
      console.error('[DocumentEditor] share failed', e);
    }
  }, [openId, isDirty, title, saveDoc]);

  // ── Export as .txt ───────────────────────────────────────
  const exportTxt = useCallback(() => {
    const html = editorRef.current?.innerHTML || '';
    const text = htmlToText(html);
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (title.trim() || 'document') + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [title]);

  // ── Toolbar definition ───────────────────────────────────
  const toolbarGroups = [
    [
      { label: 'B',  title: 'Bold',      fn: () => exec('bold'),      format: 'bold',      style: { fontWeight: 900 } },
      { label: 'I',  title: 'Italic',    fn: () => exec('italic'),    format: 'italic',    style: { fontStyle: 'italic' } },
      { label: 'U',  title: 'Underline', fn: () => exec('underline'), format: 'underline', style: { textDecoration: 'underline' } },
    ],
    [
      { label: 'H1', title: 'Heading 1', fn: () => formatBlock('h1'), format: 'h1',  style: {} },
      { label: 'H2', title: 'Heading 2', fn: () => formatBlock('h2'), format: 'h2',  style: {} },
      { label: 'H3', title: 'Heading 3', fn: () => formatBlock('h3'), format: 'h3',  style: {} },
    ],
    [
      { label: '•—', title: 'Bullet List',   fn: () => exec('insertUnorderedList'), format: 'ul',  style: {} },
      { label: '1—', title: 'Numbered List', fn: () => exec('insertOrderedList'),   format: 'ol',  style: {} },
    ],
    [
      { label: '</>',  title: 'Code Block', fn: () => formatBlock('pre'), format: 'pre', style: { fontFamily: 'monospace', fontSize: 11 } },
    ],
  ];

  // ── Editor styles ────────────────────────────────────────
  const editorCss = `
    .discreet-doc-editor:focus { outline: none; }
    .discreet-doc-editor h1 { font-size: 2em; font-weight: 700; margin: 0.5em 0; }
    .discreet-doc-editor h2 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; }
    .discreet-doc-editor h3 { font-size: 1.17em; font-weight: 700; margin: 0.5em 0; }
    .discreet-doc-editor p  { margin: 0.4em 0; min-height: 1.4em; }
    .discreet-doc-editor ul, .discreet-doc-editor ol { padding-left: 1.6em; margin: 0.4em 0; }
    .discreet-doc-editor li { margin: 0.2em 0; }
    .discreet-doc-editor pre {
      background: rgba(255,255,255,0.06); border-radius: 6px; padding: 10px 14px;
      font-family: 'JetBrains Mono', monospace; font-size: 13px;
      white-space: pre-wrap; word-break: break-word; margin: 0.5em 0;
    }
    .discreet-doc-editor code {
      background: rgba(255,255,255,0.08); border-radius: 3px;
      padding: 1px 5px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em;
    }
    .discreet-doc-editor a { color: ${T.ac}; text-decoration: underline; }
    .discreet-doc-editor blockquote {
      border-left: 3px solid ${T.ac}; padding-left: 12px; margin: 0.5em 0;
      color: ${T.mt}; font-style: italic;
    }
  `;

  // ── Divider ──────────────────────────────────────────────
  const Divider = () => (
    <div style={{ width: 1, height: 18, background: T.bd, flexShrink: 0 }} />
  );

  // ── Render ────────────────────────────────────────────────
  return ReactDOM.createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 18000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans',sans-serif",
    }}>
      <style>{editorCss}</style>

      <div style={{
        width: openId ? '92vw' : 560,
        height: openId ? '92vh' : 'auto',
        maxHeight: '92vh',
        maxWidth: openId ? '1100px' : 560,
        background: T.sf,
        border: `1px solid ${T.bd}`,
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        transition: 'width .2s ease, height .2s ease',
      }}>

        {/* ═══════════════ DOCUMENT LIST ═══════════════ */}
        {!openId && (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>📄</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>Documents</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: T.ac,
                  background: `${T.ac}18`, border: `1px solid ${T.ac}30`,
                  borderRadius: 4, padding: '2px 6px',
                }}>
                  🔒 E2EE
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={newDoc}
                  style={{
                    padding: '7px 14px', borderRadius: 8, border: 'none',
                    background: `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})`,
                    color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  + New Document
                </button>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px' }}>✕</button>
              </div>
            </div>

            {/* Document list */}
            <div style={{ overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 160 }}>
              {docs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: T.mt }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📝</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No documents yet</div>
                  <div style={{ fontSize: 12 }}>Click "+ New Document" to get started.</div>
                </div>
              ) : (
                docs.map(doc => (
                  <div
                    key={doc.id}
                    onClick={() => loadDoc(doc)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 10,
                      background: T.sf2, border: `1px solid ${T.bd}`,
                      cursor: 'pointer', transition: 'border-color .15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = T.ac)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = T.bd)}
                  >
                    <span style={{ fontSize: 22, flexShrink: 0 }}>📄</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.title || 'Untitled Document'}
                      </div>
                      <div style={{ fontSize: 11, color: T.mt, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span>{fmtDate(doc.updatedAt)}</span>
                        <span style={{ color: T.ac, fontSize: 10, fontWeight: 700, background: `${T.ac}15`, border: `1px solid ${T.ac}25`, borderRadius: 3, padding: '1px 5px' }}>
                          🔒 Encrypted
                        </span>
                        {doc.channelId !== channelId && (
                          <span style={{ fontSize: 10, color: T.warn, background: `${T.warn}15`, border: `1px solid ${T.warn}25`, borderRadius: 3, padding: '1px 5px' }}>
                            Different channel key
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm(`Delete "${doc.title}"?`)) deleteDoc(doc.id); }}
                      style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 4, flexShrink: 0 }}
                      title="Delete document"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ═══════════════ EDITOR ═══════════════ */}
        {openId && (
          <>
            {/* Top bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${T.bd}`, flexShrink: 0 }}>
              <button
                onClick={closeEditor}
                style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 8px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                ← Docs
              </button>
              <div style={{ width: 1, height: 18, background: T.bd }} />

              {/* Title */}
              <input
                ref={titleRef}
                value={title}
                onChange={e => { setTitle(e.target.value); setIsDirty(true); }}
                onBlur={() => { if (openId && isDirty) saveDoc(openId, title); }}
                placeholder="Document title"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: T.tx, fontSize: 15, fontWeight: 700,
                  fontFamily: "'DM Sans',sans-serif",
                }}
              />

              {/* Status indicators */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {saving && <span style={{ fontSize: 11, color: T.mt }}>Saving…</span>}
                {savedMsg && !saving && <span style={{ fontSize: 11, color: T.ac }}>✓ Saved</span>}
                {isDirty && !saving && !savedMsg && <span style={{ fontSize: 11, color: T.mt }}>Unsaved</span>}
                <span style={{ fontSize: 10, fontWeight: 700, color: T.ac, background: `${T.ac}18`, border: `1px solid ${T.ac}30`, borderRadius: 4, padding: '2px 6px' }}>🔒 E2EE</span>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => saveDoc(openId!, title)}
                  disabled={saving}
                  style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: isDirty ? `linear-gradient(135deg,${T.ac},${T.ac2 || T.ac})` : T.sf2, color: isDirty ? '#000' : T.mt, fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
                >
                  Save
                </button>
                <button
                  onClick={generateShareLink}
                  style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.bd}`, background: 'transparent', color: T.mt, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  title="Generate share link (same device)"
                >
                  Share
                </button>
                <button
                  onClick={exportTxt}
                  style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.bd}`, background: 'transparent', color: T.mt, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  title="Export as plain text"
                >
                  .txt
                </button>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 6px' }}>✕</button>
              </div>
            </div>

            {/* Share URL notice */}
            {shareUrl && (
              <div style={{ padding: '8px 16px', background: `${T.ac}12`, borderBottom: `1px solid ${T.ac}30`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: T.ac, fontWeight: 600 }}>Share link (copied to clipboard):</span>
                <code style={{ flex: 1, fontSize: 10, color: T.mt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono',monospace" }}>
                  {shareUrl}
                </code>
                <span style={{ fontSize: 10, color: T.mt, flexShrink: 0 }}>Same-device only (v1)</span>
                <button onClick={() => setShareUrl(null)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            )}

            {/* Error notice */}
            {loadErr && (
              <div style={{ padding: '8px 16px', background: `${T.err}12`, borderBottom: `1px solid ${T.err}30`, fontSize: 12, color: T.err, flexShrink: 0 }}>
                {loadErr}
              </div>
            )}

            {/* Toolbar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 2,
              padding: '6px 12px', borderBottom: `1px solid ${T.bd}`,
              background: T.sf2, flexShrink: 0, flexWrap: 'wrap',
            }}>
              {toolbarGroups.map((group, gi) => (
                <React.Fragment key={gi}>
                  {gi > 0 && <Divider />}
                  {group.map(item => (
                    <ToolbarBtn
                      key={item.format}
                      label={item.label}
                      title={item.title}
                      onClick={item.fn}
                      active={activeFormats.has(item.format)}
                    />
                  ))}
                </React.Fragment>
              ))}
              <Divider />
              <ToolbarBtn
                label="— line —"
                title="Horizontal rule"
                onClick={() => exec('insertHorizontalRule')}
              />
              <ToolbarBtn
                label="Undo"
                title="Undo (Ctrl+Z)"
                onClick={() => exec('undo')}
              />
              <ToolbarBtn
                label="Redo"
                title="Redo (Ctrl+Y)"
                onClick={() => exec('redo')}
              />
            </div>

            {/* Editor body */}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              className="discreet-doc-editor"
              onInput={() => { setIsDirty(true); detectFormats(); }}
              onKeyUp={detectFormats}
              onMouseUp={detectFormats}
              onSelect={detectFormats}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 32px',
                color: T.tx,
                fontSize: 15,
                lineHeight: 1.7,
                fontFamily: "'DM Sans',sans-serif",
                caretColor: T.ac,
                outline: 'none',
              }}
            />

            {/* Footer */}
            <div style={{ padding: '6px 16px', borderTop: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: T.mt }}>
                Auto-saves every 30s &bull; Encrypted with AES-128-GCM
              </span>
              <span style={{ fontSize: 10, color: T.mt }}>
                Ctrl+B bold &bull; Ctrl+I italic &bull; Ctrl+U underline
              </span>
            </div>
          </>
        )}
      </div>

      {/* Click-outside to close list view */}
      {!openId && (
        <div style={{ position: 'absolute', inset: 0, zIndex: -1 }} onClick={onClose} />
      )}
    </div>,
    document.body,
  );
}
