/**
 * ChannelSidebar — channel list for a server.
 *
 * Renders:
 *  - Uncategorized channels grouped by type (Text / Forum / Voice / NSFW)
 *  - Named category sections, each collapsible
 *  - Voice peer list inside the active voice channel row
 *  - Channel drag-reorder (owner only) — swaps positions via onReorder callback
 *  - Voice-user drag — owner/mod can drag a peer to another voice channel
 */
import React, { useState } from 'react';
import { T } from '../theme';
import * as I from '../icons';

// ─── Types ────────────────────────────────────────────────

export interface Channel {
  id: string;
  name: string;
  channel_type?: string;       // 'text' | 'voice' | 'forum'
  category_id?: string | null;
  position?: number;
  locked?: boolean;
  nsfw?: boolean;
  message_ttl_seconds?: number;
  min_role_position?: number;
}

export interface CategoryData {
  id?: string;
  name?: string;
  /** API sometimes wraps in a nested object */
  category?: { id: string; name: string };
  channels?: Channel[];
}

export interface VoicePeer {
  id: string;
  name: string;
  speaking?: boolean;
  self?: boolean;
  isBot?: boolean;
}

export interface StreamInfo {
  active:       boolean;
  viewerCount:  number;
  viewerUrl?:   string;
}

export interface ChannelSidebarProps {
  channels:       Channel[];
  catData:        CategoryData[];
  curChannel:     Channel | null;
  voiceChannel:   Channel | null;
  voicePeers:     VoicePeer[];
  voicePresence:  Record<string, string[]>;
  memberMap:      Record<string, { name: string; isBot: boolean }>;
  unreadCounts:   Record<string, number>;
  mentionCounts?: Record<string, number>;
  mutedChannels:  Record<string, boolean>;
  videoStreams:   Record<string, MediaStream | null>;
  /** Per-channel live stream status */
  streamStatus:   Record<string, StreamInfo>;
  /** Whether SFrame E2EE is active on the voice connection */
  sframeActive:   boolean;
  /** Whether the browser supports SFrame insertable streams */
  sframeSupported: boolean;
  /** True when the current user owns the server */
  isOwner:        boolean;
  /** True when the user has the MOVE_MEMBERS permission */
  canMoveMember:  boolean;
  /** Highest role position the user holds (for channel visibility) */
  userMaxRolePos: number;
  /** Click a text/forum channel */
  onClick:        (ch: Channel) => void;
  /** Click a voice channel to join */
  onVoiceClick:   (ch: Channel) => void;
  /** User clicked Watch on a live voice channel */
  onWatchStream:  (ch: Channel) => void;
  /** Owner drag-reordered two channels */
  onReorder:      (dragCh: Channel, targetCh: Channel) => Promise<void>;
  /** Owner/mod dragged a peer to a different voice channel */
  onMoveUserToVoice: (userId: string, channelId: string) => void;
  /** Right-clicked a channel row */
  onChannelCtx:      (e: React.MouseEvent, ch: Channel) => void;
  /** Owner clicked the cogwheel on a channel row */
  onChannelSettings: (ch: Channel) => void;
}

// ─── Helpers ──────────────────────────────────────────────

function chIcon(ch: Channel) {
  if (ch.channel_type === 'voice')        return <I.Vol />;
  if (ch.channel_type === 'forum')        return <I.Msg />;
  if (ch.channel_type === 'announcement') return <span style={{ fontSize: 14, lineHeight: 1 }}>📢</span>;
  if (ch.channel_type === 'stage')        return <span style={{ fontSize: 14, lineHeight: 1 }}>🎤</span>;
  if (ch.locked) return <I.Lock s={14} />;
  if ((ch.min_role_position ?? 0) > 0) return <I.EyeOff />;
  return <I.Hash s={14} />;
}

// ─── VoiceUserList sub-component ──────────────────────────

interface VoiceUserListProps {
  ch:            Channel;
  voiceChannel:  Channel | null;
  voicePeers:    VoicePeer[];
  voicePresence: Record<string, string[]>;
  memberMap:     Record<string, { name: string; isBot: boolean }>;
  videoStreams:  Record<string, MediaStream | null>;
  sframeActive:  boolean;
  sframeSupported: boolean;
  canDrag:       boolean;
  onDragStart:   (peer: VoicePeer) => void;
  onDragEnd:     () => void;
}

function VoiceUserList({ ch, voiceChannel, voicePeers, voicePresence, memberMap, videoStreams, sframeActive, sframeSupported, canDrag, onDragStart, onDragEnd }: VoiceUserListProps) {
  // Merge presence list (all users incl. bots) with WebRTC peers (speaking indicators)
  const presenceIds = voicePresence[ch.id] || [];
  const peerMap = Object.fromEntries(voicePeers.map(p => [p.id, p]));
  const displayed: VoicePeer[] = presenceIds.map(uid => {
    const peer = peerMap[uid];
    const info = memberMap[uid] || { name: uid.slice(0, 8), isBot: false };
    return { id: uid, name: info.name, isBot: info.isBot, speaking: peer?.speaking, self: peer?.self };
  });
  // Fallback: include WebRTC peers missing from presence (race condition safety)
  for (const p of voicePeers) {
    if (!presenceIds.includes(p.id)) displayed.push(p);
  }
  if (displayed.length === 0) return null;
  return (
    <div style={{ paddingLeft: 28, paddingBottom: 4 }}>
      {displayed.map(p => (
        <div
          key={p.id}
          draggable={canDrag && !p.isBot}
          onDragStart={e => { if (!p.isBot) { onDragStart(p); e.dataTransfer.effectAllowed = 'move'; } }}
          onDragEnd={onDragEnd}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '2px 6px', fontSize: 11,
            color: p.speaking ? '#43b581' : p.self ? T.ac : T.mt,
            cursor: canDrag && !p.isBot ? 'grab' : 'default',
            borderRadius: 4,
            background: p.speaking ? 'rgba(67,181,129,0.08)' : 'transparent',
            transition: 'background .2s, color .2s',
          }}
          onMouseEnter={e => {
            if (canDrag && !p.isBot) e.currentTarget.style.background = p.speaking ? 'rgba(67,181,129,0.15)' : 'rgba(255,255,255,0.04)';
          }}
          onMouseLeave={e => { e.currentTarget.style.background = p.speaking ? 'rgba(67,181,129,0.08)' : 'transparent'; }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: 3,
            background: p.speaking ? '#43b581' : p.self ? T.ac : p.isBot ? '#5865f2' : '#666',
            flexShrink: 0,
            boxShadow: p.speaking ? '0 0 4px #43b581' : 'none',
          }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: p.speaking ? 600 : 400, flex: 1 }}>
            {p.name}{p.self ? ' (You)' : ''}
          </span>
          {p.isBot && (
            <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#5865f222', color: '#7984f5', fontWeight: 700, flexShrink: 0, letterSpacing: '0.3px' }}>BOT</span>
          )}
          {videoStreams[p.id] && (
            <span style={{ color: T.ac, display: 'flex', marginLeft: p.isBot ? 4 : 'auto', flexShrink: 0 }}>
              <I.Camera s={10} />
            </span>
          )}
          {sframeActive ? (
            <span title="End-to-end encrypted" style={{ color: '#43b581', display: 'flex', flexShrink: 0, marginLeft: !videoStreams[p.id] && !p.isBot ? 'auto' : 2 }}>
              <I.ShieldCheck s={10} />
            </span>
          ) : !sframeSupported ? (
            <span title="Transport encrypted only (browser does not support E2EE)" style={{ color: '#faa61a', display: 'flex', flexShrink: 0, marginLeft: !videoStreams[p.id] && !p.isBot ? 'auto' : 2 }}>
              <I.ShieldAlert s={10} />
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ─── ChannelRow sub-component ─────────────────────────────

interface ChannelRowProps {
  ch:             Channel;
  curChannel:     Channel | null;
  voiceChannel:   Channel | null;
  voicePeers:     VoicePeer[];
  voicePresence:  Record<string, string[]>;
  memberMap:      Record<string, { name: string; isBot: boolean }>;
  videoStreams:   Record<string, MediaStream | null>;
  unreadCounts:   Record<string, number>;
  mentionCounts?: Record<string, number>;
  mutedChannels:  Record<string, boolean>;
  streamStatus:   Record<string, StreamInfo>;
  isOwner:        boolean;
  canMoveMember:  boolean;
  isDragOver:     boolean;
  dragVoiceUser:  VoicePeer | null;
  indent:         boolean;
  onClick:        (ch: Channel) => void;
  onVoiceClick:   (ch: Channel) => void;
  onWatchStream:  (ch: Channel) => void;
  onDragStart:    (ch: Channel) => void;
  onDragOver:     (e: React.DragEvent, ch: Channel) => void;
  onDragLeave:    () => void;
  onDrop:         (e: React.DragEvent, ch: Channel) => void;
  onDragEnd:      () => void;
  onCtx:               (e: React.MouseEvent, ch: Channel) => void;
  onChannelSettings:   (ch: Channel) => void;
  onVoicePeerDragStart: (peer: VoicePeer) => void;
  onVoicePeerDragEnd:   () => void;
  onMoveUserToVoice:    (userId: string, channelId: string) => void;
}

function ChannelRow({
  ch, curChannel, voiceChannel, voicePeers, voicePresence, memberMap, videoStreams,
  unreadCounts, mentionCounts, mutedChannels, streamStatus, isOwner, canMoveMember,
  isDragOver, dragVoiceUser, indent,
  onClick, onVoiceClick, onWatchStream, onDragStart, onDragOver, onDragLeave,
  onDrop, onDragEnd, onCtx, onChannelSettings, onVoicePeerDragStart, onVoicePeerDragEnd,
  onMoveUserToVoice,
}: ChannelRowProps) {
  const [hovered, setHovered] = useState(false);
  const isActive  = curChannel?.id === ch.id;
  const isInVoice = voiceChannel?.id === ch.id;
  const isMuted   = !!mutedChannels[ch.id];
  const unread    = unreadCounts[ch.id] ?? 0;
  const mentions  = mentionCounts?.[ch.id] ?? 0;
  const liveInfo  = ch.channel_type === 'voice' ? (streamStatus[ch.id] ?? null) : null;
  const isLive    = liveInfo?.active ?? false;

  const handleClick = () => ch.channel_type === 'voice' ? null : onClick(ch);
  const handleDblClick = () => ch.channel_type === 'voice' ? onVoiceClick(ch) : null;

  const dragProps = isOwner ? {
    draggable: true,
    onDragStart: () => onDragStart(ch),
    onDragEnd,
    onDragOver: (e: React.DragEvent) => {
      onDragOver(e, ch);
      if (dragVoiceUser && ch.channel_type === 'voice') {
        e.preventDefault();
        e.currentTarget.style.outline = `2px solid ${T.ac}`;
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      onDragLeave();
      (e.currentTarget as HTMLElement).style.outline = '';
    },
    onDrop: (e: React.DragEvent) => {
      (e.currentTarget as HTMLElement).style.outline = '';
      if (dragVoiceUser && ch.channel_type === 'voice') {
        onMoveUserToVoice(dragVoiceUser.id, ch.id);
      } else {
        onDrop(e, ch);
      }
    },
  } : (canMoveMember && ch.channel_type === 'voice' ? {
    // Non-owners with MOVE_MEMBERS can still drop peers on voice channels
    onDragOver: (e: React.DragEvent) => {
      if (dragVoiceUser) { e.preventDefault(); (e.currentTarget as HTMLElement).style.outline = `2px solid ${T.ac}`; }
    },
    onDragLeave: (e: React.DragEvent) => { (e.currentTarget as HTMLElement).style.outline = ''; },
    onDrop: (e: React.DragEvent) => {
      (e.currentTarget as HTMLElement).style.outline = '';
      if (dragVoiceUser) onMoveUserToVoice(dragVoiceUser.id, ch.id);
    },
  } : {});

  return (
    <React.Fragment>
      <div
        {...dragProps}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
        onContextMenu={e => onCtx(e, ch)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="ch-row"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: indent ? '4px 10px 4px 20px' : '5px 10px',
          borderRadius: 6,
          cursor: isOwner ? 'grab' : 'pointer',
          background: isActive
            ? 'rgba(0,212,170,0.14)'
            : isDragOver
              ? 'rgba(0,212,170,0.12)'
              : isInVoice
                ? 'rgba(0,212,170,0.04)'
                : 'transparent',
          color: isActive || isInVoice ? T.ac : (unread > 0 ? T.tx : T.mt),
          fontSize: 14,
          fontWeight: isActive ? 600 : (unread > 0 ? 700 : 500),
          opacity: isMuted ? 0.5 : 1,
          borderTop: isDragOver ? `2px solid ${T.ac}` : '2px solid transparent',
        }}
      >
        {unread > 0 && !isActive && <span style={{ width: 6, height: 6, borderRadius: 3, background: T.ac, flexShrink: 0 }} />}
        {chIcon(ch)}
        {ch.name}
        {ch.nsfw && (
          <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: '#ff4757', color: '#fff', fontWeight: 700, flexShrink: 0, letterSpacing: '0.3px' }}>NSFW</span>
        )}
        {ch.locked && <I.Lock s={10} />}
        {(ch.message_ttl_seconds ?? 0) > 0 && <I.Clock />}
        {isMuted && <span style={{ color: T.mt, marginLeft: 2 }} title="Muted"><I.BellOff /></span>}

        {/* Mention badge */}
        {mentions > 0 && !isActive && (
          <span style={{
            marginLeft: 'auto', background: '#ff4757',
            color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 8,
            minWidth: 16, height: 16, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0 4px',
          }}>
            @{mentions}
          </span>
        )}
        {/* Unread badge */}
        {unread > 0 && !isActive && mentions === 0 && (
          <span style={{
            marginLeft: 'auto', background: isMuted ? T.mt : T.ac,
            color: '#000', fontSize: 10, fontWeight: 700, borderRadius: 8,
            minWidth: 16, height: 16, display: 'flex', alignItems: 'center',
            justifyContent: 'center', padding: '0 4px',
          }}>
            {unread}
          </span>
        )}

        {/* Active voice indicator dot */}
        {isInVoice && (
          <span style={{ fontSize: 10, color: T.ac, marginLeft: unread ? '4px' : 'auto' }}>●</span>
        )}

        {/* LIVE badge — shown when a stream is active on this voice channel */}
        {isLive && (
          <span style={{
            marginLeft: (unread > 0 || isInVoice) ? '4px' : 'auto',
            background: '#ff4757', color: '#fff',
            fontSize: 9, fontWeight: 700, borderRadius: 4,
            padding: '1px 5px', letterSpacing: '0.5px', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            ● LIVE{(liveInfo?.viewerCount ?? 0) > 0 ? ` · ${liveInfo!.viewerCount}` : ''}
          </span>
        )}

        {/* Watch button — shown on hover when stream is live */}
        {isLive && hovered && (
          <span
            onClick={e => { e.stopPropagation(); e.preventDefault(); onWatchStream(ch); }}
            title="Watch stream"
            style={{ marginLeft: 4, fontSize: 11, cursor: 'pointer', flexShrink: 0, color: T.ac }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >👁</span>
        )}

        {/* Owner cogwheel — shown on hover */}
        {isOwner && hovered && (
          <span
            onClick={e => { e.stopPropagation(); e.preventDefault(); onChannelSettings(ch); }}
            title="Channel settings"
            style={{
              marginLeft: (unread > 0 || isInVoice || isLive) ? '4px' : 'auto',
              color: T.mt, fontSize: 15, cursor: 'pointer', flexShrink: 0,
              padding: '0 2px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = T.ac)}
            onMouseLeave={e => (e.currentTarget.style.color = T.mt)}
          >⚙</span>
        )}
      </div>

      {/* Voice peer list */}
      {ch.channel_type === 'voice' && (
        <VoiceUserList
          ch={ch}
          voiceChannel={voiceChannel}
          voicePeers={voicePeers}
          voicePresence={voicePresence}
          memberMap={memberMap}
          videoStreams={videoStreams}
          sframeActive={sframeActive}
          sframeSupported={sframeSupported}
          canDrag={isOwner || canMoveMember}
          onDragStart={onVoicePeerDragStart}
          onDragEnd={onVoicePeerDragEnd}
        />
      )}
    </React.Fragment>
  );
}

// ─── Main Component ───────────────────────────────────────

export function ChannelSidebar({
  channels, catData, curChannel, voiceChannel, voicePeers, voicePresence, memberMap,
  unreadCounts, mutedChannels, videoStreams, streamStatus,
  sframeActive, sframeSupported,
  isOwner, canMoveMember, userMaxRolePos,
  onClick, onVoiceClick, onWatchStream, onReorder, onMoveUserToVoice, onChannelCtx, onChannelSettings,
}: ChannelSidebarProps) {
  const [collCats,      setCollCats]      = useState<Record<string, boolean>>({});
  const [dragCh,        setDragCh]        = useState<Channel | null>(null);
  const [dragOverCh,    setDragOverCh]    = useState<string | null>(null);
  const [dragVoiceUser, setDragVoiceUser] = useState<VoicePeer | null>(null);

  // ── Visibility filter ──
  const canSeeChannel = (ch: Channel) => {
    if (isOwner) return true;
    if (!ch.min_role_position || ch.min_role_position <= 0) return true;
    return userMaxRolePos >= ch.min_role_position;
  };

  // ── Category toggle ──
  const toggleCat = (id: string) => setCollCats(p => ({ ...p, [id]: !p[id] }));

  // ── Drag handlers ──
  const onChDragStart = (ch: Channel) => { setDragCh(ch); };
  const onChDragOver  = (e: React.DragEvent, ch: Channel) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCh(ch.id); };
  const onChDragLeave = () => setDragOverCh(null);
  const onChDragEnd   = () => { setDragCh(null); setDragOverCh(null); };
  const onChDrop = async (e: React.DragEvent, targetCh: Channel) => {
    e.preventDefault();
    setDragOverCh(null);
    if (!dragCh || dragCh.id === targetCh.id) { setDragCh(null); return; }
    await onReorder(dragCh, targetCh);
    setDragCh(null);
  };

  // ── Shared channel row props ──
  const rowProps = (ch: Channel) => ({
    ch, curChannel, voiceChannel, voicePeers, voicePresence, memberMap, videoStreams,
    unreadCounts, mentionCounts, mutedChannels, streamStatus, isOwner, canMoveMember,
    isDragOver: dragOverCh === ch.id,
    dragVoiceUser,
    onClick, onVoiceClick, onWatchStream,
    onDragStart: onChDragStart,
    onDragOver:  onChDragOver,
    onDragLeave: onChDragLeave,
    onDrop:      onChDrop,
    onDragEnd:   onChDragEnd,
    onCtx:             onChannelCtx,
    onChannelSettings: onChannelSettings,
    onVoicePeerDragStart: (p: VoicePeer) => setDragVoiceUser(p),
    onVoicePeerDragEnd:   () => setDragVoiceUser(null),
    onMoveUserToVoice,
  });

  // ── Uncategorized channel buckets ──
  const uncatChannels = channels.filter(c => !c.category_id).filter(canSeeChannel);
  const uncatText         = uncatChannels.filter(c => c.channel_type === 'text'         && !c.nsfw);
  const uncatAnnouncement = uncatChannels.filter(c => c.channel_type === 'announcement' && !c.nsfw);
  const uncatForum        = uncatChannels.filter(c => c.channel_type === 'forum'        && !c.nsfw);
  const uncatVoice        = uncatChannels.filter(c => c.channel_type === 'voice'        && !c.nsfw);
  const uncatStage        = uncatChannels.filter(c => c.channel_type === 'stage'        && !c.nsfw);
  const uncatNsfw         = uncatChannels.filter(c => c.nsfw);

  const uncatSections = [
    { label: 'TEXT CHANNELS',         chs: uncatText         },
    { label: 'ANNOUNCEMENTS',         chs: uncatAnnouncement },
    { label: 'FORUM CHANNELS',        chs: uncatForum        },
    { label: 'VOICE CHANNELS',        chs: uncatVoice        },
    { label: 'STAGES',                chs: uncatStage        },
    { label: 'NSFW',                  chs: uncatNsfw         },
  ].filter(s => s.chs.length > 0);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>

      {/* ── Uncategorized sections ── */}
      {uncatSections.map(sec => (
        <div key={sec.label}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '8px 6px 4px', fontSize: 11, fontWeight: 700,
            color: sec.label === 'NSFW' ? T.err : T.mt,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {sec.label === 'NSFW' && '🔞 '}{sec.label}
          </div>
          {sec.chs.map(ch => (
            <ChannelRow key={ch.id} {...rowProps(ch)} indent={false} />
          ))}
        </div>
      ))}

      {/* ── Named categories ── */}
      {catData.map(cat => {
        const cid   = cat.category?.id   || cat.id   || '';
        const cname = cat.category?.name || cat.name || 'Category';
        const chs   = (cat.channels || []).filter(canSeeChannel);

        return (
          <div key={cid}>
            {/* Category header */}
            <div
              className="cat-toggle"
              onClick={() => toggleCat(cid)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '8px 6px 4px', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, color: T.mt,
                textTransform: 'uppercase', letterSpacing: '0.5px', borderRadius: 4,
              }}
            >
              {collCats[cid] ? <I.ChevR /> : <I.ChevD />}
              {cname}
            </div>

            {/* Channels inside category (hidden when collapsed) */}
            {!collCats[cid] && chs.map(ch => (
              <ChannelRow key={ch.id} {...rowProps(ch)} indent={true} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
