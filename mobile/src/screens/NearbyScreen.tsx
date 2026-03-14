/**
 * NearbyScreen — BLE proximity discovery + peer-to-peer encrypted chat
 *               + Wi-Fi Direct proximity voice calls.
 *
 * Exported:
 *   ProxVoiceState — consumed by MainScreen's persistent overlay.
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { C } from '../../App';
import { api } from '../api/CitadelAPI';
import {
  getProximityService,
  NearbyUser,
  ProximityMessage,
  ProximityService,
} from '../services/ProximityService';
import { getWifiDirectService } from '../services/WifiDirectService';

// ── Voice call state (exported — used by MainScreen persistent overlay) ────────

export interface ProxVoiceState {
  role:             'host' | 'guest';
  hostIp:           string;
  participantCount: number;
  muted:            boolean;
  speakerOn:        boolean;
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  onSetProximityActive: (active: boolean) => void;
  proxVoiceCall:        ProxVoiceState | null;
  onVoiceCallChange:    (state: ProxVoiceState | null) => void;
};

// ── Pseudonymous name derivation ──────────────────────────────────────────────

const ADJECTIVES = [
  'Swift', 'Silent', 'Hidden', 'Bright', 'Dark', 'Bold',
  'Calm', 'Sharp', 'Quiet', 'Keen', 'Nimble', 'Lone',
  'Ancient', 'Mystic', 'Veiled', 'Distant', 'Feral', 'Wary',
  'Hollow', 'Radiant', 'Crimson', 'Amber', 'Cobalt', 'Jade',
];
const NOUNS = [
  'Fox', 'Hawk', 'Wolf', 'Bear', 'Raven', 'Lynx',
  'Owl', 'Deer', 'Crane', 'Viper', 'Heron', 'Puma',
  'Jackal', 'Falcon', 'Badger', 'Marten', 'Bison', 'Coyote',
  'Osprey', 'Ferret', 'Kestrel', 'Mink', 'Dingo', 'Ibis',
];
const AVATAR_COLORS = [
  '#7289da', '#f47fff', '#f9a825', '#4fc3f7',
  '#ef5350', '#66bb6a', '#00d2aa', '#ff7043',
];

function pseudoName(id: string): string {
  const a = parseInt(id.slice(0, 4), 16) % ADJECTIVES.length;
  const n = parseInt(id.slice(4, 8), 16) % NOUNS.length;
  return `${ADJECTIVES[a]} ${NOUNS[n]}`;
}

function pseudoColor(id: string): string {
  return AVATAR_COLORS[parseInt(id.slice(0, 4), 16) % AVATAR_COLORS.length];
}

// ── Signal / distance helpers ─────────────────────────────────────────────────

function signalColor(rssi: number): string {
  if (rssi > -60) return '#3ba55d';
  if (rssi > -75) return C.warn;
  return C.err;
}

function signalLabel(rssi: number): 'Strong' | 'Medium' | 'Weak' {
  if (rssi > -60) return 'Strong';
  if (rssi > -75) return 'Medium';
  return 'Weak';
}

function distanceLabel(rssi: number): string {
  if (rssi > -55) return '< 1 m';
  if (rssi > -65) return '~1–3 m';
  if (rssi > -75) return '~3–10 m';
  if (rssi > -85) return '~10–20 m';
  return '> 20 m';
}

// ── Local types ───────────────────────────────────────────────────────────────

interface LocalMessage {
  id:        string;
  text:      string;
  timestamp: number;
  isMine:    boolean;
}

interface VoiceParticipant {
  peerId: string;
  muted:  boolean;
}

// ── PulseRing ─────────────────────────────────────────────────────────────────

function PulseRing({ delay, size }: { delay: number; size: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0,    useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale   = anim.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.65] });
  const opacity = anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.75, 0.45, 0] });

  return (
    <Animated.View
      style={[
        r.ring,
        { width: size, height: size, borderRadius: size / 2 },
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

// ── RadarView ─────────────────────────────────────────────────────────────────

const RADAR_SIZE = 210;

function RadarView({ active, userCount }: { active: boolean; userCount: number }) {
  return (
    <View style={r.container}>
      <View style={[r.staticRing, { width: RADAR_SIZE * 0.33, height: RADAR_SIZE * 0.33, borderRadius: RADAR_SIZE * 0.165 }]} />
      <View style={[r.staticRing, { width: RADAR_SIZE * 0.66, height: RADAR_SIZE * 0.66, borderRadius: RADAR_SIZE * 0.33 }]} />
      <View style={[r.staticRing, { width: RADAR_SIZE,        height: RADAR_SIZE,        borderRadius: RADAR_SIZE / 2 }]} />
      <View style={r.crossH} />
      <View style={r.crossV} />
      {active && (
        <>
          <PulseRing delay={0}    size={RADAR_SIZE} />
          <PulseRing delay={800}  size={RADAR_SIZE} />
          <PulseRing delay={1600} size={RADAR_SIZE} />
        </>
      )}
      <View style={r.centerDot}>
        <Text style={r.centerIcon}>📱</Text>
      </View>
      <Text style={r.statusTx}>
        {active
          ? userCount === 0 ? 'Scanning…' : `${userCount} user${userCount !== 1 ? 's' : ''} nearby`
          : 'Proximity off'}
      </Text>
    </View>
  );
}

const r = StyleSheet.create({
  container: {
    width: RADAR_SIZE, height: RADAR_SIZE,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginVertical: 24,
  },
  ring:       { position: 'absolute', borderWidth: 1.5, borderColor: C.ac },
  staticRing: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, borderColor: `${C.ac}28` },
  crossH:     { position: 'absolute', width: RADAR_SIZE, height: StyleSheet.hairlineWidth, backgroundColor: `${C.ac}20` },
  crossV:     { position: 'absolute', width: StyleSheet.hairlineWidth, height: RADAR_SIZE, backgroundColor: `${C.ac}20` },
  centerDot: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: `${C.ac}22`, borderWidth: 1.5, borderColor: C.ac,
    alignItems: 'center', justifyContent: 'center',
  },
  centerIcon: { fontSize: 18 },
  statusTx:   { position: 'absolute', bottom: -22, fontSize: 12, color: C.mt, fontWeight: '500' },
});

// ── SignalBars ────────────────────────────────────────────────────────────────

function SignalBars({ rssi }: { rssi: number }) {
  const filled = rssi > -60 ? 3 : rssi > -75 ? 2 : 1;
  const color  = signalColor(rssi);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
      {[1, 2, 3].map(i => (
        <View
          key={i}
          style={{
            width: 4, height: 4 + i * 4, borderRadius: 1,
            backgroundColor: i <= filled ? color : C.bd,
          }}
        />
      ))}
    </View>
  );
}

// ── VoiceCallPanel ────────────────────────────────────────────────────────────

function VoiceCallPanel({
  call, participants,
}: {
  call:         ProxVoiceState;
  participants: VoiceParticipant[];
}) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={vc.panel}>
      <View style={vc.panelHeader}>
        <Animated.View style={[vc.activeDot, { opacity: pulseAnim }]} />
        <Text style={vc.panelTitle}>Voice Channel Active</Text>
        <Text style={vc.panelRole}>{call.role === 'host' ? 'Hosting' : 'Connected'}</Text>
      </View>

      {participants.length === 0 ? (
        <Text style={vc.waitingTx}>
          {call.role === 'host'
            ? 'Waiting for nearby users to join…'
            : 'Connecting to host…'}
        </Text>
      ) : (
        <View style={vc.participantList}>
          {participants.map(p => (
            <View key={p.peerId} style={vc.participantRow}>
              <View style={[vc.pAvatar, { backgroundColor: pseudoColor(p.peerId) }]}>
                <Text style={vc.pAvatarTx}>{pseudoName(p.peerId)[0]}</Text>
              </View>
              <Text style={vc.pName} numberOfLines={1}>{pseudoName(p.peerId)}</Text>
              <Text style={vc.pMuteIcon}>{p.muted ? '🔇' : '🎙'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const vc = StyleSheet.create({
  panel: {
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: `${C.ac}10`,
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: `${C.ac}30`,
  },
  panelHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  activeDot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3ba55d' },
  panelTitle:      { fontSize: 14, fontWeight: '700', color: C.tx, flex: 1 },
  panelRole:       { fontSize: 12, color: C.ac, fontWeight: '600' },
  participantList: { gap: 8 },
  participantRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pAvatar:         { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pAvatarTx:       { fontSize: 13, fontWeight: '700', color: '#000' },
  pName:           { flex: 1, fontSize: 13, color: C.tx },
  pMuteIcon:       { fontSize: 16 },
  waitingTx:       { fontSize: 12, color: C.mt, fontStyle: 'italic', textAlign: 'center', paddingVertical: 4 },
});

// ── UserRow ───────────────────────────────────────────────────────────────────

function UserRow({
  user, onPress, onJoinVoice, joiningVoice, voiceCallActive, onExchangeContact, exchangingContact,
}: {
  user:               NearbyUser;
  onPress:            () => void;
  onJoinVoice:        () => void;
  joiningVoice:       boolean;
  voiceCallActive:    boolean;
  onExchangeContact:  () => void;
  exchangingContact:  boolean;
}) {
  const name  = pseudoName(user.pseudoId);
  const color = pseudoColor(user.pseudoId);
  const label = signalLabel(user.rssi);
  const dist  = distanceLabel(user.rssi);

  return (
    <TouchableOpacity style={s.userRow} onPress={onPress} activeOpacity={0.75}>
      <View style={[s.avatar, { backgroundColor: color }]}>
        <Text style={s.avatarTx}>{name[0]}</Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.userName} numberOfLines={1}>{name}</Text>
        <Text style={s.userSub}>{dist} away · {user.pseudoId.slice(0, 6)}…</Text>
      </View>

      <View style={s.signalCol}>
        <SignalBars rssi={user.rssi} />
        <Text style={[s.signalLabel, { color: signalColor(user.rssi) }]}>{label}</Text>
      </View>

      {/* Exchange contact button */}
      <TouchableOpacity
        style={[s.voiceBtn, { marginRight: 4 }]}
        onPress={onExchangeContact}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
        disabled={exchangingContact}
      >
        {exchangingContact
          ? <ActivityIndicator size="small" color={C.ac} />
          : <Text style={s.voiceBtnIcon}>🤝</Text>
        }
      </TouchableOpacity>

      {/* Call button — hidden while in a voice call */}
      {!voiceCallActive && (
        <TouchableOpacity
          style={s.voiceBtn}
          onPress={onJoinVoice}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          {joiningVoice
            ? <ActivityIndicator size="small" color={C.ac} />
            : <Text style={s.voiceBtnIcon}>📞</Text>
          }
        </TouchableOpacity>
      )}

      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ── ProximityChatView ─────────────────────────────────────────────────────────

function ProximityChatView({
  user, service, messages, onSend, onBack,
}: {
  user:     NearbyUser;
  service:  ProximityService;
  messages: LocalMessage[];
  onSend:   (text: string) => Promise<void>;
  onBack:   () => void;
}) {
  const [inputText, setInputText]   = useState('');
  const [connecting, setConnecting] = useState(true);
  const [connError, setConnError]   = useState('');
  const [sending, setSending]       = useState(false);
  const flatRef = useRef<FlatList>(null);

  const name  = pseudoName(user.pseudoId);
  const color = pseudoColor(user.pseudoId);

  useEffect(() => {
    let cancelled = false;
    service.connectToPeer(user.deviceId).then(result => {
      if (cancelled) return;
      if (result.ok) { setConnecting(false); }
      else { setConnecting(false); setConnError(result.reason ?? 'Connection failed'); }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.deviceId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 60);
    }
  }, [messages.length]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || sending) return;
    setInputText('');
    setSending(true);
    await onSend(text);
    setSending(false);
  };

  const retry = () => {
    setConnError('');
    setConnecting(true);
    service.connectToPeer(user.deviceId).then(result => {
      setConnecting(false);
      if (!result.ok) setConnError(result.reason ?? 'Connection failed');
    });
  };

  const renderMsg = ({ item }: { item: LocalMessage }) => (
    <View style={[chat.bubble, item.isMine ? chat.bubbleMine : chat.bubbleThem]}>
      <Text style={[chat.bubbleTx, item.isMine && chat.bubbleTxMine]} selectable>
        {item.text}
      </Text>
      <Text style={[chat.time, item.isMine && chat.timeMine]}>
        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={chat.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={chat.backBtn}>‹</Text>
        </TouchableOpacity>
        <View style={[chat.headerAvatar, { backgroundColor: color }]}>
          <Text style={chat.headerAvatarTx}>{name[0]}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={chat.headerName} numberOfLines={1}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <SignalBars rssi={user.rssi} />
            <Text style={chat.headerSub}>{distanceLabel(user.rssi)}</Text>
          </View>
        </View>
        <View style={chat.bleBadge}>
          <Text style={chat.bleBadgeTx}>BLE</Text>
        </View>
      </View>

      {connecting ? (
        <View style={s.center}>
          <ActivityIndicator color={C.ac} size="large" />
          <Text style={s.centerTx}>Connecting via Bluetooth…</Text>
        </View>
      ) : connError ? (
        <View style={s.center}>
          <Text style={s.errorIcon}>📡</Text>
          <Text style={s.errorTx}>{connError}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={retry}>
            <Text style={s.retryTx}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={m => m.id}
            contentContainerStyle={chat.listContent}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyIcon}>🔒</Text>
                <Text style={s.centerTx}>End-to-end encrypted via Bluetooth</Text>
                <Text style={s.centerSub}>Messages never touch the internet</Text>
              </View>
            }
            renderItem={renderMsg}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          />
          <View style={chat.inputRow}>
            <TextInput
              style={chat.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder={`Message ${name}…`}
              placeholderTextColor={C.mt}
              multiline
              maxLength={2000}
              blurOnSubmit={false}
              returnKeyType="default"
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
              activeOpacity={0.75}
              style={[chat.sendBtn, inputText.trim() && !sending && chat.sendBtnActive]}
            >
              {sending
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={[chat.sendIcon, !inputText.trim() && chat.sendIconDim]}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const chat = StyleSheet.create({
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: C.sf, gap: 10 },
  backBtn:        { fontSize: 28, color: C.ac, lineHeight: 32, paddingRight: 4 },
  headerAvatar:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerAvatarTx: { fontSize: 14, fontWeight: '700', color: '#000' },
  headerName:     { fontSize: 14, fontWeight: '700', color: C.tx },
  headerSub:      { fontSize: 11, color: C.mt },
  bleBadge:       { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: `${C.ac}18`, borderWidth: 1, borderColor: `${C.ac}40` },
  bleBadgeTx:     { fontSize: 10, fontWeight: '700', color: C.ac, letterSpacing: 0.5 },
  listContent:    { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 6 },
  bubble:         { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18 },
  bubbleThem:     { backgroundColor: C.sf2, borderBottomLeftRadius: 4, alignSelf: 'flex-start' },
  bubbleMine:     { backgroundColor: C.ac,  borderBottomRightRadius: 4, alignSelf: 'flex-end' },
  bubbleTx:       { fontSize: 14, color: C.tx, lineHeight: 20 },
  bubbleTxMine:   { color: '#000' },
  time:           { fontSize: 10, color: C.mt, alignSelf: 'flex-end', marginTop: 3 },
  timeMine:       { color: 'rgba(0,0,0,0.4)' },
  inputRow:       { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.bd, backgroundColor: C.sf, gap: 8 },
  input:          { flex: 1, backgroundColor: C.sf2, borderWidth: 1, borderColor: C.bd, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, color: C.tx, fontSize: 14, maxHeight: 120, lineHeight: 20 },
  sendBtn:        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sf2, borderWidth: 1, borderColor: C.bd, marginBottom: 1 },
  sendBtnActive:  { backgroundColor: C.ac, borderColor: C.ac },
  sendIcon:       { fontSize: 20, fontWeight: '700', color: '#000', lineHeight: 24 },
  sendIconDim:    { color: C.mt },
});

// ── NearbyScreen ──────────────────────────────────────────────────────────────

export default function NearbyScreen({ onSetProximityActive, proxVoiceCall, onVoiceCallChange }: Props) {

  // ── Proximity state ───────────────────────────────────────────────────────
  const [enabled, setEnabled]           = useState(false);
  const [status, setStatus]             = useState<'idle' | 'starting' | 'running' | 'error'>('idle');
  const [errorMsg, setErrorMsg]         = useState('');
  const [nearbyUsers, setNearbyUsers]   = useState<NearbyUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<NearbyUser | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, LocalMessage[]>>({});

  // ── Voice state ───────────────────────────────────────────────────────────
  const [voiceStatus, setVoiceStatus]             = useState<'idle' | 'starting' | 'error'>('idle');
  const [voiceError, setVoiceError]               = useState('');
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [joiningUserId, setJoiningUserId]         = useState<string | null>(null);
  const [exchangingContactId, setExchangingContactId] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const serviceRef        = useRef<ProximityService | null>(null);
  const msgUnsubRef       = useRef<(() => void) | null>(null);
  const wifiDirectRef     = useRef<ReturnType<typeof getWifiDirectService> | null>(null);
  const voiceListenersRef = useRef<Array<() => void>>([]);
  // Stable ref so voice event handlers can read current proxVoiceCall
  const proxVoiceCallRef  = useRef(proxVoiceCall);
  useEffect(() => { proxVoiceCallRef.current = proxVoiceCall; }, [proxVoiceCall]);

  // ── When overlay's Leave clears call, reset local voice state ─────────────
  useEffect(() => {
    if (!proxVoiceCall) {
      setVoiceStatus('idle');
      setVoiceParticipants([]);
      setVoiceError('');
    }
  }, [proxVoiceCall]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      voiceListenersRef.current.forEach(fn => fn());
      msgUnsubRef.current?.();
      serviceRef.current?.stopDiscovery();
      // Voice call intentionally persists after unmount — overlay handles leave.
    };
  }, []);

  // ── Android back — close chat before leaving tab ──────────────────────────
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedUser) { setSelectedUser(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [selectedUser]));

  // ── Wi-Fi Direct event wiring ─────────────────────────────────────────────
  const setupVoiceEvents = useCallback((wds: ReturnType<typeof getWifiDirectService>) => {
    voiceListenersRef.current.forEach(fn => fn());
    voiceListenersRef.current = [];

    const onPeerJoined = ({ peerId }: { peerId: string }) => {
      setVoiceParticipants(prev => {
        const next = prev.some(x => x.peerId === peerId)
          ? prev
          : [...prev, { peerId, muted: false }];
        const cur = proxVoiceCallRef.current;
        if (cur) onVoiceCallChange({ ...cur, participantCount: next.length + 1 });
        return next;
      });
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      setVoiceParticipants(prev => {
        const next = prev.filter(x => x.peerId !== peerId);
        const cur = proxVoiceCallRef.current;
        if (cur) onVoiceCallChange({ ...cur, participantCount: Math.max(1, next.length + 1) });
        return next;
      });
    };

    const onDisconnected = () => {
      onVoiceCallChange(null);
    };

    wds.on('voice_peer_joined', onPeerJoined);
    wds.on('voice_peer_left',   onPeerLeft);
    wds.on('voice_disconnected', onDisconnected);

    voiceListenersRef.current = [
      () => wds.removeListener('voice_peer_joined',  onPeerJoined),
      () => wds.removeListener('voice_peer_left',    onPeerLeft),
      () => wds.removeListener('voice_disconnected', onDisconnected),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onVoiceCallChange]);

  // ── Start Voice Channel (this device becomes Wi-Fi Direct host / GO) ──────
  const handleStartVoice = useCallback(async () => {
    setVoiceStatus('starting');
    setVoiceError('');
    try {
      const wds = getWifiDirectService();
      wifiDirectRef.current = wds;
      const ok = await wds.initialize();
      if (!ok) throw new Error('Wi-Fi Direct is not available on this device');
      setupVoiceEvents(wds);
      await wds.startVoiceHost();
      // Group Owner always gets 192.168.49.1 in Wi-Fi Direct
      onVoiceCallChange({ role: 'host', hostIp: '192.168.49.1', participantCount: 1, muted: false, speakerOn: true });
      setVoiceStatus('idle');
    } catch (e: any) {
      setVoiceError(e.message ?? 'Failed to start voice channel');
      setVoiceStatus('error');
    }
  }, [setupVoiceEvents, onVoiceCallChange]);

  // ── Join another user's voice channel ─────────────────────────────────────
  const handleJoinVoice = useCallback(async (user: NearbyUser) => {
    setJoiningUserId(user.pseudoId);
    setVoiceError('');
    try {
      const wds = getWifiDirectService();
      wifiDirectRef.current = wds;
      const ok = await wds.initialize();
      if (!ok) throw new Error('Wi-Fi Direct is not available on this device');
      setupVoiceEvents(wds);
      // On Android, BLE deviceId == Wi-Fi MAC; Group Owner is always 192.168.49.1
      await wds.connectToPeer(user.deviceId);
      await wds.joinVoice('192.168.49.1');
      onVoiceCallChange({ role: 'guest', hostIp: '192.168.49.1', participantCount: 1, muted: false, speakerOn: true });
    } catch (e: any) {
      setVoiceError(e.message ?? 'Failed to join voice channel');
    } finally {
      setJoiningUserId(null);
    }
  }, [setupVoiceEvents, onVoiceCallChange]);

  // ── Exchange contact over BLE ────────────────────────────────────────────
  const handleExchangeContact = useCallback(async (user: NearbyUser) => {
    if (!serviceRef.current) return;
    setExchangingContactId(user.pseudoId);
    try {
      await serviceRef.current.exchangeContact(user.deviceId);
    } catch (e: any) {
      // Silently fail — contact exchange is best-effort
    } finally {
      setExchangingContactId(null);
    }
  }, []);

  // ── Toggle proximity mode ─────────────────────────────────────────────────
  const handleToggle = async (on: boolean) => {
    if (on === enabled) return;

    if (!on) {
      msgUnsubRef.current?.();
      msgUnsubRef.current = null;
      await serviceRef.current?.stopDiscovery();
      setEnabled(false);
      setStatus('idle');
      setNearbyUsers([]);
      setSelectedUser(null);
      onSetProximityActive(false);
      return;
    }

    if (!api.userId) {
      setErrorMsg('Sign in to use Proximity Mode.');
      setStatus('error');
      return;
    }

    setEnabled(true);
    setStatus('starting');
    onSetProximityActive(true);

    const svc = getProximityService(api.userId);
    serviceRef.current = svc;

    svc.on('user_discovered', user => {
      setNearbyUsers(prev =>
        prev.some(u => u.pseudoId === user.pseudoId) ? prev : [...prev, user],
      );
    });
    svc.on('user_lost', ({ pseudoId }) => {
      setNearbyUsers(prev => prev.filter(u => u.pseudoId !== pseudoId));
    });

    msgUnsubRef.current?.();
    msgUnsubRef.current = svc.onProximityMessage((msg: ProximityMessage) => {
      const sender   = svc.getNearbyUsers().find(u => u.pseudoId === msg.senderId);
      const deviceId = sender?.deviceId ?? msg.senderId;
      const local: LocalMessage = {
        id: msg.id, text: msg.plaintext, timestamp: msg.timestamp, isMine: false,
      };
      setChatMessages(prev => ({
        ...prev,
        [deviceId]: [...(prev[deviceId] ?? []), local],
      }));
    });

    const result = await svc.startDiscovery();
    if (!result.ok) {
      setEnabled(false);
      setStatus('error');
      setErrorMsg(result.reason ?? 'Failed to start Bluetooth scanning.');
      onSetProximityActive(false);
      return;
    }

    setStatus('running');
  };

  // ── Send BLE message ──────────────────────────────────────────────────────
  const handleSend = useCallback(async (text: string) => {
    if (!selectedUser || !serviceRef.current) return;
    const result = await serviceRef.current.sendProximityMessage(selectedUser.deviceId, text);
    if (result.ok) {
      const local: LocalMessage = {
        id: `mine-${Date.now()}`, text, timestamp: Date.now(), isMine: true,
      };
      setChatMessages(prev => ({
        ...prev,
        [selectedUser.deviceId]: [...(prev[selectedUser.deviceId] ?? []), local],
      }));
    }
  }, [selectedUser]);

  // ── Render: chat sub-screen ───────────────────────────────────────────────
  if (selectedUser && serviceRef.current) {
    return (
      <ProximityChatView
        user={selectedUser}
        service={serviceRef.current}
        messages={chatMessages[selectedUser.deviceId] ?? []}
        onSend={handleSend}
        onBack={() => setSelectedUser(null)}
      />
    );
  }

  // ── Render: main screen ───────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Nearby</Text>
          <Text style={s.subtitle}>Bluetooth proximity discovery</Text>
        </View>
        <View style={s.toggleRow}>
          {status === 'starting' && <ActivityIndicator size="small" color={C.ac} style={{ marginRight: 8 }} />}
          <Switch
            value={enabled}
            onValueChange={handleToggle}
            trackColor={{ false: C.bd, true: `${C.ac}60` }}
            thumbColor={enabled ? C.ac : C.mt}
            disabled={status === 'starting'}
          />
        </View>
      </View>

      {/* Body */}
      {!enabled ? (
        /* ── Off state ─────────────────────────────────────────────────── */
        <View style={s.offBody}>
          <RadarView active={false} userCount={0} />
          <View style={s.explainCard}>
            <Text style={s.explainIcon}>📡</Text>
            <Text style={s.explainTitle}>Proximity Mode</Text>
            <Text style={s.explainBody}>
              Enable Proximity Mode to discover and message nearby Discreet users
              without internet.{'\n\n'}
              Your identity remains pseudonymous — a new random name is assigned every
              hour. No location data is shared.
            </Text>
          </View>
          {status === 'error' && (
            <View style={s.errorBanner}>
              <Text style={s.errorBannerTx}>⚠ {errorMsg}</Text>
            </View>
          )}
        </View>
      ) : (
        /* ── On state ──────────────────────────────────────────────────── */
        <FlatList
          data={nearbyUsers}
          keyExtractor={u => u.pseudoId}
          ListHeaderComponent={
            <View>
              <RadarView active={status === 'running'} userCount={nearbyUsers.length} />

              {/* In-call panel — shows participants while voice is active */}
              {proxVoiceCall && (
                <VoiceCallPanel call={proxVoiceCall} participants={voiceParticipants} />
              )}

              {nearbyUsers.length === 0 && status === 'running' && !proxVoiceCall && (
                <View style={s.scanningCard}>
                  <ActivityIndicator size="small" color={C.ac} style={{ marginBottom: 8 }} />
                  <Text style={s.scanningTx}>Looking for nearby devices…</Text>
                  <Text style={s.scanningSub}>
                    Other users must also have Proximity Mode enabled.
                  </Text>
                </View>
              )}

              {nearbyUsers.length > 0 && (
                <Text style={s.sectionLabel}>NEARBY USERS</Text>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <UserRow
              user={item}
              onPress={() => setSelectedUser(item)}
              onJoinVoice={() => handleJoinVoice(item)}
              joiningVoice={joiningUserId === item.pseudoId}
              voiceCallActive={proxVoiceCall !== null}
              onExchangeContact={() => handleExchangeContact(item)}
              exchangingContact={exchangingContactId === item.pseudoId}
            />
          )}
          ListFooterComponent={
            <View>
              {/* Voice error banner */}
              {voiceError !== '' && (
                <View style={s.errorBanner}>
                  <Text style={s.errorBannerTx}>⚠ {voiceError}</Text>
                </View>
              )}

              {/* Start Voice Channel — only when users are nearby and not in a call */}
              {nearbyUsers.length > 0 && !proxVoiceCall && (
                <TouchableOpacity
                  style={[s.voiceStartBtn, voiceStatus === 'starting' && s.voiceStartBtnDisabled]}
                  onPress={handleStartVoice}
                  disabled={voiceStatus === 'starting'}
                  activeOpacity={0.8}
                >
                  {voiceStatus === 'starting'
                    ? <ActivityIndicator size="small" color={C.ac} style={{ marginRight: 8 }} />
                    : <Text style={s.voiceStartIcon}>🎙</Text>
                  }
                  <Text style={s.voiceStartTx}>
                    {voiceStatus === 'starting' ? 'Starting…' : 'Start Voice Channel'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Bottom padding so content doesn't sit behind persistent overlay */}
              <View style={{ height: 72 }} />
            </View>
          }
          contentContainerStyle={{ paddingBottom: 0 }}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.bd, backgroundColor: C.sf,
  },
  title:     { fontSize: 17, fontWeight: '700', color: C.tx },
  subtitle:  { fontSize: 11, color: C.mt, marginTop: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },

  // Off state
  offBody: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  explainCard: {
    backgroundColor: C.sf, borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: C.bd, alignItems: 'center', marginTop: 20, width: '100%',
  },
  explainIcon:  { fontSize: 36, marginBottom: 10 },
  explainTitle: { fontSize: 15, fontWeight: '700', color: C.tx, marginBottom: 8 },
  explainBody:  { fontSize: 13, color: C.mt, textAlign: 'center', lineHeight: 20 },

  errorBanner: {
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: `${C.err}18`, borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  errorBannerTx: { color: C.err, fontSize: 13, lineHeight: 18 },

  // On state
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: C.mt, letterSpacing: 0.8,
    paddingHorizontal: 16, paddingBottom: 4, paddingTop: 8,
  },
  scanningCard: {
    marginHorizontal: 20, marginTop: 4, backgroundColor: C.sf,
    borderRadius: 12, padding: 20, borderWidth: 1, borderColor: C.bd, alignItems: 'center',
  },
  scanningTx:  { fontSize: 14, fontWeight: '600', color: C.tx, marginBottom: 4 },
  scanningSub: { fontSize: 12, color: C.mt, textAlign: 'center', lineHeight: 18 },

  // User list rows
  userRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.bd, gap: 12,
  },
  avatar:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarTx:    { fontSize: 18, fontWeight: '700', color: '#000' },
  userName:    { fontSize: 15, fontWeight: '600', color: C.tx },
  userSub:     { fontSize: 12, color: C.mt, marginTop: 2 },
  signalCol:   { alignItems: 'flex-end', gap: 3 },
  signalLabel: { fontSize: 10, fontWeight: '600' },
  chevron:     { fontSize: 20, color: C.mt, marginLeft: 2 },

  // Per-row call button
  voiceBtn:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: `${C.ac}15`, borderWidth: 1, borderColor: `${C.ac}30` },
  voiceBtnIcon: { fontSize: 16 },

  // Start Voice Channel footer button
  voiceStartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 16, marginTop: 16,
    backgroundColor: `${C.ac}15`, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 20,
    borderWidth: 1, borderColor: `${C.ac}40`, gap: 8,
  },
  voiceStartBtnDisabled: { opacity: 0.5 },
  voiceStartIcon: { fontSize: 20 },
  voiceStartTx:   { fontSize: 15, fontWeight: '700', color: C.ac },

  // Shared
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTx:  { fontSize: 14, color: C.mt, marginTop: 12, textAlign: 'center' },
  centerSub: { fontSize: 12, color: C.mt, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  emptyIcon: { fontSize: 40, marginBottom: 8, opacity: 0.4 },
  errorIcon: { fontSize: 40, marginBottom: 12 },
  errorTx:   { fontSize: 14, color: C.err, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  retryBtn:  { paddingHorizontal: 24, paddingVertical: 10, backgroundColor: C.sf, borderRadius: 8, borderWidth: 1, borderColor: C.bd },
  retryTx:   { fontSize: 14, fontWeight: '600', color: C.ac },
});
