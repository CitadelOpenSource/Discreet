import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { C } from '../../App';
import type { Message } from './MessageList';

type Props = {
  channelName: string;
  sending:     boolean;
  onSend:      (text: string) => Promise<void>;
  replyTo?:    Message | null;
  onCancelReply?: () => void;
  onTyping?:   () => void;
};

export default function MessageInput({
  channelName, sending, onSend, replyTo, onCancelReply, onTyping,
}: Props) {
  const [text, setText] = useState('');

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    await onSend(trimmed);
  };

  const canSend = text.trim().length > 0 && !sending;

  return (
    <View style={s.wrapper}>
      {replyTo && (
        <View style={s.replyBanner}>
          <Text style={s.replyLabel} numberOfLines={1}>
            ↩ Replying to {replyTo.authorName ?? 'message'}: {replyTo.text || replyTo.content || '…'}
          </Text>
          <TouchableOpacity onPress={onCancelReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.replyCancel}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={s.row}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={t => { setText(t); onTyping?.(); }}
          placeholder={`Message #${channelName}`}
          placeholderTextColor={C.mt}
          multiline
          maxLength={2000}
          returnKeyType="default"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!canSend}
          activeOpacity={0.75}
          style={[s.sendBtn, canSend ? s.sendBtnActive : s.sendBtnDisabled]}
        >
          {sending
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={[s.sendIcon, !canSend && s.sendIconDisabled]}>↑</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: C.bd,
    backgroundColor: C.sf,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.bd,
  },
  replyLabel: {
    flex: 1,
    fontSize: 12,
    color: C.ac,
    fontStyle: 'italic',
  },
  replyCancel: {
    fontSize: 14,
    color: C.mt,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: C.sf2,
    borderWidth: 1,
    borderColor: C.bd,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: C.tx,
    fontSize: 14,
    maxHeight: 120,
    lineHeight: 20,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtnActive: {
    backgroundColor: C.ac,
  },
  sendBtnDisabled: {
    backgroundColor: C.sf2,
    borderWidth: 1,
    borderColor: C.bd,
  },
  sendIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    lineHeight: 24,
  },
  sendIconDisabled: {
    color: C.mt,
  },
});
