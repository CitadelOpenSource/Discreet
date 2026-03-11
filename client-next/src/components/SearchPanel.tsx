/**
 * SearchPanel — Server-wide message/member/user search panel.
 * Renders as a side panel. Supports advanced syntax (from:, in:, before:, after:).
 * Message search is client-side (E2EE — decrypted content never sent to server).
 */
import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { T, getInp } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';
import { Av } from './Av';

// ─── Types ───────────────────────────────────────────────

interface Message {
  id: string;
  text?: string;
  author_id: string;
  channel_id?: string;
  created_at: string;
}

interface Channel {
  id: string;
  name: string;
}

interface Member {
  user_id?: string;
  id?: string;
  username?: string;
  display_name?: string;
  roles?: Array<{ color?: string; name: string }>;
}

interface UserResult {
  id: string;
  username: string;
  display_name?: string;
}

interface SharedServer {
  id: string;
  name: string;
}

interface NavigateTarget {
  type: 'channel' | 'user';
  channel?: Channel;
  messageId?: string;
  userId?: string;
}

export interface SearchPanelProps {
  messages: Message[];
  dmMsgs: Message[];
  members: Member[];
  channels: Channel[];
  curServer?: { id: string } | null;
  curChannel?: Channel | null;
  curDm?: any;
  view: 'server' | 'dm' | string;
  getName: (userId: string) => string;
  onNavigate?: (target: NavigateTarget) => void;
  onClose: () => void;
}

// ─── highlightText ────────────────────────────────────────

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(query);
  while (idx !== -1 && parts.length < 20) {
    if (idx > lastIdx) parts.push(<span key={lastIdx}>{text.slice(lastIdx, idx)}</span>);
    parts.push(<span key={idx} style={{ background: 'rgba(0,212,170,0.25)', color: T.ac, fontWeight: 600, borderRadius: 2, padding: '0 1px' }}>{text.slice(idx, idx + query.length)}</span>);
    lastIdx = idx + query.length;
    idx = lower.indexOf(query, lastIdx);
  }
  if (lastIdx < text.length) parts.push(<span key={lastIdx}>{text.slice(lastIdx)}</span>);
  return parts.length ? <>{parts}</> : text;
}

// ─── Component ────────────────────────────────────────────

export function SearchPanel({ messages, dmMsgs, members, channels, curServer, view, getName, onNavigate, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('messages');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [userResults, setUserResults] = useState<UserResult[]>([]);
  const [sharedServers, setSharedServers] = useState<Record<string, SharedServer[]>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const parseQuery = (q: string) => {
    let text = q;
    let author: string | null = null, channel: string | null = null;
    let before: Date | null = null, after: Date | null = null;
    const fromMatch = text.match(/from:(\S+)/i);
    if (fromMatch) { author = fromMatch[1].toLowerCase(); text = text.replace(fromMatch[0], ''); }
    const inMatch = text.match(/in:#?(\S+)/i);
    if (inMatch) { channel = inMatch[1].toLowerCase(); text = text.replace(inMatch[0], ''); }
    const beforeMatch = text.match(/before:(\S+)/i);
    if (beforeMatch) { before = new Date(beforeMatch[1]); text = text.replace(beforeMatch[0], ''); }
    const afterMatch = text.match(/after:(\S+)/i);
    if (afterMatch) { after = new Date(afterMatch[1]); text = text.replace(afterMatch[0], ''); }
    return { text: text.trim().toLowerCase(), author, channel, before, after };
  };

  const doSearch = async () => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);

    if (tab === 'messages') {
      const parsed = parseQuery(query);
      const allMsgs = view === 'server' ? messages : dmMsgs;
      const filtered = allMsgs.filter(m => {
        if (parsed.text && m.text && !m.text.toLowerCase().includes(parsed.text)) return false;
        if (parsed.text && !m.text) return false;
        if (parsed.author) {
          const authorName = getName(m.author_id).toLowerCase();
          if (!authorName.includes(parsed.author)) return false;
        }
        if (parsed.channel && view === 'server') {
          const ch = channels.find(c => c.id === m.channel_id);
          if (!ch || !ch.name.toLowerCase().includes(parsed.channel)) return false;
        }
        if (parsed.before && new Date(m.created_at) > parsed.before) return false;
        if (parsed.after && new Date(m.created_at) < parsed.after) return false;
        return true;
      });
      setResults(filtered.slice(0, 50));
    }

    if (tab === 'members') {
      if (curServer) {
        const r = await api.searchMembers(curServer.id, query.trim());
        setMemberResults(Array.isArray(r) ? r : members.filter(m => {
          const name = getName(m.user_id || m.id || '').toLowerCase();
          return name.includes(query.trim().toLowerCase());
        }));
      } else {
        setMemberResults(members.filter(m => {
          const name = getName(m.user_id || m.id || '').toLowerCase();
          return name.includes(query.trim().toLowerCase());
        }));
      }
    }

    if (tab === 'users') {
      const r = await api.searchUsers(query.trim());
      setUserResults(Array.isArray(r) ? r : []);
      const shared: Record<string, SharedServer[]> = {};
      for (const u of (Array.isArray(r) ? r : []).slice(0, 10)) {
        try { shared[u.id] = await api.getSharedServers(u.id); } catch { shared[u.id] = []; }
      }
      setSharedServers(shared);
    }

    setSearching(false);
  };

  useEffect(() => {
    const t = setTimeout(() => { if (query.trim().length >= 2) doSearch(); }, 300);
    return () => clearTimeout(t);
  }, [query, tab]);

  const lbl = { fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase' as const, letterSpacing: '0.5px' };
  const tabs = [
    { id: 'messages', label: 'Messages',                       icon: <I.Msg /> },
    { id: 'members',  label: view === 'server' ? 'Members' : 'Users', icon: <I.Users /> },
    { id: 'users',    label: 'Global Search',                  icon: <I.Search /> },
  ];

  return (
    <div style={{ width: 320, minWidth: 320, borderLeft: `1px solid ${T.bd}`, background: T.sf, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <I.Search />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Search</span>
        <div onClick={onClose} style={{ marginLeft: 'auto', cursor: 'pointer', color: T.mt, padding: 2 }}><I.X /></div>
      </div>

      {/* Search input */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...getInp(), padding: '8px 12px' }}>
          <I.Search />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') onClose(); }}
            placeholder={tab === 'messages' ? 'Search messages... (from:user in:#channel)' : tab === 'members' ? 'Search members...' : 'Search all users...'}
            style={{ flex: 1, background: 'transparent', border: 'none', color: T.tx, fontSize: 13, outline: 'none', fontFamily: "'DM Sans',sans-serif" }} />
          {query && <div onClick={() => setQuery('')} style={{ cursor: 'pointer', color: T.mt }}><I.X /></div>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '4px 12px 8px' }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '6px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: tab === t.id ? T.ac : T.mt, background: tab === t.id ? 'rgba(0,212,170,0.1)' : 'transparent' }}>{t.icon} {t.label}</div>
        ))}
      </div>

      {/* Search tips */}
      {!query && tab === 'messages' && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: T.mt, lineHeight: 1.6 }}>
          <div style={{ ...lbl, marginBottom: 6 }}>Search Tips</div>
          <div><span style={{ color: T.ac, fontFamily: "'JetBrains Mono',monospace" }}>from:username</span> — filter by author</div>
          <div><span style={{ color: T.ac, fontFamily: "'JetBrains Mono',monospace" }}>in:#channel</span> — filter by channel</div>
          <div><span style={{ color: T.ac, fontFamily: "'JetBrains Mono',monospace" }}>before:2026-03-01</span> — before date</div>
          <div><span style={{ color: T.ac, fontFamily: "'JetBrains Mono',monospace" }}>after:2026-01-15</span> — after date</div>
          <div style={{ marginTop: 4, color: T.mt, fontStyle: 'italic' }}>Combine filters: <span style={{ color: T.ac }}>from:john in:#general hello</span></div>
          <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(0,212,170,0.05)', borderRadius: 8, border: '1px solid rgba(0,212,170,0.15)', fontSize: 11, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>🔒</span>
            <div>
              <div style={{ fontWeight: 700, color: T.ac, marginBottom: 2 }}>Search is local and private</div>
              <div style={{ color: T.mt, lineHeight: 1.5 }}>Messages are end-to-end encrypted. Search runs entirely on your device — your queries never leave your browser and are invisible to the server.</div>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
        {searching && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 13 }}>Searching...</div>}

        {tab === 'messages' && !searching && query.trim().length >= 2 && (<>
          <div style={{ ...lbl, padding: '8px 6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
            <span style={{ fontSize: 9, color: T.ac, fontWeight: 600, background: 'rgba(0,212,170,0.08)', padding: '2px 6px', borderRadius: 4, textTransform: 'none', letterSpacing: 0 }}>🔒 Local only</span>
          </div>
          {results.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 13 }}>No messages found</div>}
          {results.map(m => {
            const ch = channels.find(c => c.id === m.channel_id);
            const parsed = parseQuery(query);
            let textPreview = m.text || '';
            if (textPreview.length > 200) textPreview = textPreview.slice(0, 200) + '...';
            return (
              <div key={m.id} onClick={() => { if (ch && onNavigate) onNavigate({ type: 'channel', channel: ch, messageId: m.id }); }}
                style={{ padding: '8px 10px', margin: '2px 0', borderRadius: 8, cursor: 'pointer', background: T.sf2, border: `1px solid ${T.bd}`, transition: 'background .15s' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,170,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = T.sf2)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Av name={getName(m.author_id)} size={20} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{getName(m.author_id)}</span>
                  {ch && <span style={{ fontSize: 10, color: T.mt, marginLeft: 'auto' }}>#{ch.name}</span>}
                  <span style={{ fontSize: 10, color: T.mt }}>{new Date(m.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {parsed.text ? highlightText(textPreview, parsed.text) : textPreview}
                </div>
              </div>
            );
          })}
          {results.length >= 50 && (
            <div style={{ textAlign: 'center', padding: 10, fontSize: 11, color: T.mt }}>Showing first 50 results. Refine your search for more specific results.</div>
          )}
        </>)}

        {tab === 'members' && !searching && query.trim().length >= 2 && (<>
          <div style={{ ...lbl, padding: '8px 6px 6px' }}>{memberResults.length} member{memberResults.length !== 1 ? 's' : ''}</div>
          {memberResults.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 13 }}>No members found</div>}
          {memberResults.map(m => {
            const uid = m.user_id || m.id || '';
            const uname = m.username || getName(uid);
            return (
              <div key={uid} onClick={() => onNavigate?.({ type: 'user', userId: uid })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', margin: '2px 0', borderRadius: 8, cursor: 'pointer', background: T.sf2, border: `1px solid ${T.bd}` }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,170,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = T.sf2)}>
                <Av name={uname} size={32} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{uname}</div>
                  {m.display_name && m.display_name !== uname && <div style={{ fontSize: 11, color: T.mt }}>{m.display_name}</div>}
                </div>
                {m.roles && m.roles.length > 0 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {m.roles.slice(0, 3).map((r, i) => (
                      <div key={i} style={{ width: 8, height: 8, borderRadius: 4, background: r.color || T.mt }} title={r.name} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>)}

        {tab === 'users' && !searching && query.trim().length >= 2 && (<>
          <div style={{ ...lbl, padding: '8px 6px 6px' }}>{userResults.length} user{userResults.length !== 1 ? 's' : ''}</div>
          {userResults.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: T.mt, fontSize: 13 }}>No users found</div>}
          {userResults.map(u => {
            const shared = sharedServers[u.id] || [];
            return (
              <div key={u.id} onClick={() => onNavigate?.({ type: 'user', userId: u.id })}
                style={{ padding: '10px 12px', margin: '2px 0', borderRadius: 8, cursor: 'pointer', background: T.sf2, border: `1px solid ${T.bd}` }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,170,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = T.sf2)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Av name={u.username || '?'} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{u.username}</div>
                    {u.display_name && <div style={{ fontSize: 11, color: T.mt }}>{u.display_name}</div>}
                  </div>
                </div>
                {shared.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, color: T.mt }}>Shared:</span>
                    {shared.map(s => (
                      <div key={s.id} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,212,170,0.08)', color: T.ac }}>{s.name}</div>
                    ))}
                  </div>
                )}
                {shared.length === 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, color: T.mt, fontStyle: 'italic' }}>No shared servers</div>
                )}
              </div>
            );
          })}
        </>)}
      </div>
    </div>
  );
}
