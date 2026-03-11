/**
 * DMScreen — Direct-message conversations tab.
 *
 * Rendered by MainScreen inside the "DMs" tab. Manages its own data fetching
 * and conversation state. Communicates back to MainScreen via:
 *   onClearUnread(dmId)       — clear unread badge when conversation is opened
 *   onConversationChange(id)  — tell MainScreen which DM is active (for BackHandler)
 *
 * MainScreen feeds in:
 *   presence        — live { user_id → status } from WS presence events
 *   dmUnreadCounts  — { dm_id → count } incremented by MainScreen WS handler
 *   latestDmEvent   — most recent raw dm_message WS event (for real-time appending)
 *
 * Exposed handle (via forwardRef):
 *   closeConversation() — Android back button closes open DM
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../../App';
import { api } from '../api/CitadelAPI';
import MessageList, { Message } from '../components/MessageList';
import MessageInput from '../components/MessageInput';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DmConversation {
  id: string;
  other_user_id?: string;
  recipient_id?: string;
  other_username?: string;
  recipient_username?: string;
  name?: string;
  last_message?: string;
  last_message_at?: string;
}

export interface DMScreenHandle {
  closeConversation: () => void;
}

interface Props {
  presence:             Record<string, string>;   // user_id → 'online'|'idle'|'dnd'|'offline'
  dmUnreadCounts:       Record<string, number>;   // dm_id  → unread message count
  onClearUnread:        (dmId: string) => void;
  latestDmEvent:        any | null;               // raw WS dm_message event from MainScreen
  onConversationChange: (dmId: string | null) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase() || '?';
}

function hashColor(id: string): string {
  const palette = [C.ac, '#7289da', '#f47fff', '#f9a825', '#4fc3f7', '#ef5350', '#66bb6a'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
  return palette[h % palette.length];
}

function presenceColor(status?: string): string {
  switch (status) {
    case 'online': return '#3ba55d';
    case 'idle':   return '#faa61a';
    case 'dnd':    return '#ed4245';
    default:       return '#747f8d'; // offline / unknown
  }
}

function presenceLabel(status?: string): string {
  switch (status) {
    case 'online': return 'Online';
    case 'idle':   return 'Idle';
    case 'dnd':    return 'Do Not Disturb';
    default:       return 'Offline';
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  try {
    const ms   = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60_000);
    if (mins < 1)  return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// Extract the other person's user ID from a DM object (field name varies by API)
function otherUserId(dm: DmConversation): string {
  return dm.other_user_id || dm.recipient_id || '';
}

function dmDisplayName(dm: DmConversation): string {
  return dm.other_username || dm.recipient_username || dm.name || 'Unknown';
}

// ── Component ──────────────────────────────────────────────────────────────

const DMScreen = forwardRef<DMScreenHandle, Props>(function DMScreen(
  { presence, dmUnreadCounts, onClearUnread, latestDmEvent, onConversationChange },
  ref,
) {
  const [dms, setDms]               = useState<DmConversation[]>([]);
  const [curDm, setCurDm]           = useState<DmConversation | null>(null);
  const [dmMessages, setDmMessages] = useState<Message[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending]         = useState(false);

  const curDmRef = useRef<DmConversation | null>(null);

  // Keep ref in sync with state (so WS handlers see current value without stale closure)
  useEffect(() => { curDmRef.current = curDm; }, [curDm]);

  // Notify MainScreen which DM is open (for BackHandler and unread-increment logic)
  useEffect(() => {
    onConversationChange(curDm?.id ?? null);
  }, [curDm?.id]);

  // Initial DM list load
  useEffect(() => { loadDms(); }, []);

  // ── Real-time DM messages from WS (via latestDmEvent prop) ───────────────
  useEffect(() => {
    if (!latestDmEvent) return;
    const evt    = latestDmEvent;
    const dmId   = evt.dm_id || evt.conversation_id;
    const author = evt.author_id || evt.sender_id || '';
    const body   = evt.content   || evt.text       || '';
    const ts     = evt.created_at || new Date().toISOString();

    // Append to the currently open conversation
    if (curDmRef.current?.id === dmId) {
      const msg: Message = {
        id:         evt.id || `ws-${Date.now()}`,
        author_id:  author,
        text:       body,
        created_at: ts,
        authorName: evt.sender_username || evt.username || author.slice(0, 8),
      };
      setDmMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }

    // Always update the last-message preview in the list
    setDms(prev => {
      const idx = prev.findIndex(d => d.id === dmId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], last_message: body, last_message_at: ts };
      // Bubble the conversation to the top
      const [entry] = updated.splice(idx, 1);
      return [entry, ...updated];
    });
  }, [latestDmEvent]);

  // ── Expose imperative handle to MainScreen ────────────────────────────────
  useImperativeHandle(ref, () => ({
    closeConversation: () => {
      if (curDmRef.current) closeDm();
    },
  }));

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadDms = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else           setLoadingList(true);
    try {
      const raw = await api.listDms();
      setDms(Array.isArray(raw) ? raw : []);
    } catch {} finally {
      setLoadingList(false);
      setRefreshing(false);
    }
  }, []);

  const openDm = useCallback(async (dm: DmConversation) => {
    setCurDm(dm);
    onClearUnread(dm.id);
    setDmMessages([]);
    setLoadingMsgs(true);
    try {
      const raw  = await api.getDmMessages(dm.id, 50);
      const list = (Array.isArray(raw) ? raw : []).map((m: any) => ({
        id:         m.id,
        author_id:  m.author_id || m.sender_id || '',
        text:       m.content || m.text || '',
        created_at: m.created_at || new Date().toISOString(),
        authorName: m.sender_username || m.author_username || 'Unknown',
      }));
      setDmMessages(list);
    } catch {} finally { setLoadingMsgs(false); }
  }, [onClearUnread]);

  const closeDm = useCallback(() => {
    setCurDm(null);
    loadDms(); // refresh list to pick up any last_message changes
  }, [loadDms]);

  const handleSend = useCallback(async (text: string) => {
    const dm = curDmRef.current;
    if (!dm) return;
    setSending(true);
    const tempId = `tmp-${Date.now()}`;
    setDmMessages(prev => [...prev, {
      id:         tempId,
      author_id:  api.userId ?? '',
      text,
      created_at: new Date().toISOString(),
      authorName: api.username ?? 'You',
    }]);
    try { await api.sendDmMessage(dm.id, text); }
    catch { setDmMessages(prev => prev.filter(m => m.id !== tempId)); }
    finally { setSending(false); }
  }, []);

  // ── DM conversation view ──────────────────────────────────────────────────

  if (curDm) {
    const dmName  = dmDisplayName(curDm);
    const uid     = otherUserId(curDm);
    const pStatus = presence[uid];
    const pColor  = presenceColor(pStatus);

    return (
      <View style={{ flex: 1 }}>
        {/* Conversation header */}
        <View style={s.convHeader}>
          <TouchableOpacity
            onPress={closeDm}
            style={s.backBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.backIcon}>←</Text>
          </TouchableOpacity>

          {/* Avatar + presence */}
          <View style={s.convAvatarWrap}>
            <View style={[s.convAvatar, { backgroundColor: hashColor(curDm.id) }]}>
              <Text style={s.convAvatarText}>{avatarInitials(dmName)}</Text>
            </View>
            <View style={[s.presenceDotLg, { backgroundColor: pColor }]} />
          </View>

          {/* Name + status */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.convName} numberOfLines={1}>@{dmName}</Text>
            <Text style={[s.convStatus, { color: pColor }]}>
              {presenceLabel(pStatus)}
            </Text>
          </View>
        </View>

        {/* Messages + input (no nested KeyboardAvoidingView — parent handles it) */}
        <MessageList
          messages={dmMessages}
          loading={loadingMsgs}
          refreshing={false}
          onRefresh={() => {}}
          channelName={dmName}
          myUserId={api.userId}
        />
        <MessageInput channelName={dmName} sending={sending} onSend={handleSend} />
      </View>
    );
  }

  // ── DM list ───────────────────────────────────────────────────────────────

  const totalUnread = Object.values(dmUnreadCounts).reduce((a, b) => a + b, 0);

  return (
    <View style={{ flex: 1 }}>
      {/* Page header */}
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>Direct Messages</Text>
        {totalUnread > 0 && (
          <View style={s.unreadPill}>
            <Text style={s.unreadPillText}>{totalUnread} unread</Text>
          </View>
        )}
      </View>

      {/* Content */}
      {loadingList ? (
        <View style={s.center}>
          <ActivityIndicator color={C.ac} size="large" />
        </View>
      ) : dms.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={s.emptyTitle}>No DMs yet</Text>
          <Text style={s.emptyBody}>Start a conversation from the Friends tab.</Text>
        </View>
      ) : (
        <FlatList
          data={dms}
          keyExtractor={item => item.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadDms(true)}
              tintColor={C.ac}
              colors={[C.ac]}
            />
          }
          renderItem={({ item }) => {
            const name     = dmDisplayName(item);
            const uid      = otherUserId(item);
            const color    = hashColor(item.id);
            const pStatus  = presence[uid];
            const unread   = dmUnreadCounts[item.id] ?? 0;
            const hasUnread = unread > 0;

            return (
              <TouchableOpacity
                onPress={() => openDm(item)}
                style={s.row}
                activeOpacity={0.7}
              >
                {/* Avatar with presence dot */}
                <View style={s.avatarWrap}>
                  <View style={[s.avatar, { backgroundColor: color }]}>
                    <Text style={s.avatarText}>{avatarInitials(name)}</Text>
                  </View>
                  <View
                    style={[
                      s.presenceDot,
                      { backgroundColor: presenceColor(pStatus) },
                    ]}
                  />
                </View>

                {/* Name + last-message preview */}
                <View style={s.rowBody}>
                  <View style={s.rowTop}>
                    <Text
                      style={[s.rowName, hasUnread && s.rowNameBold]}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Text style={s.rowTime}>{relativeTime(item.last_message_at)}</Text>
                  </View>
                  <Text
                    style={[s.rowPreview, hasUnread && s.rowPreviewBold]}
                    numberOfLines={1}
                  >
                    {item.last_message ?? 'Tap to start chatting'}
                  </Text>
                </View>

                {/* Unread badge */}
                {hasUnread && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
});

export default DMScreen;

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyIcon: { fontSize: 48, marginBottom: 12, opacity: 0.3 },
  emptyTitle:{ fontSize: 16, fontWeight: '600', color: C.mt },
  emptyBody: { fontSize: 12, color: C.mt, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  list:      { paddingVertical: 4 },

  // Page header (DM list)
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.bd,
    backgroundColor: C.sf,
    gap: 10,
  },
  pageTitle:      { fontSize: 16, fontWeight: '700', color: C.tx, flex: 1 },
  unreadPill:     { backgroundColor: `${C.ac}22`, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  unreadPillText: { color: C.ac, fontSize: 11, fontWeight: '700' },

  // DM list rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.bd,
  },
  avatarWrap: { position: 'relative', width: 46, height: 46, flexShrink: 0 },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '700', color: '#000' },
  presenceDot: {
    position: 'absolute',
    bottom: 0, right: 0,
    width: 13, height: 13,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: C.bg,
  },
  rowBody:        { flex: 1, minWidth: 0 },
  rowTop:         { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  rowName:        { fontSize: 14, fontWeight: '500', color: C.tx, flex: 1 },
  rowNameBold:    { fontWeight: '700' },
  rowTime:        { fontSize: 11, color: C.mt, flexShrink: 0 },
  rowPreview:     { fontSize: 13, color: C.mt, marginTop: 2 },
  rowPreviewBold: { color: C.tx, fontWeight: '500' },
  badge: {
    backgroundColor: C.err,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  // Conversation header
  convHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.bd,
    backgroundColor: C.sf,
    gap: 10,
  },
  backBtn:  { width: 32, alignItems: 'center' },
  backIcon: { fontSize: 20, color: C.mt },
  convAvatarWrap: { position: 'relative', width: 38, height: 38, flexShrink: 0 },
  convAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  convAvatarText: { fontSize: 14, fontWeight: '700', color: '#000' },
  presenceDotLg: {
    position: 'absolute',
    bottom: -1, right: -1,
    width: 12, height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: C.sf,
  },
  convName:   { fontSize: 15, fontWeight: '700', color: C.tx },
  convStatus: { fontSize: 11, fontWeight: '500', marginTop: 1 },
});
