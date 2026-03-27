import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../../App';

export type Channel = {
  id: string;
  name: string;
  channel_type: string;
  category_id?: string;
  position?: number;
};

export type Category = { id: string; name: string; position: number };

export type VoiceMember = { userId: string; username: string; muted?: boolean };

type Props = {
  serverName:    string;
  channels:      Channel[];
  categories:    Category[];
  selectedId:    string | null;
  loading:       boolean;
  onSelect:      (channel: Channel) => void;
  onClose:       () => void;
  unreadCounts?: Record<string, number>;
  voiceChannelId?: string | null;
  voiceMembers?: VoiceMember[];
  memberCount?:  number;
};

function channelIcon(type: string): string {
  switch (type) {
    case 'voice':        return '🔊';
    case 'announcement': return '📢';
    case 'forum':        return '💬';
    case 'stage':        return '🎤';
    default:             return '#';
  }
}

function initials(name: string): string {
  return (name || '?')[0].toUpperCase();
}

export default function ChannelList({
  serverName, channels, categories, selectedId, loading,
  onSelect, onClose, unreadCounts = {}, voiceChannelId, voiceMembers = [], memberCount,
}: Props) {
  // Group channels by category, uncategorized first
  const byCat: Record<string, Channel[]> = { '': [] };
  categories
    .slice()
    .sort((a, b) => a.position - b.position)
    .forEach(c => { byCat[c.id] = []; });
  channels.forEach(ch => {
    const key = ch.category_id && byCat[ch.category_id] !== undefined ? ch.category_id : '';
    byCat[key].push(ch);
  });
  const catOrder = ['', ...categories.map(c => c.id)];

  return (
    <View style={s.root}>
      {/* Server header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.serverName} numberOfLines={1}>{serverName}</Text>
          {memberCount != null && memberCount > 0 && (
            <Text style={s.memberCount}>{memberCount} members</Text>
          )}
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={s.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.ac} />
        </View>
      ) : channels.length === 0 ? (
        <View style={s.center}>
          <Text style={s.empty}>No channels</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {catOrder.map(catId => {
            const chs = byCat[catId];
            if (!chs || chs.length === 0) return null;
            const cat = categories.find(c => c.id === catId);
            return (
              <View key={catId || '__uncat__'}>
                {cat && (
                  <Text style={s.catLabel}>{cat.name.toUpperCase()}</Text>
                )}
                {chs.map(ch => {
                  const active  = ch.id === selectedId;
                  const isVoice = ch.channel_type === 'voice';
                  const isText  = ch.channel_type === 'text';
                  const unread  = unreadCounts[ch.id] ?? 0;
                  const inVoice = isVoice && voiceChannelId === ch.id;
                  const icon    = channelIcon(ch.channel_type);

                  return (
                    <View key={ch.id}>
                      <TouchableOpacity
                        onPress={() => onSelect(ch)}
                        activeOpacity={0.7}
                        style={[s.chRow, active && s.chRowActive, unread > 0 && !active && s.chRowUnread]}
                      >
                        {/* Icon */}
                        <Text style={[
                          s.chIcon,
                          isText && s.chIconHash,
                          (active || inVoice) && s.chIconActive,
                        ]}>
                          {icon}
                        </Text>

                        {/* Name */}
                        <Text
                          style={[
                            s.chName,
                            active && s.chNameActive,
                            unread > 0 && !active && s.chNameUnread,
                          ]}
                          numberOfLines={1}
                        >
                          {ch.name}
                        </Text>

                        {/* Unread badge (text channels) */}
                        {!isVoice && unread > 0 && (
                          <View style={s.badge}>
                            <Text style={s.badgeTx}>
                              {unread > 99 ? '99+' : String(unread)}
                            </Text>
                          </View>
                        )}

                        {/* Voice connected indicator */}
                        {inVoice && (
                          <View style={s.voicePill}>
                            <Text style={s.voicePillTx}>● LIVE</Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      {/* Voice channel member list */}
                      {inVoice && voiceMembers.length > 0 && (
                        <View style={s.voiceMembers}>
                          {voiceMembers.map(m => (
                            <View key={m.userId} style={s.voiceMemberRow}>
                              <View style={[s.voiceAvatar, m.muted && s.voiceAvatarMuted]}>
                                <Text style={s.voiceAvatarTx}>{initials(m.username)}</Text>
                              </View>
                              <Text style={[s.voiceMemberName, m.muted && s.voiceMemberMuted]} numberOfLines={1}>
                                {m.username}
                              </Text>
                              {m.muted && <Text style={s.mutedIcon}>🔇</Text>}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
          <View style={{ height: 20 }} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    width: 220,
    backgroundColor: C.sf,
    borderRightWidth: 1,
    borderRightColor: C.bd,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.bd,
    gap: 8,
  },
  serverName: {
    fontSize: 14,
    fontWeight: '700',
    color: C.tx,
  },
  memberCount: {
    fontSize: 10,
    color: C.mt,
    marginTop: 1,
  },
  closeIcon: {
    fontSize: 16,
    color: C.mt,
    padding: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  empty: {
    color: C.mt,
    fontSize: 13,
  },
  catLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: C.mt,
    letterSpacing: 0.8,
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 4,
  },
  chRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginHorizontal: 4,
    borderRadius: 6,
    gap: 6,
  },
  chRowActive: {
    backgroundColor: `${C.ac}18`,
  },
  chRowUnread: {
    // slightly brighter background for channels with unread messages
  },
  chIcon: {
    fontSize: 14,
    color: C.mt,
    width: 18,
    textAlign: 'center',
  },
  chIconHash: {
    fontSize: 16,
    fontWeight: '600',
  },
  chIconActive: {
    color: C.ac,
  },
  chName: {
    fontSize: 13,
    color: C.mt,
    flex: 1,
    fontWeight: '500',
  },
  chNameActive: {
    color: C.tx,
    fontWeight: '600',
  },
  chNameUnread: {
    color: C.tx,
    fontWeight: '700',
  },
  badge: {
    backgroundColor: C.err,
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    flexShrink: 0,
  },
  badgeTx: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  voicePill: {
    backgroundColor: `${C.ac}22`,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexShrink: 0,
  },
  voicePillTx: {
    fontSize: 9,
    fontWeight: '700',
    color: C.ac,
    letterSpacing: 0.4,
  },
  voiceMembers: {
    paddingLeft: 32,
    paddingRight: 8,
    paddingBottom: 4,
  },
  voiceMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 6,
  },
  voiceAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.ac,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  voiceAvatarMuted: {
    opacity: 0.4,
  },
  voiceAvatarTx: {
    fontSize: 9,
    fontWeight: '700',
    color: '#000',
  },
  voiceMemberName: {
    fontSize: 11,
    color: C.mt,
    flex: 1,
    fontWeight: '500',
  },
  voiceMemberMuted: {
    opacity: 0.5,
  },
  mutedIcon: {
    fontSize: 10,
  },
});
