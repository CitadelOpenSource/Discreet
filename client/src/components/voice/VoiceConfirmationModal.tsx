/**
 * VoiceConfirmationModal — Confirmation dialog for voice leave/switch.
 *
 * Shows contextual messaging:
 *   - Leave Voice? — for voice channels
 *   - End Call? — for DM calls
 *   - Leave Call? — for group calls (leaving doesn't end for others)
 *   - Switch Voice Channel? — when already in one channel and joining another
 *
 * Includes "Don't ask me again" checkbox that persists to localStorage.
 */
import React, { useState } from 'react';
import { T } from '../../theme';
import * as I from '../../icons';
import { type VoiceConfirmType, setConfirmEnabled } from '../../hooks/useVoiceConfirmation';

interface Props {
  type: VoiceConfirmType;
  onConfirm: () => void;
  onCancel: () => void;
}

export function VoiceConfirmationModal({ type, onConfirm, onCancel }: Props) {
  const [dontAsk, setDontAsk] = useState(false);

  const handleConfirm = () => {
    if (dontAsk) setConfirmEnabled(false);
    onConfirm();
  };

  // Derive titles and button labels from the confirmation type.
  let title = '';
  let subtitle = '';
  let confirmLabel = '';
  let confirmDanger = false;
  let cancelLabel = '';

  switch (type.kind) {
    case 'leave_voice':
      title = 'Leave Voice?';
      subtitle = `You are connected to ${type.channelName}`;
      confirmLabel = 'Leave';
      cancelLabel = 'Stay';
      break;
    case 'end_call':
      title = 'End Call?';
      subtitle = `Call with ${type.callName}`;
      confirmLabel = 'End Call';
      confirmDanger = true;
      cancelLabel = 'Cancel';
      break;
    case 'leave_group_call':
      title = 'Leave Call?';
      subtitle = `Leaving ${type.callName} — the call will continue for others`;
      confirmLabel = 'Leave';
      cancelLabel = 'Stay';
      break;
    case 'switch_voice':
      title = 'Switch Voice Channel?';
      subtitle = `Leave ${type.fromChannel} and join ${type.toChannel}`;
      confirmLabel = `Switch to ${type.toChannel}`;
      cancelLabel = `Stay in ${type.fromChannel}`;
      break;
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 10002, padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: '100%', maxWidth: 380, background: T.sf, borderRadius: 'var(--border-radius)',
        border: `1px solid ${T.bd}`, boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        padding: 24,
      }}>
        {/* Icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 18,
            background: confirmDanger ? 'rgba(255,71,87,0.12)' : 'rgba(0,212,170,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <I.PhoneOff s={18} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>{title}</div>
            <div style={{ fontSize: 12, color: T.mt, marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 'var(--radius-md)',
              border: `1px solid ${T.bd}`, background: T.sf2,
              color: T.tx, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 'var(--radius-md)',
              border: 'none',
              background: confirmDanger ? T.err : `linear-gradient(135deg,${T.ac},${T.ac2})`,
              color: confirmDanger ? '#fff' : '#000',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {confirmLabel}
          </button>
        </div>

        {/* Don't ask again */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 16, cursor: 'pointer', userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={e => setDontAsk(e.target.checked)}
            style={{ accentColor: T.ac, width: 14, height: 14, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: T.mt }}>
            Don't ask me again
          </span>
        </label>
      </div>
    </div>
  );
}
