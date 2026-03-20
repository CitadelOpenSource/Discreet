/**
 * ScheduleModal — Schedule a message for future delivery.
 *
 * Datetime picker with message preview, Schedule button,
 * and a panel listing pending scheduled messages with Cancel buttons.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { T, ta } from '../theme';
import * as I from '../icons';
import { api } from '../api/CitadelAPI';

interface ScheduledMsg {
  id: string;
  channel_id: string;
  content_ciphertext: string;
  send_at: string;
  status: string;
  created_at: string;
}

interface Props {
  channelId: string;
  channelName: string;
  messageText: string;
  onScheduled: () => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function ScheduleModal({ channelId, channelName, messageText, onScheduled, onClose, onToast }: Props) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<ScheduledMsg[]>([]);
  const [showPending, setShowPending] = useState(false);

  // Default to 1 hour from now
  useEffect(() => {
    const d = new Date(Date.now() + 3600_000);
    setDate(d.toISOString().slice(0, 10));
    setTime(d.toTimeString().slice(0, 5));
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const data = await api.listScheduledMessages(channelId);
      setPending((Array.isArray(data) ? data : []).filter((m: ScheduledMsg) => m.status === 'pending'));
    } catch { /* empty on error */ }
  }, [channelId]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleSchedule = async () => {
    if (!messageText.trim()) { setError('Type a message first'); return; }
    if (!date || !time) { setError('Select a date and time'); return; }

    const sendAt = new Date(`${date}T${time}`);
    if (isNaN(sendAt.getTime())) { setError('Invalid date or time'); return; }
    if (sendAt.getTime() <= Date.now()) { setError('Scheduled time must be in the future'); return; }

    setScheduling(true);
    setError('');
    try {
      // Encode message text as base64 for content_ciphertext
      const encoded = btoa(unescape(encodeURIComponent(messageText)));
      await api.scheduleMessage(channelId, {
        content_ciphertext: encoded,
        mls_epoch: 0,
        send_at: sendAt.toISOString(),
      });
      onToast('Message scheduled');
      onScheduled();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to schedule message');
    }
    setScheduling(false);
  };

  const cancelMsg = async (id: string) => {
    try {
      await api.cancelScheduledMessage(id);
      setPending(prev => prev.filter(m => m.id !== id));
      onToast('Scheduled message cancelled');
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel');
    }
  };

  const previewText = messageText.trim() || '(empty message)';
  const minDate = new Date().toISOString().slice(0, 10);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: T.sf, borderRadius: 12, padding: 0, maxWidth: 440, width: '90%',
        border: `1px solid ${T.bd}`, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${T.bd}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.Clock s={16} />
            <span style={{ fontSize: 15, fontWeight: 700, color: T.tx }}>Schedule Message</span>
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: T.mt, padding: 2 }} aria-label="Close"><I.X s={16} /></div>
        </div>

        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
          {/* Message preview */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Message Preview</div>
            <div style={{
              padding: '10px 12px', background: T.bg, borderRadius: 8,
              border: `1px solid ${T.bd}`, fontSize: 13, color: T.tx,
              lineHeight: 1.5, maxHeight: 80, overflowY: 'auto', wordBreak: 'break-word',
            }}>
              {previewText}
            </div>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>
              Sending to <strong style={{ color: T.tx }}>#{channelName}</strong>
            </div>
          </div>

          {/* Date/time picker */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Date</label>
              <input
                type="date"
                value={date}
                min={minDate}
                onChange={e => setDate(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', background: T.bg,
                  border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
                  fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
                aria-label="Schedule date"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 4, textTransform: 'uppercase' }}>Time</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', background: T.bg,
                  border: `1px solid ${T.bd}`, borderRadius: 8, color: T.tx,
                  fontSize: 13, outline: 'none', boxSizing: 'border-box',
                }}
                aria-label="Schedule time"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ fontSize: 11, color: T.err, padding: '6px 10px', background: 'rgba(255,71,87,0.06)', borderRadius: 4, marginBottom: 10 }}>
              {error}
            </div>
          )}

          {/* Schedule button */}
          <button
            onClick={handleSchedule}
            disabled={scheduling || !messageText.trim()}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none',
              background: scheduling || !messageText.trim() ? T.sf2 : `linear-gradient(135deg,${T.ac},${T.ac2})`,
              color: scheduling || !messageText.trim() ? T.mt : '#000',
              fontSize: 13, fontWeight: 700, cursor: scheduling ? 'wait' : 'pointer',
              marginBottom: 16,
            }}
          >
            {scheduling ? 'Scheduling...' : 'Schedule Message'}
          </button>

          {/* Pending messages panel */}
          <div
            onClick={() => { setShowPending(p => !p); if (!showPending) loadPending(); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', padding: '8px 0', borderTop: `1px solid ${T.bd}`,
              userSelect: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <I.CalendarClock s={13} />
              <span style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>
                Pending ({pending.length})
              </span>
            </div>
            <span style={{ fontSize: 10, color: T.mt, transform: showPending ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              ▼
            </span>
          </div>

          {showPending && (
            <div style={{ marginTop: 6 }}>
              {pending.length === 0 && (
                <div style={{ fontSize: 11, color: T.mt, textAlign: 'center', padding: 10 }}>
                  No pending scheduled messages
                </div>
              )}
              {pending.map(msg => {
                let preview = '(encrypted)';
                try { preview = decodeURIComponent(escape(atob(msg.content_ciphertext))).slice(0, 60); } catch { /* keep default */ }
                const sendDate = new Date(msg.send_at);
                return (
                  <div key={msg.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', background: T.bg, borderRadius: 6,
                    marginBottom: 4,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preview}{preview.length >= 60 ? '...' : ''}
                      </div>
                      <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>
                        {sendDate.toLocaleDateString()} {sendDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      onClick={() => cancelMsg(msg.id)}
                      style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 4,
                        border: '1px solid rgba(255,71,87,0.3)', background: 'none',
                        color: T.err, cursor: 'pointer', flexShrink: 0,
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
