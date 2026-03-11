/**
 * MainScreen — Root app shell after authentication.
 *
 * Architecture:
 *   MainContext  — all shared state + actions (defined in MainScreen provider)
 *   Bottom tabs  — React Navigation createBottomTabNavigator with custom tabBar
 *   Back button  — useFocusEffect per tab so each tab handles its own back stack
 *
 * Tabs:
 *   Servers  — ServerRail + sliding ChannelList panel + chat area
 *   DMs      — DMScreen (kept mounted so WS events are never missed)
 *   Friends  — all / pending / add sub-tabs, FlatList with pull-to-refresh
 *   Settings — SettingsScreen
 */

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackNavigationProp } from '@react-navigation/stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';

import type { RootStackParamList } from '../../App';
import { C } from '../../App';
import { api } from '../api/CitadelAPI';
import { WebSocketService, WsStatus } from '../services/WebSocketService';
import { initPushService } from '../services/PushService';
import ServerRail, { Server } from '../components/ServerRail';
import ChannelList, { Channel, Category } from '../components/ChannelList';
import MessageList, { Message } from '../components/MessageList';
import MessageInput from '../components/MessageInput';
import DMScreen, { DMScreenHandle } from './DMScreen';
import SettingsScreen from './SettingsScreen';
import NearbyScreen, { ProxVoiceState } from './NearbyScreen';
import { VoiceService, VoiceUser } from '../services/VoiceService';
import { getWifiDirectService } from '../services/WifiDirectService';
import { getOfflineSyncService, SyncResult } from '../services/OfflineSyncService';
import NetInfo from '@react-native-community/netinfo';

// ── Types ────────────────────────────────────────────────────────────────────

type MainScreenProps = {
  navigation: StackNavigationProp<RootStackParamList, 'Main'>;
  onLogout: () => void;
};

type PresenceMap = Record<string, string>;
type FriendTab  = 'all' | 'pending' | 'add';

type BottomTabParamList = {
  Servers:  undefined;
  DMs:      undefined;
  Friends:  undefined;
  Nearby:   undefined;
  Settings: undefined;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function wsStatusColor(s: WsStatus): string {
  if (s === 'connected')    return '#3ba55d';
  if (s === 'disconnected') return C.err;
  return C.warn;
}

function wsStatusLabel(s: WsStatus): string {
  if (s === 'connected')    return 'Live';
  if (s === 'connecting')   return 'Connecting…';
  if (s === 'reconnecting') return 'Reconnecting…';
  return 'Offline';
}

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

// ── Context ───────────────────────────────────────────────────────────────────

interface MainCtx {
  // Server / channel
  servers:      Server[];
  curServer:    Server | null;
  channels:     Channel[];
  categories:   Category[];
  curChannel:   Channel | null;
  messages:     Message[];
  presence:     PresenceMap;
  panelOpen:    boolean;
  loadingCh:    boolean;
  loadingMsgs:  boolean;
  refreshing:   boolean;
  sending:      boolean;
  wsStatus:     WsStatus;
  // Voice
  voiceChannel:    Channel | null;
  voiceUsers:      VoiceUser[];
  isMuted:         boolean;
  isSpeaker:       boolean;
  voiceConnecting: boolean;
  // DM
  dmWsEvent:      any;
  dmUnreadCounts: Record<string, number>;
  serverMentionCount: number;
  dmScreenRef:    React.RefObject<DMScreenHandle>;
  openDmIdRef:    React.MutableRefObject<string | null>;
  // Friends
  friends:       any[];
  incoming:      any[];
  outgoing:      any[];
  friendTab:     FriendTab;
  friendSearchQ: string;
  friendSearchR: any[];
  friendMsg:     string;
  loadingFriends: boolean;
  // Typing / unread / reply
  typingUsers:      string[];
  channelUnread:    Record<string, number>;
  replyTo:          Message | null;
  setReplyTo:       (msg: Message | null) => void;
  handleSendTyping: () => void;
  // Proximity
  proximityActive:         boolean;
  setProximityActive:      (v: boolean) => void;
  proxVoiceCall:           ProxVoiceState | null;
  setProxVoiceCall:        (s: ProxVoiceState | null) => void;
  handleLeaveProxVoice:    () => void;
  handleToggleProxMute:    () => void;
  handleToggleProxSpeaker: () => void;
  // Actions
  selectServer:      (s: Server) => Promise<void>;
  selectChannel:     (s: Server, ch: Channel) => Promise<void>;
  setPanelOpen:      (v: boolean | ((p: boolean) => boolean)) => void;
  handleRefresh:     () => void;
  handleSend:        (text: string) => Promise<void>;
  loadFriends:       () => Promise<void>;
  doFriendSearch:    () => Promise<void>;
  sendFriendRequest: (uid: string) => Promise<void>;
  acceptFriend:      (id: string) => Promise<void>;
  declineFriend:     (id: string) => Promise<void>;
  removeFriend:      (id: string) => Promise<void>;
  setFriendTab:      (t: FriendTab) => void;
  setFriendSearchQ:  (q: string) => void;
  handleLogout:      () => Promise<void>;
  clearDmUnread:     (dmId: string) => void;
  toggleMute:        () => void;
  toggleSpeaker:     () => void;
  leaveVoice:        () => Promise<void>;
}

const MainContext = createContext<MainCtx>(null!);
const useMain = () => useContext(MainContext);

// ── VoiceBar ─────────────────────────────────────────────────────────────────

function VoiceBar() {
  const { voiceChannel, voiceUsers, isMuted, isSpeaker, voiceConnecting,
          toggleMute, toggleSpeaker, leaveVoice } = useMain();
  if (!voiceChannel) return null;
  return (
    <View style={vb.bar}>
      <View style={vb.left}>
        <View style={vb.dotWrap}>
          {voiceConnecting
            ? <ActivityIndicator size="small" color="#3ba55d" />
            : <View style={vb.dot} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={vb.chName} numberOfLines={1}>🔊 {voiceChannel.name}</Text>
          <Text style={vb.count}>{voiceConnecting ? 'Connecting…' : `${voiceUsers.length} connected`}</Text>
        </View>
      </View>

      {!voiceConnecting && voiceUsers.length > 0 && (
        <View style={vb.avatarRow}>
          {voiceUsers.slice(0, 3).map(u => (
            <View key={u.user_id} style={[vb.micro, u.muted && vb.microMuted]}>
              <Text style={vb.microTx}>{(u.username || '?')[0].toUpperCase()}</Text>
            </View>
          ))}
          {voiceUsers.length > 3 && <Text style={vb.more}>+{voiceUsers.length - 3}</Text>}
        </View>
      )}

      <View style={vb.controls}>
        <TouchableOpacity onPress={toggleMute} style={[vb.btn, isMuted && vb.btnActive]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={vb.icon}>{isMuted ? '🔇' : '🎤'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={toggleSpeaker} style={[vb.btn, isSpeaker && vb.btnActive]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={vb.icon}>{isSpeaker ? '🔊' : '🔈'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={leaveVoice} style={vb.leave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={vb.leaveIcon}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const vb = StyleSheet.create({
  bar:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0e1f16', borderTopWidth: 1, borderTopColor: '#1d3b26', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  left:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  dotWrap:  { width: 20, alignItems: 'center' },
  dot:      { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3ba55d' },
  chName:   { fontSize: 13, fontWeight: '700', color: '#3ba55d' },
  count:    { fontSize: 11, color: '#5a8a68', marginTop: 1 },
  avatarRow:{ flexDirection: 'row', gap: 2, alignItems: 'center' },
  micro:    { width: 24, height: 24, borderRadius: 12, backgroundColor: C.ac, alignItems: 'center', justifyContent: 'center' },
  microMuted: { opacity: 0.4 },
  microTx:  { fontSize: 10, fontWeight: '700', color: '#000' },
  more:     { fontSize: 11, color: '#5a8a68', marginLeft: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn:      { padding: 6, borderRadius: 6 },
  btnActive:{ backgroundColor: 'rgba(255,71,87,0.15)' },
  icon:     { fontSize: 18 },
  leave:    { padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,71,87,0.15)', marginLeft: 4 },
  leaveIcon:{ fontSize: 14, color: C.err, fontWeight: '700' },
});

// ── Sync Toast (iOS — Android uses ToastAndroid) ─────────────────────────────

function SyncToast({ message, onHide }: { message: string; onHide: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    // Fade + slide in
    Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    // Auto-dismiss after 3 s
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 260, useNativeDriver: true }).start(onHide);
    }, 3000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View
      style={[
        st.bar,
        {
          opacity:   anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
      pointerEvents="none"
    >
      <Text style={st.tx} numberOfLines={2}>✓ {message}</Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 100, left: 24, right: 24,
    backgroundColor: 'rgba(30,30,30,0.92)',
    borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    alignItems: 'center',
    zIndex: 999,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  tx: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
});

// ── Proximity Voice Overlay ───────────────────────────────────────────────────

function ProxVoiceOverlay() {
  const { proxVoiceCall, handleLeaveProxVoice, handleToggleProxMute, handleToggleProxSpeaker } = useMain();
  const pulseAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (!proxVoiceCall) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!proxVoiceCall]);

  if (!proxVoiceCall) return null;

  return (
    <View style={pvo.bar}>
      {/* Animated green accent bar at top */}
      <Animated.View style={[pvo.greenBar, { opacity: pulseAnim }]} />

      <View style={pvo.row}>
        {/* Left: status + participant count */}
        <View style={pvo.left}>
          <Animated.View style={[pvo.dot, { opacity: pulseAnim }]} />
          <View>
            <Text style={pvo.label} numberOfLines={1}>
              {proxVoiceCall.role === 'host' ? 'Hosting Voice Channel' : 'In Proximity Voice'}
            </Text>
            <Text style={pvo.sub}>
              {proxVoiceCall.participantCount} participant{proxVoiceCall.participantCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {/* Right: controls */}
        <View style={pvo.controls}>
          <TouchableOpacity
            onPress={handleToggleProxMute}
            style={[pvo.btn, proxVoiceCall.muted && pvo.btnActive]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={pvo.icon}>{proxVoiceCall.muted ? '🔇' : '🎙'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleToggleProxSpeaker}
            style={[pvo.btn, proxVoiceCall.speakerOn && pvo.btnActive]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={pvo.icon}>{proxVoiceCall.speakerOn ? '🔊' : '🔈'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleLeaveProxVoice}
            style={pvo.leaveBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={pvo.leaveIcon}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const pvo = StyleSheet.create({
  bar: {
    backgroundColor: '#0e1f16',
    borderTopWidth: 1,
    borderTopColor: '#1d3b26',
    overflow: 'hidden',
  },
  greenBar: {
    height: 2,
    backgroundColor: '#3ba55d',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  dot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3ba55d', flexShrink: 0 },
  label: { fontSize: 13, fontWeight: '700', color: '#3ba55d' },
  sub:   { fontSize: 11, color: '#5a8a68', marginTop: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn:      { padding: 6, borderRadius: 6 },
  btnActive:{ backgroundColor: 'rgba(255,71,87,0.15)' },
  icon:     { fontSize: 18 },
  leaveBtn: { padding: 6, borderRadius: 6, backgroundColor: 'rgba(255,71,87,0.15)', marginLeft: 4 },
  leaveIcon:{ fontSize: 14, color: C.err, fontWeight: '700' },
});

// ── Custom Tab Bar ────────────────────────────────────────────────────────────

function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const { dmUnreadCounts, incoming, serverMentionCount, proximityActive } = useMain();
  const insets = useSafeAreaInsets();

  const dmsBadge     = Object.values(dmUnreadCounts).reduce((a, b) => a + b, 0);
  const friendsBadge = incoming.length;

  const tabs = [
    { name: 'Servers',  emoji: '🖥',  badge: serverMentionCount, dotOnly: true,  proxDot: false },
    { name: 'DMs',      emoji: '💬',  badge: dmsBadge,           dotOnly: false, proxDot: false },
    { name: 'Friends',  emoji: '👥',  badge: friendsBadge,       dotOnly: false, proxDot: false },
    { name: 'Nearby',   emoji: '📡',  badge: 0,                  dotOnly: false, proxDot: proximityActive },
    { name: 'Settings', emoji: '⚙️', badge: 0,                  dotOnly: false, proxDot: false },
  ] as const;

  return (
    <>
      <ProxVoiceOverlay />
      <VoiceBar />
      <View style={[tb.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {tabs.map((t, idx) => {
          const isActive = state.index === idx;
          const count    = t.badge;
          return (
            <TouchableOpacity
              key={t.name}
              onPress={() => navigation.navigate(t.name as any)}
              style={tb.tab}
              activeOpacity={0.7}
            >
              <View style={tb.iconWrap}>
                <Text style={[tb.emoji, isActive && tb.emojiActive]}>{t.emoji}</Text>
                {count > 0 && (
                  <View style={tb.badge}>
                    <Text style={tb.badgeText}>
                      {t.dotOnly ? '' : count > 99 ? '99+' : String(count)}
                    </Text>
                  </View>
                )}
                {/* Green proximity-active dot (bottom-right of icon) */}
                {t.proxDot && <View style={tb.proxDot} />}
              </View>
              <Text style={[tb.label, isActive && tb.labelActive]}>{t.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

const tb = StyleSheet.create({
  bar:         { flexDirection: 'row', backgroundColor: C.sf, borderTopWidth: 1, borderTopColor: C.bd, paddingTop: 8 },
  tab:         { flex: 1, alignItems: 'center', paddingBottom: 4 },
  iconWrap:    { position: 'relative', marginBottom: 3 },
  emoji:       { fontSize: 22, color: C.mt },
  emojiActive: { color: C.ac },
  label:       { fontSize: 10, color: C.mt, fontWeight: '500' },
  labelActive: { color: C.ac, fontWeight: '700' },
  badge: {
    position: 'absolute', top: -4, right: -10,
    backgroundColor: C.err, borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  proxDot: {
    position: 'absolute',
    bottom: -1, right: -4,
    width: 9, height: 9,
    borderRadius: 5,
    backgroundColor: '#3ba55d',
    borderWidth: 1.5,
    borderColor: C.bg,
  },
});

// ── Tab Navigator ─────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<BottomTabParamList>();

// ── Tab Screens ───────────────────────────────────────────────────────────────

function ServersTab() {
  const {
    servers, curServer, channels, categories, curChannel, messages,
    panelOpen, setPanelOpen, loadingCh, loadingMsgs, refreshing, sending,
    wsStatus, selectServer, selectChannel, handleRefresh, handleSend,
    typingUsers, channelUnread, replyTo, setReplyTo, handleSendTyping,
    voiceChannel, voiceUsers,
  } = useMain();

  const [ctxMenu, setCtxMenu] = useState<{ visible: boolean; msg: Message | null }>({ visible: false, msg: null });

  // Close panel on Android back, then let navigator handle the rest
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (ctxMenu.visible) { setCtxMenu({ visible: false, msg: null }); return true; }
      if (panelOpen) { setPanelOpen(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [panelOpen, setPanelOpen, ctxMenu.visible]));

  const voiceMembers = voiceUsers.map(u => ({ userId: u.user_id, username: u.username, muted: u.muted }));

  const handleLongPress = useCallback((msg: Message) => {
    setCtxMenu({ visible: true, msg });
  }, []);

  const closeCtx = () => setCtxMenu({ visible: false, msg: null });

  const handleCtxReply = () => {
    setReplyTo(ctxMenu.msg);
    closeCtx();
  };

  const handleCtxDelete = async () => {
    if (!ctxMenu.msg) return;
    const id = ctxMenu.msg.id;
    closeCtx();
    try { await api.deleteMessage(id); } catch {}
  };

  const handleCtxPin = async () => {
    if (!ctxMenu.msg || !curChannel) return;
    const { id } = ctxMenu.msg;
    closeCtx();
    try { await api.pinMessage(curChannel.id, id); } catch {}
  };

  return (
    <View style={s.body}>
      <ServerRail servers={servers} selectedId={curServer?.id ?? null} onSelect={selectServer} />

      {panelOpen && curServer && (
        <ChannelList
          serverName={curServer.name}
          channels={channels}
          categories={categories}
          selectedId={curChannel?.id ?? null}
          loading={loadingCh}
          onSelect={ch => selectChannel(curServer, ch)}
          onClose={() => setPanelOpen(false)}
          unreadCounts={channelUnread}
          voiceChannelId={voiceChannel?.id ?? null}
          voiceMembers={voiceMembers}
        />
      )}

      <View style={s.chat}>
        {/* Header */}
        <View style={s.chatHeader}>
          <TouchableOpacity
            onPress={() => setPanelOpen(p => !p)}
            style={s.headerIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.headerIcon}>{panelOpen ? '✕' : '☰'}</Text>
          </TouchableOpacity>
          <View style={s.headerInfo}>
            {curChannel ? (
              <>
                <Text style={s.headerChIcon}>{curChannel.channel_type === 'voice' ? '🔊' : '#'}</Text>
                <Text style={s.headerChName} numberOfLines={1}>{curChannel.name}</Text>
              </>
            ) : (
              <Text style={s.headerPlaceholder}>
                {curServer ? 'Select a channel' : 'Select a server'}
              </Text>
            )}
          </View>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: wsStatusColor(wsStatus) }]} />
            {wsStatus !== 'connected' && (
              <Text style={[s.statusLabel, { color: wsStatusColor(wsStatus) }]}>
                {wsStatusLabel(wsStatus)}
              </Text>
            )}
          </View>
        </View>

        {curChannel ? (
          <>
            <MessageList
              messages={messages}
              loading={loadingMsgs}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              channelName={curChannel.name}
              myUserId={api.userId}
              onLongPress={handleLongPress}
              typingUsernames={typingUsers}
            />
            <MessageInput
              channelName={curChannel.name}
              sending={sending}
              onSend={handleSend}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onTyping={handleSendTyping}
            />
          </>
        ) : (
          <View style={s.fullCenter}>
            <Text style={s.placeholderIcon}>💬</Text>
            <Text style={s.placeholderText}>
              {servers.length === 0 ? 'No servers yet' : curServer ? 'Pick a channel' : 'Pick a server'}
            </Text>
          </View>
        )}
      </View>

      {/* Long-press context menu */}
      <Modal visible={ctxMenu.visible} transparent animationType="fade" onRequestClose={closeCtx}>
        <Pressable style={ctx.overlay} onPress={closeCtx}>
          <View style={ctx.sheet}>
            <TouchableOpacity style={ctx.option} onPress={handleCtxReply}>
              <Text style={ctx.optionTx}>↩  Reply</Text>
            </TouchableOpacity>
            {ctxMenu.msg?.author_id === api.userId && (
              <TouchableOpacity style={ctx.option} onPress={handleCtxDelete}>
                <Text style={[ctx.optionTx, { color: C.err }]}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={ctx.option} onPress={handleCtxPin}>
              <Text style={ctx.optionTx}>Pin</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ctx.option, ctx.optionLast]} onPress={closeCtx}>
              <Text style={[ctx.optionTx, { color: C.mt }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function DmsTab() {
  const { presence, dmUnreadCounts, dmWsEvent, clearDmUnread, dmScreenRef, openDmIdRef } = useMain();

  // Close DM conversation on Android back
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openDmIdRef.current) { dmScreenRef.current?.closeConversation(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []));

  return (
    <DMScreen
      ref={dmScreenRef}
      presence={presence}
      dmUnreadCounts={dmUnreadCounts}
      onClearUnread={clearDmUnread}
      latestDmEvent={dmWsEvent}
      onConversationChange={dmId => { openDmIdRef.current = dmId; }}
    />
  );
}

function FriendsTab() {
  const {
    friends, incoming, outgoing, friendTab, friendSearchQ, friendSearchR,
    friendMsg, loadingFriends, setFriendTab, setFriendSearchQ,
    loadFriends, doFriendSearch, sendFriendRequest, acceptFriend, declineFriend, removeFriend,
  } = useMain();

  const pc = incoming.length + outgoing.length;
  const subTabs: { id: FriendTab; label: string }[] = [
    { id: 'all',     label: 'All' },
    { id: 'pending', label: pc ? `Pending (${pc})` : 'Pending' },
    { id: 'add',     label: '+ Add' },
  ];

  // Items for the active sub-tab FlatList
  const friendItems: any[] = friendTab === 'all' ? friends : friendTab === 'pending' ? [...incoming, ...outgoing] : [];

  const renderFriendItem = ({ item: f }: { item: any }) => {
    if (friendTab === 'all') {
      const name = f.friend_username || f.username || '?';
      const fid  = f.friend_id || f.id;
      return (
        <View style={s.listRow}>
          <View style={[s.avatar40, { backgroundColor: hashColor(fid) }]}>
            <Text style={s.avatar40Tx}>{avatarInitials(name)}</Text>
          </View>
          <Text style={[s.rowName, { flex: 1 }]}>{name}</Text>
          <TouchableOpacity style={s.rowBtn} onPress={() => api.createDm(fid)}>
            <Text style={s.rowBtnTx}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.rowBtn, s.rowBtnDanger]} onPress={() => removeFriend(f.id)}>
            <Text style={[s.rowBtnTx, { color: C.err }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (friendTab === 'pending') {
      const isIn = incoming.some(r => r.id === f.id);
      const name = isIn ? (f.sender_username || f.username || '?') : (f.recipient_username || f.username || '?');
      return (
        <View style={s.listRow}>
          <View style={[s.avatar40, { backgroundColor: hashColor(f.id) }]}>
            <Text style={s.avatar40Tx}>{avatarInitials(name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowName}>{name}</Text>
            <Text style={{ fontSize: 11, color: C.mt }}>{isIn ? 'Incoming' : 'Outgoing'}</Text>
          </View>
          {isIn ? (
            <>
              <TouchableOpacity style={[s.rowBtn, s.rowBtnAccept]} onPress={() => acceptFriend(f.id)}>
                <Text style={[s.rowBtnTx, { color: '#000' }]}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.rowBtn, s.rowBtnDanger]} onPress={() => declineFriend(f.id)}>
                <Text style={[s.rowBtnTx, { color: C.err }]}>Decline</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 11, color: C.mt, marginRight: 8 }}>Pending</Text>
              <TouchableOpacity style={[s.rowBtn, s.rowBtnDanger]} onPress={() => removeFriend(f.id)}>
                <Text style={[s.rowBtnTx, { color: C.err }]}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      );
    }
    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>Friends</Text>
      </View>

      {/* Sub-tabs */}
      <View style={s.subTabBar}>
        {subTabs.map(t => (
          <TouchableOpacity
            key={t.id}
            onPress={() => setFriendTab(t.id)}
            style={[s.subTab, friendTab === t.id && s.subTabActive]}
          >
            <Text style={[s.subTabLabel, friendTab === t.id && s.subTabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Add friend UI */}
      {friendTab === 'add' ? (
        <FlatList
          data={friendSearchR}
          keyExtractor={u => u.id}
          ListHeaderComponent={
            <View style={{ padding: 16 }}>
              <Text style={s.addTitle}>Add Friend</Text>
              <Text style={s.addHint}>Search by username to send a friend request.</Text>
              <View style={s.addRow}>
                <TextInput
                  style={s.addInput}
                  value={friendSearchQ}
                  onChangeText={setFriendSearchQ}
                  onSubmitEditing={doFriendSearch}
                  placeholder="Enter a username"
                  placeholderTextColor={C.mt}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <TouchableOpacity onPress={doFriendSearch} style={s.addBtn}>
                  <Text style={s.addBtnTx}>Search</Text>
                </TouchableOpacity>
              </View>
              {!!friendMsg && (
                <View style={s.friendMsgBox}>
                  <Text style={s.friendMsgTx}>{friendMsg}</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item: u }) => (
            <View style={s.listRow}>
              <View style={[s.avatar40, { backgroundColor: hashColor(u.id) }]}>
                <Text style={s.avatar40Tx}>{avatarInitials(u.username)}</Text>
              </View>
              <Text style={[s.rowName, { flex: 1 }]}>{u.username}</Text>
              <TouchableOpacity style={[s.rowBtn, s.rowBtnAccept]} onPress={() => sendFriendRequest(u.id)}>
                <Text style={[s.rowBtnTx, { color: '#000' }]}>Add</Text>
              </TouchableOpacity>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      ) : (
        /* All / Pending — FlatList with pull-to-refresh */
        <FlatList
          data={friendItems}
          keyExtractor={f => f.id}
          refreshControl={
            <RefreshControl
              refreshing={loadingFriends}
              onRefresh={loadFriends}
              tintColor={C.ac}
              colors={[C.ac]}
            />
          }
          renderItem={renderFriendItem}
          ListEmptyComponent={
            loadingFriends ? null : (
              <View style={[s.fullCenter, { paddingTop: 64 }]}>
                <Text style={s.placeholderIcon}>{friendTab === 'all' ? '👥' : '📭'}</Text>
                <Text style={s.placeholderText}>
                  {friendTab === 'all' ? 'No friends yet' : 'No pending requests'}
                </Text>
                {friendTab === 'all' && (
                  <Text style={s.hintText}>Go to "+ Add" to get started.</Text>
                )}
              </View>
            )
          }
          contentContainerStyle={{ flexGrow: 1 }}
        />
      )}
    </View>
  );
}

function NearbyTab() {
  const { setProximityActive, proxVoiceCall, setProxVoiceCall } = useMain();
  return (
    <NearbyScreen
      onSetProximityActive={setProximityActive}
      proxVoiceCall={proxVoiceCall}
      onVoiceCallChange={setProxVoiceCall}
    />
  );
}

function SettingsTab() {
  const { handleLogout } = useMain();
  return <SettingsScreen onLogout={handleLogout} />;
}

// ── MainScreen (Context Provider) ─────────────────────────────────────────────

export default function MainScreen({ navigation, onLogout }: MainScreenProps) {

  // ── Server / channel ──────────────────────────────────────────────────────
  const [servers, setServers]       = useState<Server[]>([]);
  const [curServer, setCurServer]   = useState<Server | null>(null);
  const [channels, setChannels]     = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [curChannel, setCurChannel] = useState<Channel | null>(null);
  const [messages, setMessages]     = useState<Message[]>([]);
  const [presence, setPresence]     = useState<PresenceMap>({});
  const [panelOpen, setPanelOpen]   = useState(false);
  const [loadingCh, setLoadingCh]   = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending]       = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError]   = useState('');
  const [wsStatus, setWsStatus]     = useState<WsStatus>('disconnected');

  // ── Voice ─────────────────────────────────────────────────────────────────
  const [voiceChannel, setVoiceChannel]       = useState<Channel | null>(null);
  const [voiceUsers, setVoiceUsers]           = useState<VoiceUser[]>([]);
  const [isMuted, setIsMuted]                 = useState(false);
  const [isSpeaker, setIsSpeaker]             = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const voiceServiceRef = useRef<VoiceService | null>(null);

  // ── DM ────────────────────────────────────────────────────────────────────
  const [dmWsEvent, setDmWsEvent]             = useState<any>(null);
  const [dmUnreadCounts, setDmUnreadCounts]   = useState<Record<string, number>>({});
  const [serverMentionCount, setServerMentionCount] = useState(0);
  const dmScreenRef   = useRef<DMScreenHandle>(null);
  const openDmIdRef   = useRef<string | null>(null);

  // ── Friends ───────────────────────────────────────────────────────────────
  const [friends, setFriends]           = useState<any[]>([]);
  const [incoming, setIncoming]         = useState<any[]>([]);
  const [outgoing, setOutgoing]         = useState<any[]>([]);
  const [friendTab, setFriendTab]       = useState<FriendTab>('all');
  const [friendSearchQ, setFriendSearchQ] = useState('');
  const [friendSearchR, setFriendSearchR] = useState<any[]>([]);
  const [friendMsg, setFriendMsg]       = useState('');
  const [loadingFriends, setLoadingFriends] = useState(false);

  // ── Typing / Unread / Reply ───────────────────────────────────────────────
  const [typingUsers, setTypingUsers]     = useState<string[]>([]);
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [replyTo, setReplyTo]             = useState<Message | null>(null);

  // ── Proximity ─────────────────────────────────────────────────────────────
  const [proximityActive, setProximityActive] = useState(false);
  const [proxVoiceCall, setProxVoiceCall]     = useState<ProxVoiceState | null>(null);

  // ── Offline sync ──────────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState('');
  const isOnlineRef             = useRef(true); // updated by NetInfo listener

  // ── Refs ──────────────────────────────────────────────────────────────────
  const wsRef              = useRef<WebSocketService | null>(null);
  const curChannelRef      = useRef<Channel | null>(null);
  const userMapRef         = useRef<Record<string, string>>({});
  const pushCleanupRef     = useRef<(() => Promise<void>) | null>(null);
  const typingTimeoutsRef  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const typingThrottleRef  = useRef<number>(0);
  const replyToRef         = useRef<Message | null>(null);

  // ── Sync refs ─────────────────────────────────────────────────────────────
  useEffect(() => { curChannelRef.current = curChannel; }, [curChannel]);
  useEffect(() => { replyToRef.current = replyTo; }, [replyTo]);

  // ── Voice helpers (defined early so they can be referenced by selectServer) ─
  const leaveVoice = useCallback(async () => {
    if (!voiceServiceRef.current) return;
    await voiceServiceRef.current.leave();
    voiceServiceRef.current = null;
    setVoiceChannel(null);
    setVoiceUsers([]);
    setIsMuted(false);
    setIsSpeaker(false);
  }, []);

  const joinVoice = useCallback(async (ch: Channel) => {
    if (!wsRef.current) return;
    if (voiceServiceRef.current) await leaveVoice();
    setVoiceConnecting(true);
    setVoiceChannel(ch);
    try {
      const svc = new VoiceService(wsRef.current, ch.id, api.userId ?? '');
      voiceServiceRef.current = svc;
      svc.onUsersChanged(users => setVoiceUsers(users));
      await svc.join();
    } catch (e) {
      console.warn('[voice] join failed:', e);
      voiceServiceRef.current = null;
      setVoiceChannel(null);
    } finally {
      setVoiceConnecting(false);
    }
  }, [leaveVoice]);

  // ── WebSocket setup ───────────────────────────────────────────────────────
  const connectWs = useCallback((srv: Server) => {
    wsRef.current?.destroy();
    const ws = new WebSocketService(srv.id, () => api.token);
    wsRef.current = ws;
    ws.onStatus(setWsStatus);

    const handleMsg = (evt: any) => {
      if (evt.channel_id === curChannelRef.current?.id) {
        setMessages(prev => {
          if (prev.some(m => m.id === evt.id)) return prev;
          return [...prev, {
            id: evt.id, author_id: evt.author_id,
            text: evt.text || evt.content,
            created_at: evt.created_at || new Date().toISOString(),
            authorName: userMapRef.current[evt.author_id] || evt.username || evt.author_id?.slice(0, 8),
          }];
        });
        const myName = api.username?.toLowerCase();
        const body   = (evt.text || evt.content || '').toLowerCase();
        if (myName && body.includes(`@${myName}`) && evt.author_id !== api.userId) {
          setServerMentionCount(p => p + 1);
        }
      } else if (evt.channel_id) {
        setChannelUnread(prev => ({ ...prev, [evt.channel_id]: (prev[evt.channel_id] || 0) + 1 }));
      }
    };
    ws.on('message_create', handleMsg);
    ws.on('MESSAGE_CREATE', handleMsg);

    ws.on('message_delete', (evt: any) => {
      if (evt.id) setMessages(prev => prev.filter(m => m.id !== evt.id));
    });

    ws.on('typing_start', (evt: any) => {
      if (evt.channel_id !== curChannelRef.current?.id) return;
      if (evt.user_id === api.userId) return;
      const username = userMapRef.current[evt.user_id] || evt.username || evt.user_id?.slice(0, 8) || '?';
      setTypingUsers(prev => prev.includes(username) ? prev : [...prev, username]);
      clearTimeout(typingTimeoutsRef.current[evt.user_id]);
      typingTimeoutsRef.current[evt.user_id] = setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => u !== username));
      }, 4000);
    });

    ws.on('dm_message', (evt: any) => {
      setDmWsEvent({ ...evt, _ts: Date.now() });
      const dmId = evt.dm_id || evt.conversation_id;
      const isMe = evt.author_id === api.userId || evt.sender_id === api.userId;
      if (!isMe && dmId && openDmIdRef.current !== dmId) {
        setDmUnreadCounts(prev => ({ ...prev, [dmId]: (prev[dmId] || 0) + 1 }));
      }
    });

    ws.on('presence_update', (evt: any) => {
      if (evt.user_id) setPresence(prev => ({ ...prev, [evt.user_id]: evt.status || 'online' }));
    });
    ws.on('status_change', (evt: any) => {
      if (evt.user_id) setPresence(prev => ({ ...prev, [evt.user_id]: evt.status || 'online' }));
    });
  }, []);

  // ── Message helpers ───────────────────────────────────────────────────────
  const resolveAuthors = async (list: Message[]): Promise<Message[]> => {
    const unknown = [...new Set(list.map(m => m.author_id))].filter(id => id && !userMapRef.current[id]);
    if (!unknown.length) {
      return list.map(m => ({ ...m, authorName: userMapRef.current[m.author_id] || m.author_id?.slice(0, 8) || '?' }));
    }
    const resolved: Record<string, string> = {};
    await Promise.all(unknown.map(async id => {
      try { const u = await api.getUser(id); if (u?.username) resolved[id] = u.username; } catch {}
    }));
    userMapRef.current = { ...userMapRef.current, ...resolved };
    return list.map(m => ({
      ...m, authorName: resolved[m.author_id] || userMapRef.current[m.author_id] || m.author_id?.slice(0, 8) || '?',
    }));
  };

  const fetchMessages = async (cid: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const raw  = await api.getMessages(cid, 50);
      const list = Array.isArray(raw) ? (raw as Message[]) : [];
      setMessages(await resolveAuthors(list));
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(() => {
    if (curChannelRef.current) fetchMessages(curChannelRef.current.id, true);
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (!curChannelRef.current) return;
    const rtId = replyToRef.current?.id;
    setReplyTo(null);
    setSending(true);

    const tempId = `tmp-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempId, author_id: api.userId ?? '',
      text, created_at: new Date().toISOString(),
      authorName: api.username ?? 'You',
      reply_to_id: rtId,
    }]);

    if (!isOnlineRef.current) {
      // Device is offline — queue for later upload. Keep optimistic message visible.
      await getOfflineSyncService().enqueue({
        recipient: '',
        content:   text,
        timestamp: Date.now(),
        channelId: curChannelRef.current.id,
      });
      setSending(false);
      return;
    }

    try { await api.sendMessage(curChannelRef.current.id, text, 0, rtId); }
    catch { setMessages(prev => prev.filter(m => m.id !== tempId)); }
    finally { setSending(false); }
  }, []);

  const handleSendTyping = useCallback(() => {
    const now = Date.now();
    if (now - typingThrottleRef.current < 3000) return;
    typingThrottleRef.current = now;
    if (curChannelRef.current) api.sendTyping(curChannelRef.current.id).catch(() => {});
  }, []);

  // ── Channel / server selection ────────────────────────────────────────────
  const selectChannel = useCallback(async (srv: Server, ch: Channel) => {
    if (ch.channel_type === 'voice') {
      setPanelOpen(false);
      Keyboard.dismiss();
      await joinVoice(ch);
      return;
    }
    curChannelRef.current = ch;
    setCurChannel(ch);
    setPanelOpen(false);
    Keyboard.dismiss();
    setLoadingMsgs(true);
    setMessages([]);
    setTypingUsers([]);
    setReplyTo(null);
    setChannelUnread(prev => { const next = { ...prev }; delete next[ch.id]; return next; });
    try { await fetchMessages(ch.id); } finally { setLoadingMsgs(false); }
  }, [joinVoice]);

  const selectServer = useCallback(async (srv: Server) => {
    if (voiceServiceRef.current) {
      try { await voiceServiceRef.current.leave(); } catch {}
      voiceServiceRef.current = null;
      setVoiceChannel(null);
      setVoiceUsers([]);
      setIsMuted(false);
      setIsSpeaker(false);
    }
    setCurServer(srv);
    setCurChannel(null);
    curChannelRef.current = null;
    setMessages([]);
    setPresence({});
    setChannelUnread({});
    setTypingUsers([]);
    setReplyTo(null);
    setPanelOpen(true);
    setLoadingCh(true);
    try {
      const [chs, cats] = await Promise.all([api.listChannels(srv.id), api.listCategories(srv.id)]);
      const chList: Channel[] = Array.isArray(chs) ? chs : [];
      setChannels(chList);
      setCategories(Array.isArray(cats) ? cats : []);
      connectWs(srv);
      const first = chList.find(c => c.channel_type === 'text');
      if (first) await selectChannel(srv, first);
    } finally {
      setLoadingCh(false);
    }
  }, [connectWs, selectChannel]);

  // ── Friend handlers ───────────────────────────────────────────────────────
  const loadFriends = useCallback(async () => {
    setLoadingFriends(true);
    try {
      const [f, i, o] = await Promise.all([
        api.listFriends(), api.listIncomingRequests(), api.listOutgoingRequests(),
      ]);
      setFriends((Array.isArray(f) ? f : []).filter(
        (x: any) => !x.status || x.status === 'accepted' || x.status === 'friend',
      ));
      setIncoming(Array.isArray(i) ? i : []);
      setOutgoing(Array.isArray(o) ? o : []);
    } catch {} finally { setLoadingFriends(false); }
  }, []);

  const doFriendSearch = useCallback(async () => {
    if (!friendSearchQ.trim()) return;
    try {
      const r = await api.searchUsers(friendSearchQ.trim());
      setFriendSearchR(Array.isArray(r) ? r.filter((u: any) => u.id !== api.userId) : []);
    } catch {}
  }, [friendSearchQ]);

  const sendFriendRequest = useCallback(async (uid: string) => {
    try {
      const r: any = await api.sendFriendRequest(uid);
      setFriendMsg(r.ok ? 'Request sent!' : 'Already sent or blocked.');
    } catch { setFriendMsg('Failed to send request.'); }
    setTimeout(() => setFriendMsg(''), 2500);
    loadFriends();
  }, [loadFriends]);

  const acceptFriend  = useCallback(async (id: string) => { await api.acceptFriend(id); loadFriends(); }, [loadFriends]);
  const declineFriend = useCallback(async (id: string) => { await api.declineFriend(id); loadFriends(); }, [loadFriends]);
  const removeFriend  = useCallback(async (id: string) => { await api.removeFriend(id); loadFriends(); }, [loadFriends]);

  // ── Voice toggles ─────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    voiceServiceRef.current?.setMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const next = !isSpeaker;
    setIsSpeaker(next);
    voiceServiceRef.current?.setSpeaker(next);
  }, [isSpeaker]);

  // ── DM badge ──────────────────────────────────────────────────────────────
  const clearDmUnread = useCallback((dmId: string) => {
    setDmUnreadCounts(prev => {
      if (!prev[dmId]) return prev;
      const next = { ...prev };
      delete next[dmId];
      return next;
    });
  }, []);

  // ── Proximity voice controls (used by the persistent overlay) ────────────
  const handleLeaveProxVoice = useCallback(() => {
    try { getWifiDirectService().leaveVoice(); } catch {}
    setProxVoiceCall(null);
  }, []);

  const handleToggleProxMute = useCallback(() => {
    setProxVoiceCall(prev => {
      if (!prev) return prev;
      const next = !prev.muted;
      try { getWifiDirectService().setMuted(next); } catch {}
      return { ...prev, muted: next };
    });
  }, []);

  const handleToggleProxSpeaker = useCallback(() => {
    setProxVoiceCall(prev => prev ? { ...prev, speakerOn: !prev.speakerOn } : prev);
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = useCallback(async () => {
    if (voiceServiceRef.current) {
      try { await voiceServiceRef.current.leave(); } catch {}
      voiceServiceRef.current = null;
    }
    wsRef.current?.destroy();
    wsRef.current = null;
    try { await pushCleanupRef.current?.(); } catch {}
    pushCleanupRef.current = null;
    await api.logout();
    onLogout();
    navigation.replace('Auth');
  }, [onLogout, navigation]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.LONG);
      return;
    }
    // iOS: SyncToast component handles its own fade-in/out and auto-dismiss.
    setToastMsg(msg);
  }, []);

  // ── Offline sync — connectivity watch ─────────────────────────────────────
  useEffect(() => {
    // Track online state via ref so handleSend can read it synchronously.
    const netUnsub = NetInfo.addEventListener(state => {
      isOnlineRef.current = state.isConnected === true && state.isInternetReachable !== false;
    });

    // OfflineSyncService: trigger upload + download when we come back online.
    const onSync = (result: SyncResult) => {
      const total = result.uploaded + result.downloaded;
      if (total === 0) return;
      showToast(`Synced ${total} message${total !== 1 ? 's' : ''} from offline session`);

      // Inject downloaded messages into the active channel view.
      const cid = curChannelRef.current?.id;
      if (cid && result.channelMessages[cid]?.length > 0) {
        setMessages(prev => {
          const seen   = new Set(prev.map(m => m.id));
          const fresh  = (result.channelMessages[cid] as any[])
            .filter(m => !seen.has(m.id) && !m._isStub)
            .map(m => ({
              id:          m.id,
              author_id:   m.author_id || '',
              text:        m.content_ciphertext || m.content || m.text || '',
              created_at:  m.created_at || new Date().toISOString(),
              authorName:  m.username || m.author_id?.slice(0, 8) || '?',
            }));
          if (fresh.length === 0) return prev;
          return [...prev, ...fresh].sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
      }
    };

    const syncUnsub = getOfflineSyncService().startConnectivityWatch(api, onSync);

    return () => {
      netUnsub();
      syncUnsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw  = await api.listServers();
        const list: Server[] = Array.isArray(raw) ? raw : [];
        setServers(list);
        if (list.length > 0) await selectServer(list[0]);
      } catch {
        setInitError('Could not connect. Check your network and server URL.');
      } finally {
        setLoadingInit(false);
      }
      initPushService()
        .then(cleanup => { pushCleanupRef.current = cleanup; })
        .catch(e => console.warn('[push] init failed:', e));
    })();
    return () => { wsRef.current?.destroy(); wsRef.current = null; };
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────
  const ctx: MainCtx = useMemo(() => ({
    servers, curServer, channels, categories, curChannel, messages, presence,
    panelOpen, loadingCh, loadingMsgs, refreshing, sending, wsStatus,
    voiceChannel, voiceUsers, isMuted, isSpeaker, voiceConnecting,
    dmWsEvent, dmUnreadCounts, serverMentionCount, dmScreenRef, openDmIdRef,
    friends, incoming, outgoing, friendTab, friendSearchQ, friendSearchR, friendMsg, loadingFriends,
    typingUsers, channelUnread, replyTo, setReplyTo, handleSendTyping,
    proximityActive, setProximityActive,
    proxVoiceCall, setProxVoiceCall, handleLeaveProxVoice, handleToggleProxMute, handleToggleProxSpeaker,
    selectServer, selectChannel, setPanelOpen, handleRefresh, handleSend,
    loadFriends, doFriendSearch, sendFriendRequest, acceptFriend, declineFriend, removeFriend,
    setFriendTab, setFriendSearchQ, handleLogout, clearDmUnread,
    toggleMute, toggleSpeaker, leaveVoice,
  }), [
    servers, curServer, channels, categories, curChannel, messages, presence,
    panelOpen, loadingCh, loadingMsgs, refreshing, sending, wsStatus,
    voiceChannel, voiceUsers, isMuted, isSpeaker, voiceConnecting,
    dmWsEvent, dmUnreadCounts, serverMentionCount,
    friends, incoming, outgoing, friendTab, friendSearchQ, friendSearchR, friendMsg, loadingFriends,
    typingUsers, channelUnread, replyTo, handleSendTyping,
    proximityActive, proxVoiceCall,
    handleLeaveProxVoice, handleToggleProxMute, handleToggleProxSpeaker,
    selectServer, selectChannel, handleRefresh, handleSend,
    loadFriends, doFriendSearch, sendFriendRequest, acceptFriend, declineFriend, removeFriend,
    setFriendSearchQ, handleLogout, clearDmUnread, toggleMute, toggleSpeaker, leaveVoice,
  ]);

  // ── Loading / error views ─────────────────────────────────────────────────
  if (loadingInit) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.fullCenter}>
          <ActivityIndicator size="large" color={C.ac} />
          <Text style={s.loadingTx}>Connecting…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (initError) {
    return (
      <SafeAreaView style={s.root}>
        <View style={s.fullCenter}>
          <Text style={s.errorTx}>{initError}</Text>
          <TouchableOpacity onPress={handleLogout} style={s.retryBtn}>
            <Text style={s.retryLabel}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <MainContext.Provider value={ctx}>
      <SafeAreaView style={s.root} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Tab.Navigator
            screenOptions={{ headerShown: false, lazy: false }}
            tabBar={props => <AppTabBar {...props} />}
          >
            <Tab.Screen name="Servers"  component={ServersTab} />
            <Tab.Screen name="DMs"      component={DmsTab} />
            <Tab.Screen name="Friends"  component={FriendsTab} />
            <Tab.Screen name="Nearby"   component={NearbyTab} />
            <Tab.Screen name="Settings" component={SettingsTab} />
          </Tab.Navigator>
        </KeyboardAvoidingView>

        {/* iOS sync toast — Android uses ToastAndroid above */}
        {Platform.OS === 'ios' && toastMsg !== '' && (
          <SyncToast message={toastMsg} onHide={() => setToastMsg('')} />
        )}
      </SafeAreaView>
    </MainContext.Provider>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: C.bg },
  body:       { flex: 1, flexDirection: 'row' },
  fullCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingTx:  { color: C.mt, fontSize: 14, marginTop: 12 },
  errorTx:    { color: C.err, fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  retryBtn:   { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.sf, borderRadius: 8, borderWidth: 1, borderColor: C.bd },
  retryLabel: { color: C.mt, fontSize: 13, fontWeight: '600' },

  // Servers tab — chat area
  chat:       { flex: 1, backgroundColor: C.bg },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.bd,
    backgroundColor: C.sf, gap: 8,
  },
  headerIconBtn:     { width: 32, alignItems: 'center' },
  headerIcon:        { fontSize: 18, color: C.mt },
  headerInfo:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerChIcon:      { fontSize: 14, color: C.mt },
  headerChName:      { fontSize: 15, fontWeight: '700', color: C.tx, flex: 1 },
  headerPlaceholder: { fontSize: 14, color: C.mt },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 10, backgroundColor: C.sf,
  },
  statusDot:   { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: 10, fontWeight: '600' },

  // Placeholders
  placeholderIcon: { fontSize: 48, marginBottom: 12, opacity: 0.3 },
  placeholderText: { fontSize: 16, color: C.mt, fontWeight: '600' },
  hintText:        { fontSize: 12, color: C.mt, textAlign: 'center', marginTop: 6, lineHeight: 18 },

  // Page header (Friends)
  pageHeader: { padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: C.sf },
  pageTitle:  { fontSize: 16, fontWeight: '700', color: C.tx },

  // Sub-tabs (Friends)
  subTabBar:        { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: C.sf },
  subTab:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  subTabActive:     { backgroundColor: `${C.ac}20` },
  subTabLabel:      { fontSize: 13, fontWeight: '600', color: C.mt },
  subTabLabelActive:{ color: C.ac },

  // List rows
  listRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 11, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bd,
  },
  rowName:       { fontSize: 14, fontWeight: '600', color: C.tx },
  rowBtn:        { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: C.sf, borderRadius: 6, borderWidth: 1, borderColor: C.bd },
  rowBtnAccept:  { backgroundColor: C.ac, borderColor: C.ac },
  rowBtnDanger:  { borderColor: `${C.err}40` },
  rowBtnTx:      { fontSize: 12, fontWeight: '600', color: C.ac },

  // Avatars
  avatar40:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatar40Tx: { fontSize: 15, fontWeight: '700', color: '#000' },

  // Add friend
  addTitle:     { fontSize: 16, fontWeight: '700', color: C.tx, marginBottom: 4 },
  addHint:      { fontSize: 13, color: C.mt, marginBottom: 14, lineHeight: 18 },
  addRow:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  addInput:     { flex: 1, backgroundColor: C.sf, borderWidth: 1, borderColor: C.bd, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, color: C.tx, fontSize: 14 },
  addBtn:       { backgroundColor: C.ac, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  addBtnTx:     { color: '#000', fontWeight: '700', fontSize: 14 },
  friendMsgBox: { backgroundColor: `${C.ac}15`, borderRadius: 8, padding: 10, marginBottom: 12 },
  friendMsgTx:  { color: C.ac, fontSize: 13 },
});

// ── Context menu styles ───────────────────────────────────────────────────────

const ctx = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.sf,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingBottom: 28, paddingTop: 6,
    borderTopWidth: 1, borderTopColor: C.bd,
  },
  option: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bd,
  },
  optionLast: { borderBottomWidth: 0 },
  optionTx:   { fontSize: 16, color: C.tx, fontWeight: '500' },
});
