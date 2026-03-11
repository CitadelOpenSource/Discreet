/**
 * SettingsScreen — Full user settings for the Discreet mobile app.
 *
 * Sections:
 *   Profile      — avatar (camera/gallery), display name, online status
 *   Notifications — push on/off, mention-only mode, DND schedule
 *   Appearance   — font size slider (14–20 px), compact mode toggle
 *   Account      — change password, 2FA, export data (GDPR), delete account
 *   About        — version, server URL, encryption status
 *
 * Local settings (appearance, notifications) are persisted in AsyncStorage.
 * Profile/account changes go through the API.
 *
 * Avatar picker: requires `react-native-image-picker` (optional dep).
 *   Install: yarn add react-native-image-picker
 *   Fallback: shows an alert if library is not installed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { C } from '../../App';
import { api, SERVER_URL } from '../api/CitadelAPI';
import { getOfflineSyncService } from '../services/OfflineSyncService';

// ── Storage keys ─────────────────────────────────────────────────────────────

const SK = {
  fontSize:        'd_s_font_size',
  compact:         'd_s_compact',
  pushEnabled:     'd_s_push_enabled',
  mentionOnly:     'd_s_mention_only',
  dndStart:        'd_s_dnd_start',
  dndEnd:          'd_s_dnd_end',
  dndEnabled:      'd_s_dnd_enabled',
  // Proximity & Offline
  proxEnabled:     'd_s_prox_enabled',
  bleRange:        'd_s_ble_range',
  proxAutoOffline: 'd_s_prox_auto_offline',
  proxStealth:     'd_s_prox_stealth',
  proxNearbyCount: 'd_s_prox_nearby_count',
  proxNotifs:      'd_s_prox_notifications',
  proxWifiVoice:   'd_s_prox_wifi_voice',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible';

type BleRange = 'low' | 'balanced' | 'high';

type LocalSettings = {
  fontSize:        number;
  compact:         boolean;
  pushEnabled:     boolean;
  mentionOnly:     boolean;
  dndEnabled:      boolean;
  dndStart:        string; // HH:MM
  dndEnd:          string; // HH:MM
  // Proximity & Offline
  proxEnabled:     boolean;
  bleRange:        BleRange;
  proxAutoOffline: boolean;
  proxStealth:     boolean;
  proxNearbyCount: boolean;
  proxNotifs:      boolean;
  proxWifiVoice:   boolean;
};

const BLE_RANGE_OPTIONS: { id: BleRange; label: string; dist: string }[] = [
  { id: 'low',      label: 'Low Power',  dist: '~30m'  },
  { id: 'balanced', label: 'Balanced',   dist: '~60m'  },
  { id: 'high',     label: 'High Power', dist: '~100m' },
];

type Props = {
  onLogout: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function validateTime(t: string): boolean { return /^\d{2}:\d{2}$/.test(t); }

const STATUS_OPTIONS: { id: UserStatus; label: string; color: string; emoji: string }[] = [
  { id: 'online',    label: 'Online',    color: '#3ba55d', emoji: '🟢' },
  { id: 'idle',      label: 'Idle',      color: '#faa61a', emoji: '🟡' },
  { id: 'dnd',       label: 'Do Not Disturb', color: '#ed4245', emoji: '🔴' },
  { id: 'invisible', label: 'Invisible', color: '#747f8d', emoji: '⬤'  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionHeader}>{title}</Text>;
}

function SettingRow({
  icon, label, hint, right, danger = false, onPress,
}: {
  icon: string; label: string; hint?: string;
  right?: React.ReactNode; danger?: boolean; onPress?: () => void;
}) {
  const inner = (
    <View style={s.row}>
      <Text style={s.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, danger && { color: C.err }]}>{label}</Text>
        {hint ? <Text style={s.rowHint}>{hint}</Text> : null}
      </View>
      {right}
    </View>
  );
  if (onPress) return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>
  );
  return inner;
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={[s.tag, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
      <Text style={[s.tagText, { color }]}>{label}</Text>
    </View>
  );
}

// ── Font-size slider (no external library) ────────────────────────────────────

const FONT_MIN = 14;
const FONT_MAX = 20;
const SLIDER_W = 200;

function FontSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = (value - FONT_MIN) / (FONT_MAX - FONT_MIN);
  const thumbX = pct * SLIDER_W;
  const startX = useRef(0);
  const startVal = useRef(value);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (_, gs) => {
      startX.current = gs.x0 - thumbX;
      startVal.current = value;
    },
    onPanResponderMove: (_, gs) => {
      const raw = (gs.moveX - startX.current) / SLIDER_W;
      const clamped = Math.max(0, Math.min(1, raw));
      const stepped = Math.round(FONT_MIN + clamped * (FONT_MAX - FONT_MIN));
      onChange(stepped);
    },
  }), [value, thumbX, onChange]);

  return (
    <View style={s.sliderWrap}>
      <Text style={[s.sliderSample, { fontSize: FONT_MIN }]}>A</Text>
      <View style={{ width: SLIDER_W, justifyContent: 'center' }}>
        {/* Track */}
        <View style={s.sliderTrack}>
          <View style={[s.sliderFill, { width: thumbX }]} />
        </View>
        {/* Thumb */}
        <View
          style={[s.sliderThumb, { left: thumbX - 11 }]}
          {...pan.panHandlers}
        />
      </View>
      <Text style={[s.sliderSample, { fontSize: FONT_MAX }]}>A</Text>
      <Text style={s.sliderVal}>{value}px</Text>
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsScreen({ onLogout }: Props) {

  // Profile
  const [displayName, setDisplayName]   = useState(api.username ?? '');
  const [displayNameEdit, setDisplayNameEdit] = useState('');
  const [editingName, setEditingName]   = useState(false);
  const [avatarUri, setAvatarUri]       = useState<string | null>(null);
  const [status, setStatus]             = useState<UserStatus>('online');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg]     = useState('');

  // Password change
  const [changingPw, setChangingPw]     = useState(false);
  const [oldPw, setOldPw]               = useState('');
  const [newPw, setNewPw]               = useState('');
  const [confirmPw, setConfirmPw]       = useState('');
  const [pwLoading, setPwLoading]       = useState(false);
  const [pwMsg, setPwMsg]               = useState('');

  // 2FA
  const [show2fa, setShow2fa]           = useState(false);
  const [tfaQr, setTfaQr]               = useState<string | null>(null);
  const [tfaCode, setTfaCode]           = useState('');
  const [tfaLoading, setTfaLoading]     = useState(false);
  const [tfaMsg, setTfaMsg]             = useState('');
  const [tfaEnabled, setTfaEnabled]     = useState(false);

  // Local settings
  const [ls, setLs] = useState<LocalSettings>({
    fontSize:        16,
    compact:         false,
    pushEnabled:     true,
    mentionOnly:     false,
    dndEnabled:      false,
    dndStart:        '22:00',
    dndEnd:          '07:00',
    proxEnabled:     false,
    bleRange:        'balanced',
    proxAutoOffline: false,
    proxStealth:     false,
    proxNearbyCount: true,
    proxNotifs:      true,
    proxWifiVoice:   true,
  });
  const [savingLs, setSavingLs] = useState(false);

  // Proximity outbox
  const [outboxCount, setOutboxCount]   = useState(0);
  const [clearingQueue, setClearingQueue] = useState(false);

  // Delete account
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteConfirmPw, setDeleteConfirmPw] = useState('');
  const [deleteLoading, setDeleteLoading]     = useState(false);

  // ── Load on mount ─────────────────────────────────────────────────────────

  useEffect(() => {
    loadProfile();
    loadLocalSettings();
    loadOutboxCount();
  }, []);

  const loadProfile = async () => {
    try {
      const me = await api.getMe();
      if (me) {
        setDisplayName(me.display_name || me.username || api.username || '');
        setStatus(me.status ?? 'online');
        setTfaEnabled(!!me.totp_enabled);
        if (me.avatar_url) setAvatarUri(me.avatar_url);
      }
    } catch {}
  };

  const loadLocalSettings = async () => {
    try {
      const vals = await AsyncStorage.multiGet(Object.values(SK));
      const m: Record<string, string | null> = {};
      vals.forEach(([k, v]) => { m[k] = v; });
      setLs(prev => ({
        ...prev,
        fontSize:        m[SK.fontSize]        != null ? parseInt(m[SK.fontSize]!, 10) : prev.fontSize,
        compact:         m[SK.compact]         === 'true',
        pushEnabled:     m[SK.pushEnabled]     !== 'false', // default true
        mentionOnly:     m[SK.mentionOnly]     === 'true',
        dndEnabled:      m[SK.dndEnabled]      === 'true',
        dndStart:        m[SK.dndStart]        ?? prev.dndStart,
        dndEnd:          m[SK.dndEnd]          ?? prev.dndEnd,
        proxEnabled:     m[SK.proxEnabled]     === 'true',
        bleRange:        (m[SK.bleRange]       as BleRange) ?? prev.bleRange,
        proxAutoOffline: m[SK.proxAutoOffline] === 'true',
        proxStealth:     m[SK.proxStealth]     === 'true',
        proxNearbyCount: m[SK.proxNearbyCount] !== 'false', // default true
        proxNotifs:      m[SK.proxNotifs]      !== 'false', // default true
        proxWifiVoice:   m[SK.proxWifiVoice]   !== 'false', // default true
      }));
    } catch {}
  };

  const loadOutboxCount = async () => {
    try {
      const queue = await getOfflineSyncService().getOutbox();
      setOutboxCount(queue.length);
    } catch {}
  };

  const clearQueue = () => {
    Alert.alert(
      'Clear Offline Queue',
      outboxCount === 0
        ? 'The offline message queue is already empty.'
        : `Clear ${outboxCount} queued message${outboxCount !== 1 ? 's' : ''}? They will not be sent.`,
      outboxCount === 0
        ? [{ text: 'OK' }]
        : [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear',
              style: 'destructive',
              onPress: async () => {
                setClearingQueue(true);
                await getOfflineSyncService().clearOutbox();
                setOutboxCount(0);
                setClearingQueue(false);
              },
            },
          ],
    );
  };

  // ── Save helpers ──────────────────────────────────────────────────────────

  const saveLocalSetting = useCallback(async (key: string, value: string) => {
    setSavingLs(true);
    await AsyncStorage.setItem(key, value).catch(() => {});
    setSavingLs(false);
  }, []);

  const updateLs = useCallback(<K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) => {
    setLs(prev => ({ ...prev, [key]: value }));
    const skKey = SK[key as keyof typeof SK];
    if (skKey) saveLocalSetting(skKey, String(value));
  }, [saveLocalSetting]);

  // ── Profile save ──────────────────────────────────────────────────────────

  const saveDisplayName = async () => {
    const name = displayNameEdit.trim();
    if (!name) return;
    setProfileLoading(true);
    setProfileMsg('');
    try {
      const res = await api.updateProfile({ display_name: name });
      if (res.ok) {
        setDisplayName(name);
        setEditingName(false);
        api.username = name;
        flashMsg(setProfileMsg, 'Display name updated.', true);
      } else {
        flashMsg(setProfileMsg, 'Failed to update name.', false);
      }
    } catch {
      flashMsg(setProfileMsg, 'Network error.', false);
    } finally {
      setProfileLoading(false);
    }
  };

  const saveStatus = async (st: UserStatus) => {
    setStatus(st);
    try {
      await api.updateProfile({ status: st });
    } catch {}
  };

  // ── Avatar picker ─────────────────────────────────────────────────────────

  const pickAvatar = () => {
    // react-native-image-picker (optional — install separately)
    let ImagePicker: any;
    try {
      ImagePicker = require('react-native-image-picker');
    } catch {
      Alert.alert(
        'Image Picker Not Installed',
        'Add react-native-image-picker to your project:\n  yarn add react-native-image-picker',
      );
      return;
    }

    Alert.alert('Change Avatar', 'Choose a source', [
      {
        text: 'Camera',
        onPress: () => ImagePicker.launchCamera(
          { mediaType: 'photo', maxWidth: 512, maxHeight: 512, quality: 0.8 },
          (r: any) => handleImageResponse(r),
        ),
      },
      {
        text: 'Photo Library',
        onPress: () => ImagePicker.launchImageLibrary(
          { mediaType: 'photo', maxWidth: 512, maxHeight: 512, quality: 0.8 },
          (r: any) => handleImageResponse(r),
        ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleImageResponse = async (response: any) => {
    if (response.didCancel || response.errorCode) return;
    const asset = response.assets?.[0];
    if (!asset?.uri) return;
    setAvatarUri(asset.uri);
    // Upload as base64
    try {
      const base64 = asset.base64;
      if (base64) {
        await api.updateProfile({ avatar_base64: base64, avatar_mime: asset.type ?? 'image/jpeg' });
      }
    } catch {}
  };

  // ── Password change ───────────────────────────────────────────────────────

  const submitPasswordChange = async () => {
    if (!oldPw || !newPw || !confirmPw) {
      flashMsg(setPwMsg, 'All fields required.', false);
      return;
    }
    if (newPw !== confirmPw) {
      flashMsg(setPwMsg, 'New passwords do not match.', false);
      return;
    }
    if (newPw.length < 8) {
      flashMsg(setPwMsg, 'Password must be at least 8 characters.', false);
      return;
    }
    setPwLoading(true);
    setPwMsg('');
    try {
      const res = await api.updateProfile({ current_password: oldPw, new_password: newPw });
      if (res.ok) {
        setOldPw(''); setNewPw(''); setConfirmPw('');
        setChangingPw(false);
        flashMsg(setPwMsg, 'Password changed.', true);
      } else {
        const d = await res.json().catch(() => ({}));
        flashMsg(setPwMsg, d?.message || 'Incorrect current password.', false);
      }
    } catch {
      flashMsg(setPwMsg, 'Network error.', false);
    } finally {
      setPwLoading(false);
    }
  };

  // ── 2FA ──────────────────────────────────────────────────────────────────

  const begin2fa = async () => {
    setShow2fa(true);
    setTfaMsg('');
    setTfaCode('');
    setTfaLoading(true);
    try {
      const res = await api.fetch('/users/@me/2fa/setup', { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        setTfaQr(d.qr_url || d.otpauth_url || null);
      } else {
        flashMsg(setTfaMsg, 'Could not start 2FA setup.', false);
      }
    } catch {
      flashMsg(setTfaMsg, 'Network error.', false);
    } finally {
      setTfaLoading(false);
    }
  };

  const confirm2fa = async () => {
    if (tfaCode.length < 6) { flashMsg(setTfaMsg, 'Enter the 6-digit code from your authenticator.', false); return; }
    setTfaLoading(true);
    try {
      const res = await api.fetch('/users/@me/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code: tfaCode }),
      });
      if (res.ok) {
        setTfaEnabled(true);
        setShow2fa(false);
        flashMsg(setTfaMsg, '2FA enabled.', true);
      } else {
        flashMsg(setTfaMsg, 'Invalid code. Try again.', false);
      }
    } catch {
      flashMsg(setTfaMsg, 'Network error.', false);
    } finally {
      setTfaLoading(false);
    }
  };

  const disable2fa = () => {
    Alert.alert('Disable 2FA', 'Are you sure you want to remove two-factor authentication?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.fetch('/users/@me/2fa', { method: 'DELETE' });
            if (res.ok) setTfaEnabled(false);
          } catch {}
        },
      },
    ]);
  };

  // ── Export data ───────────────────────────────────────────────────────────

  const exportData = async () => {
    Alert.alert(
      'Export Your Data',
      'A data export will be prepared and sent to your registered email address within 24 hours. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Request Export',
          onPress: async () => {
            try {
              const res = await api.fetch('/users/@me/export', { method: 'POST' });
              if (res.ok) Alert.alert('Export Requested', 'Check your email within 24 hours.');
              else        Alert.alert('Error', 'Could not request export. Try again later.');
            } catch {
              Alert.alert('Error', 'Network error.');
            }
          },
        },
      ],
    );
  };

  // ── Delete account ────────────────────────────────────────────────────────

  const submitDeleteAccount = async () => {
    if (!deleteConfirmPw) {
      Alert.alert('Password required', 'Enter your password to confirm deletion.');
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await api.fetch('/users/@me', {
        method: 'DELETE',
        body: JSON.stringify({ password: deleteConfirmPw }),
      });
      if (res.ok) {
        await api.clearAuth();
        onLogout();
      } else {
        const d = await res.json().catch(() => ({}));
        Alert.alert('Error', d?.message || 'Incorrect password or deletion failed.');
      }
    } catch {
      Alert.alert('Error', 'Network error.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Flash message helper ──────────────────────────────────────────────────

  function flashMsg(setter: (v: string) => void, msg: string, _ok: boolean) {
    setter(msg);
    setTimeout(() => setter(''), 3000);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const curStatusOpt = STATUS_OPTIONS.find(o => o.id === status) ?? STATUS_OPTIONS[0];
  const acColor = hashColor(api.userId ?? '?');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >

      {/* ── PROFILE ─────────────────────────────────────────────────────── */}
      <SectionHeader title="PROFILE" />

      <View style={s.profileCard}>
        {/* Avatar */}
        <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} style={s.avatarWrap}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={s.avatarImg} />
          ) : (
            <View style={[s.avatarFallback, { backgroundColor: acColor }]}>
              <Text style={s.avatarInitials}>{avatarInitials(displayName || '?')}</Text>
            </View>
          )}
          <View style={s.cameraOverlay}>
            <Text style={s.cameraIcon}>📷</Text>
          </View>
        </TouchableOpacity>

        {/* Name */}
        <View style={{ flex: 1 }}>
          {editingName ? (
            <View style={s.nameEditRow}>
              <TextInput
                style={s.nameInput}
                value={displayNameEdit}
                onChangeText={setDisplayNameEdit}
                placeholder="Display name"
                placeholderTextColor={C.mt}
                autoFocus
                maxLength={32}
              />
              <TouchableOpacity
                style={s.nameBtn}
                onPress={saveDisplayName}
                disabled={profileLoading}
              >
                {profileLoading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={s.nameBtnText}>Save</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.nameBtn, s.nameBtnCancel]}
                onPress={() => setEditingName(false)}
              >
                <Text style={[s.nameBtnText, { color: C.mt }]}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => { setDisplayNameEdit(displayName); setEditingName(true); }}
              style={s.nameDisplay}
              activeOpacity={0.7}
            >
              <Text style={s.nameText}>{displayName || 'Set a name'}</Text>
              <Text style={s.nameEditHint}>✏ tap to edit</Text>
            </TouchableOpacity>
          )}
          <Text style={s.usernameLabel}>@{api.username}</Text>
          {!!profileMsg && <Text style={s.inlineMsg}>{profileMsg}</Text>}
        </View>
      </View>

      {/* Status */}
      <View style={s.card}>
        <Text style={s.cardLabel}>STATUS</Text>
        <View style={s.statusGrid}>
          {STATUS_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.id}
              style={[
                s.statusChip,
                status === opt.id && { backgroundColor: `${opt.color}20`, borderColor: opt.color },
              ]}
              onPress={() => saveStatus(opt.id)}
              activeOpacity={0.7}
            >
              <View style={[s.statusDot, { backgroundColor: opt.color }]} />
              <Text style={[s.statusLabel, status === opt.id && { color: opt.color, fontWeight: '700' }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── NOTIFICATIONS ───────────────────────────────────────────────── */}
      <SectionHeader title="NOTIFICATIONS" />

      <View style={s.card}>
        <SettingRow
          icon="🔔"
          label="Push Notifications"
          hint={ls.pushEnabled ? 'Receive notifications on this device' : 'Notifications are disabled'}
          right={
            <Switch
              value={ls.pushEnabled}
              onValueChange={v => updateLs('pushEnabled', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.pushEnabled ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        <SettingRow
          icon="💬"
          label="Mentions Only"
          hint="Only notify for @mentions and DMs"
          right={
            <Switch
              value={ls.mentionOnly}
              onValueChange={v => updateLs('mentionOnly', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.mentionOnly ? '#000' : C.mt}
              disabled={!ls.pushEnabled}
            />
          }
        />

        <View style={s.divider} />

        <SettingRow
          icon="🌙"
          label="Do Not Disturb Schedule"
          hint="Silence notifications during set hours"
          right={
            <Switch
              value={ls.dndEnabled}
              onValueChange={v => updateLs('dndEnabled', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.dndEnabled ? '#000' : C.mt}
              disabled={!ls.pushEnabled}
            />
          }
        />

        {ls.dndEnabled && ls.pushEnabled && (
          <View style={s.dndSchedule}>
            <View style={s.dndTimeRow}>
              <Text style={s.dndTimeLabel}>Quiet from</Text>
              <TextInput
                style={s.dndTimeInput}
                value={ls.dndStart}
                onChangeText={t => {
                  setLs(p => ({ ...p, dndStart: t }));
                  if (validateTime(t)) saveLocalSetting(SK.dndStart, t);
                }}
                placeholder="22:00"
                placeholderTextColor={C.mt}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
              <Text style={s.dndTimeSep}>to</Text>
              <TextInput
                style={s.dndTimeInput}
                value={ls.dndEnd}
                onChangeText={t => {
                  setLs(p => ({ ...p, dndEnd: t }));
                  if (validateTime(t)) saveLocalSetting(SK.dndEnd, t);
                }}
                placeholder="07:00"
                placeholderTextColor={C.mt}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            <Text style={s.dndHint}>Format: HH:MM (24-hour)</Text>
          </View>
        )}
      </View>

      {/* ── APPEARANCE ──────────────────────────────────────────────────── */}
      <SectionHeader title="APPEARANCE" />

      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.rowIcon}>🔤</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Font Size</Text>
            <Text style={s.rowHint}>
              Preview:{' '}
              <Text style={{ fontSize: ls.fontSize, color: C.tx }}>Discreet chat</Text>
            </Text>
          </View>
        </View>
        <View style={{ paddingLeft: 44, paddingVertical: 8 }}>
          <FontSlider
            value={ls.fontSize}
            onChange={v => updateLs('fontSize', v)}
          />
        </View>

        <View style={s.divider} />

        <SettingRow
          icon="▤"
          label="Compact Mode"
          hint={ls.compact ? 'Reduced spacing between messages' : 'Comfortable message spacing'}
          right={
            <Switch
              value={ls.compact}
              onValueChange={v => updateLs('compact', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.compact ? '#000' : C.mt}
            />
          }
        />
      </View>

      {/* ── PROXIMITY & OFFLINE ─────────────────────────────────────────── */}
      <SectionHeader title="PROXIMITY & OFFLINE" />

      <View style={s.card}>

        {/* Proximity Mode toggle */}
        <SettingRow
          icon="📡"
          label="Proximity Mode"
          hint="Discover and message nearby Discreet users without internet"
          right={
            <Switch
              value={ls.proxEnabled}
              onValueChange={v => updateLs('proxEnabled', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxEnabled ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* BLE Discovery Range */}
        <View style={s.row}>
          <Text style={s.rowIcon}>📶</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>BLE Discovery Range</Text>
            <Text style={s.rowHint}>Scan power vs. battery trade-off</Text>
            <View style={s.rangeChips}>
              {BLE_RANGE_OPTIONS.map(opt => {
                const active = ls.bleRange === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[s.rangeChip, active && s.rangeChipActive]}
                    onPress={() => updateLs('bleRange', opt.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.rangeChipLabel, active && s.rangeChipLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={[s.rangeChipSub, active && s.rangeChipSubActive]}>
                      {opt.dist}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        <View style={s.divider} />

        {/* Auto-Activate on Offline */}
        <SettingRow
          icon="🔄"
          label="Auto-Activate on Offline"
          hint="Automatically enable proximity mode when internet is lost"
          right={
            <Switch
              value={ls.proxAutoOffline}
              onValueChange={v => updateLs('proxAutoOffline', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxAutoOffline ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* Stealth Mode */}
        <SettingRow
          icon="👤"
          label="Stealth Mode"
          hint="Listen for nearby users without broadcasting your presence"
          right={
            <Switch
              value={ls.proxStealth}
              onValueChange={v => updateLs('proxStealth', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxStealth ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* Show Nearby Count */}
        <SettingRow
          icon="🔢"
          label="Show Nearby Count in Status Bar"
          hint="Display number of discovered users in the tab bar"
          right={
            <Switch
              value={ls.proxNearbyCount}
              onValueChange={v => updateLs('proxNearbyCount', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxNearbyCount ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* Proximity Notifications */}
        <SettingRow
          icon="🔔"
          label="Proximity Notifications"
          hint="Notify when a friend is discovered nearby"
          right={
            <Switch
              value={ls.proxNotifs}
              onValueChange={v => updateLs('proxNotifs', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxNotifs ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* Wi-Fi Direct Voice */}
        <SettingRow
          icon="🎙"
          label="Wi-Fi Direct Voice"
          hint="Allow proximity voice calls over Wi-Fi Direct"
          right={
            <Switch
              value={ls.proxWifiVoice}
              onValueChange={v => updateLs('proxWifiVoice', v)}
              trackColor={{ true: C.ac, false: C.sf2 }}
              thumbColor={ls.proxWifiVoice ? '#000' : C.mt}
            />
          }
        />

        <View style={s.divider} />

        {/* Clear Offline Message Queue */}
        <SettingRow
          icon="🗑"
          label="Clear Offline Message Queue"
          hint={
            outboxCount === 0
              ? 'No messages pending'
              : `${outboxCount} message${outboxCount !== 1 ? 's' : ''} waiting to send`
          }
          right={
            <TouchableOpacity
              style={[s.clearQueueBtn, outboxCount === 0 && { opacity: 0.4 }]}
              onPress={clearQueue}
              disabled={clearingQueue}
            >
              {clearingQueue
                ? <ActivityIndicator color={C.err} size="small" />
                : <Text style={s.clearQueueText}>Clear</Text>
              }
            </TouchableOpacity>
          }
        />

      </View>

      {/* ── ACCOUNT ─────────────────────────────────────────────────────── */}
      <SectionHeader title="ACCOUNT" />

      <View style={s.card}>

        {/* Change password */}
        <SettingRow
          icon="🔑"
          label="Change Password"
          right={
            <TouchableOpacity onPress={() => { setChangingPw(p => !p); setPwMsg(''); }}>
              <Text style={s.chevron}>{changingPw ? '▲' : '▼'}</Text>
            </TouchableOpacity>
          }
        />
        {changingPw && (
          <View style={s.subForm}>
            <TextInput
              style={s.subInput}
              value={oldPw}
              onChangeText={setOldPw}
              placeholder="Current password"
              placeholderTextColor={C.mt}
              secureTextEntry
            />
            <TextInput
              style={s.subInput}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="New password"
              placeholderTextColor={C.mt}
              secureTextEntry
            />
            <TextInput
              style={s.subInput}
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Confirm new password"
              placeholderTextColor={C.mt}
              secureTextEntry
            />
            {!!pwMsg && <Text style={s.subMsg}>{pwMsg}</Text>}
            <TouchableOpacity
              style={s.subBtn}
              onPress={submitPasswordChange}
              disabled={pwLoading}
            >
              {pwLoading
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.subBtnText}>Update Password</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        <View style={s.divider} />

        {/* 2FA */}
        <SettingRow
          icon="🛡"
          label="Two-Factor Authentication"
          hint={tfaEnabled ? 'TOTP 2FA is active' : 'Add an extra layer of security'}
          right={tfaEnabled
            ? <Tag label="Enabled" color={C.ac} />
            : <TouchableOpacity onPress={begin2fa} style={s.enableBtn}>
                <Text style={s.enableBtnText}>Enable</Text>
              </TouchableOpacity>
          }
          onPress={tfaEnabled ? disable2fa : undefined}
        />
        {show2fa && !tfaEnabled && (
          <View style={s.subForm}>
            {tfaLoading ? (
              <ActivityIndicator color={C.ac} style={{ marginVertical: 12 }} />
            ) : (
              <>
                {tfaQr && (
                  <>
                    <Text style={s.tfaInstr}>
                      Scan this QR code with your authenticator app (e.g. Google Authenticator, Authy):
                    </Text>
                    <Image
                      source={{ uri: tfaQr }}
                      style={s.tfaQr}
                      resizeMode="contain"
                    />
                  </>
                )}
                <TextInput
                  style={s.subInput}
                  value={tfaCode}
                  onChangeText={setTfaCode}
                  placeholder="6-digit code"
                  placeholderTextColor={C.mt}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {!!tfaMsg && <Text style={s.subMsg}>{tfaMsg}</Text>}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={s.subBtn} onPress={confirm2fa}>
                    <Text style={s.subBtnText}>Verify & Activate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.subBtn, { backgroundColor: C.sf2, borderColor: C.bd }]}
                    onPress={() => setShow2fa(false)}
                  >
                    <Text style={[s.subBtnText, { color: C.mt }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        <View style={s.divider} />

        {/* Export data */}
        <SettingRow
          icon="📤"
          label="Export My Data"
          hint="Download all your data (GDPR)"
          onPress={exportData}
          right={<Text style={s.chevron}>›</Text>}
        />

        <View style={s.divider} />

        {/* Logout */}
        <SettingRow
          icon="⏏"
          label="Sign Out"
          danger
          onPress={onLogout}
          right={<Text style={[s.chevron, { color: C.err }]}>›</Text>}
        />
      </View>

      {/* Delete account */}
      <View style={[s.card, s.dangerCard]}>
        <SettingRow
          icon="🗑"
          label="Delete Account"
          hint="Permanently delete your account and all data"
          danger
          right={
            <TouchableOpacity
              onPress={() => setDeletingAccount(p => !p)}
              style={s.dangerToggleBtn}
            >
              <Text style={s.dangerToggleText}>{deletingAccount ? 'Cancel' : 'Delete'}</Text>
            </TouchableOpacity>
          }
        />
        {deletingAccount && (
          <View style={s.subForm}>
            <Text style={s.deleteWarning}>
              ⚠ This action is permanent and cannot be undone. All your messages, servers, and data will be erased.
            </Text>
            <TextInput
              style={[s.subInput, s.dangerInput]}
              value={deleteConfirmPw}
              onChangeText={setDeleteConfirmPw}
              placeholder="Enter your password to confirm"
              placeholderTextColor={C.mt}
              secureTextEntry
            />
            <TouchableOpacity
              style={s.deleteBtn}
              onPress={submitDeleteAccount}
              disabled={deleteLoading}
            >
              {deleteLoading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.deleteBtnText}>Permanently Delete Account</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── ABOUT ───────────────────────────────────────────────────────── */}
      <SectionHeader title="ABOUT" />

      <View style={s.card}>
        <SettingRow
          icon="📱"
          label="Version"
          right={<Text style={s.aboutVal}>0.1.0</Text>}
        />
        <View style={s.divider} />
        <SettingRow
          icon="🌐"
          label="Server"
          hint={SERVER_URL}
        />
        <View style={s.divider} />
        <SettingRow
          icon="🔒"
          label="Encryption"
          hint="MLS RFC 9420 end-to-end"
          right={<Tag label="Active" color={C.ac} />}
        />
        <View style={s.divider} />
        <SettingRow
          icon="📜"
          label="License"
          right={<Text style={s.aboutVal}>AGPL-3.0</Text>}
        />
      </View>

      {/* Bottom padding */}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 16, paddingTop: 8 },

  sectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    color: C.mt,
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  card: {
    backgroundColor: C.sf,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.bd,
    overflow: 'hidden',
    marginBottom: 2,
  },
  dangerCard: {
    borderColor: `${C.err}30`,
    backgroundColor: `${C.err}05`,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.mt,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },

  // Profile card
  profileCard: {
    backgroundColor: C.sf,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.bd,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 2,
  },
  avatarWrap: { position: 'relative' },
  avatarImg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: C.sf2,
  },
  avatarFallback: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: { fontSize: 26, fontWeight: '700', color: '#000' },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.sf2,
    borderWidth: 1.5,
    borderColor: C.bd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIcon: { fontSize: 12 },

  nameDisplay:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nameText:     { fontSize: 16, fontWeight: '700', color: C.tx },
  nameEditHint: { fontSize: 10, color: C.mt },
  usernameLabel: { fontSize: 12, color: C.mt, marginTop: 2 },

  nameEditRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  nameInput: {
    flex: 1,
    backgroundColor: C.sf2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.bd,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: C.tx,
    fontSize: 14,
  },
  nameBtn: {
    backgroundColor: C.ac,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameBtnCancel: { backgroundColor: C.sf2 },
  nameBtnText:   { fontSize: 13, fontWeight: '700', color: '#000' },

  inlineMsg: { fontSize: 11, color: C.ac, marginTop: 4 },

  // Status
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.bd,
    backgroundColor: C.sf2,
  },
  statusDot:   { width: 9, height: 9, borderRadius: 5 },
  statusLabel: { fontSize: 13, color: C.mt },

  // Generic row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  rowIcon:  { fontSize: 18, width: 26, textAlign: 'center' },
  rowLabel: { fontSize: 14, fontWeight: '600', color: C.tx },
  rowHint:  { fontSize: 11, color: C.mt, marginTop: 2, lineHeight: 16 },
  chevron:  { fontSize: 16, color: C.mt },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.bd, marginHorizontal: 16 },

  // DND schedule
  dndSchedule: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  dndTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dndTimeLabel: { fontSize: 13, color: C.mt, width: 72 },
  dndTimeSep:   { fontSize: 13, color: C.mt },
  dndTimeInput: {
    width: 70,
    backgroundColor: C.sf2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.bd,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: C.tx,
    fontSize: 13,
    textAlign: 'center',
  },
  dndHint: { fontSize: 10, color: C.mt, marginTop: 6 },

  // Sub-forms (password, 2FA)
  subForm: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 8,
  },
  subInput: {
    backgroundColor: C.sf2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.bd,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.tx,
    fontSize: 14,
  },
  dangerInput: { borderColor: `${C.err}40` },
  subMsg: { fontSize: 12, color: C.ac },
  subBtn: {
    flex: 1,
    backgroundColor: C.ac,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.ac,
  },
  subBtnText: { fontSize: 13, fontWeight: '700', color: '#000' },

  // 2FA
  tfaInstr: { fontSize: 12, color: C.mt, lineHeight: 18 },
  tfaQr: {
    width: 180,
    height: 180,
    alignSelf: 'center',
    marginVertical: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
  },

  // Tags / pills
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  tagText: { fontSize: 11, fontWeight: '700' },

  enableBtn: {
    backgroundColor: `${C.ac}18`,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: `${C.ac}40`,
  },
  enableBtnText: { fontSize: 12, fontWeight: '700', color: C.ac },

  // Danger zone
  dangerToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: `${C.err}15`,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${C.err}40`,
  },
  dangerToggleText: { fontSize: 12, fontWeight: '700', color: C.err },
  deleteWarning: {
    fontSize: 12,
    color: C.err,
    lineHeight: 18,
    padding: 10,
    backgroundColor: `${C.err}10`,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${C.err}30`,
  },
  deleteBtn: {
    backgroundColor: C.err,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  deleteBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // About
  aboutVal: { fontSize: 13, color: C.mt },

  // Proximity — BLE range chips
  rangeChips: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  rangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.bd,
    backgroundColor: C.sf2,
    alignItems: 'center',
  },
  rangeChipActive: {
    backgroundColor: `${C.ac}18`,
    borderColor: C.ac,
  },
  rangeChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: C.mt,
  },
  rangeChipLabelActive: { color: C.ac },
  rangeChipSub: {
    fontSize: 10,
    color: C.mt,
    marginTop: 1,
  },
  rangeChipSubActive: { color: C.ac },

  // Proximity — clear queue button
  clearQueueBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: `${C.err}12`,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${C.err}35`,
    minWidth: 52,
    alignItems: 'center',
  },
  clearQueueText: { fontSize: 12, fontWeight: '700', color: C.err },

  // Font slider
  sliderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderSample: { color: C.mt, fontWeight: '700' },
  sliderTrack: {
    width: SLIDER_W,
    height: 4,
    backgroundColor: C.sf2,
    borderRadius: 2,
    overflow: 'visible',
  },
  sliderFill: {
    height: 4,
    backgroundColor: C.ac,
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    top: -9,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.ac,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderVal: { fontSize: 11, color: C.mt, width: 32, textAlign: 'right' },
});
