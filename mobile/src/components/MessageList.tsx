import React, { useCallback, useEffect, useRef } from 'react';
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

export type Message = {
  id: string;
  author_id: string;
  text?: string;
  content?: string;
  content_ciphertext?: string;
  created_at: string;
  authorName?: string;
  reply_to_id?: string;
  edited?: boolean;
  pinned?: boolean;
};

type Props = {
  messages:        Message[];
  loading:         boolean;
  refreshing:      boolean;
  onRefresh:       () => void;
  channelName:     string;
  myUserId:        string | null;
  onLongPress?:    (msg: Message) => void;
  typingUsernames?: string[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString())     return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

function authorColor(id: string): string {
  const palette = [C.ac, '#7289da', '#f47fff', '#f9a825', '#4fc3f7', '#ef5350', '#66bb6a'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffff;
  return palette[h % palette.length];
}

// ── List item types ───────────────────────────────────────────────────────────

type ListItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'msg';  key: string; msg: Message };

function buildItems(messages: Message[]): ListItem[] {
  const items: ListItem[] = [];
  let lastDate = '';
  // Messages arrive newest-first from API; display oldest-first
  const sorted = [...messages].reverse();
  for (const msg of sorted) {
    const d = formatDate(msg.created_at);
    if (d !== lastDate) {
      items.push({ type: 'date', key: `date-${d}-${msg.id}`, label: d });
      lastDate = d;
    }
    items.push({ type: 'msg', key: msg.id, msg });
  }
  return items;
}

// ── MsgRow ────────────────────────────────────────────────────────────────────

function MsgRow({
  msg, isMine, onLongPress,
}: {
  msg: Message;
  isMine: boolean;
  onLongPress?: () => void;
}) {
  const text  = msg.text || msg.content || (msg.content_ciphertext ? '🔒 Encrypted' : '');
  const color = authorColor(msg.author_id);

  return (
    <TouchableOpacity
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.85}
      style={[s.msgRow, isMine && s.msgRowMine]}
    >
      {/* Avatar (other users only) */}
      {!isMine && (
        <View style={[s.avatar, { backgroundColor: color }]}>
          <Text style={s.avatarTx}>{(msg.authorName ?? '?')[0].toUpperCase()}</Text>
        </View>
      )}

      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleOther]}>
        {/* Reply-to indicator */}
        {msg.reply_to_id && (
          <View style={[s.replyBar, isMine && s.replyBarMine]}>
            <Text style={[s.replyTx, isMine && s.replyTxMine]} numberOfLines={1}>
              ↩ Replying to a message
            </Text>
          </View>
        )}

        {/* Author name (other users only) */}
        {!isMine && (
          <Text style={[s.authorName, { color }]}>
            {msg.authorName ?? msg.author_id.slice(0, 8)}
          </Text>
        )}

        {/* Message text */}
        <Text style={[s.msgTx, isMine && s.msgTxMine]} selectable>
          {text}
        </Text>

        {/* Timestamp + edit/pin badges */}
        <View style={s.meta}>
          <Text style={[s.timestamp, isMine && s.timestampMine]}>
            {formatTime(msg.created_at)}
          </Text>
          {msg.edited && (
            <Text style={[s.badge, isMine && s.badgeMine]}> (edited)</Text>
          )}
          {msg.pinned && (
            <Text style={[s.badge, isMine && s.badgeMine]}> 📌</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Typing Indicator ──────────────────────────────────────────────────────────

function TypingIndicator({ usernames }: { usernames: string[] }) {
  if (usernames.length === 0) return null;
  const label =
    usernames.length === 1 ? `${usernames[0]} is typing…` :
    usernames.length === 2 ? `${usernames[0]} and ${usernames[1]} are typing…` :
    'Several people are typing…';
  return (
    <View style={s.typingRow}>
      <View style={s.dots}>
        {[0, 1, 2].map(i => <View key={i} style={s.dot} />)}
      </View>
      <Text style={s.typingTx}>{label}</Text>
    </View>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MessageList({
  messages, loading, refreshing, onRefresh,
  channelName, myUserId, onLongPress, typingUsernames = [],
}: Props) {
  const flatListRef = useRef<FlatList>(null);
  const items = buildItems(messages);

  useEffect(() => {
    if (items.length > 0 && !loading) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [items.length, loading]);

  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'date') {
      return (
        <View style={s.dateSep}>
          <View style={s.dateLine} />
          <Text style={s.dateLabel}>{item.label}</Text>
          <View style={s.dateLine} />
        </View>
      );
    }
    const isMine = item.msg.author_id === myUserId;
    return (
      <MsgRow
        msg={item.msg}
        isMine={isMine}
        onLongPress={onLongPress ? () => onLongPress(item.msg) : undefined}
      />
    );
  }, [myUserId, onLongPress]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.ac} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={flatListRef}
        data={items}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        contentContainerStyle={items.length === 0 ? s.emptyContainer : s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ac} colors={[C.ac]} />
        }
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.emptyIcon}>#</Text>
            <Text style={s.emptyTitle}>{channelName}</Text>
            <Text style={s.emptyBody}>No messages yet. Be the first to say something!</Text>
          </View>
        }
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />
      <TypingIndicator usernames={typingUsernames} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:           { paddingVertical: 8 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIcon:      { fontSize: 48, color: C.bd, fontWeight: '700', marginBottom: 8 },
  emptyTitle:     { fontSize: 18, fontWeight: '700', color: C.tx, marginBottom: 6 },
  emptyBody:      { fontSize: 13, color: C.mt, textAlign: 'center', lineHeight: 18 },

  dateSep:   { flexDirection: 'row', alignItems: 'center', marginVertical: 12, paddingHorizontal: 16, gap: 8 },
  dateLine:  { flex: 1, height: 1, backgroundColor: C.bd },
  dateLabel: { fontSize: 11, color: C.mt, fontWeight: '600' },

  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 3, gap: 8 },
  msgRowMine: { flexDirection: 'row-reverse' },

  avatar:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2, flexShrink: 0 },
  avatarTx: { fontSize: 13, fontWeight: '700', color: '#000' },

  bubble:      { maxWidth: '76%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  bubbleOther: { backgroundColor: C.sf2, borderBottomLeftRadius: 4 },
  bubbleMine:  { backgroundColor: C.ac,  borderBottomRightRadius: 4 },

  replyBar:     { borderLeftWidth: 2, borderLeftColor: `${C.mt}88`, paddingLeft: 6, marginBottom: 4 },
  replyBarMine: { borderLeftColor: 'rgba(0,0,0,0.3)' },
  replyTx:      { fontSize: 11, color: C.mt, fontStyle: 'italic' },
  replyTxMine:  { color: 'rgba(0,0,0,0.5)' },

  authorName: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  msgTx:      { fontSize: 14, color: C.tx, lineHeight: 20 },
  msgTxMine:  { color: '#000' },

  meta:          { flexDirection: 'row', alignItems: 'center', marginTop: 3, alignSelf: 'flex-end' },
  timestamp:     { fontSize: 10, color: C.mt },
  timestampMine: { color: 'rgba(0,0,0,0.45)' },
  badge:         { fontSize: 10, color: C.mt },
  badgeMine:     { color: 'rgba(0,0,0,0.45)' },

  typingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 5,
    minHeight: 24,
  },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: C.mt },
  typingTx: { fontSize: 11, color: C.mt, fontStyle: 'italic' },
});
