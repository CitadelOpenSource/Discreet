/**
 * useVoiceConfirmation — Confirmation logic for voice channel leave/switch.
 *
 * Exports reusable logic so React Native can swap in native modals.
 * Reads the "confirm before leaving voice" preference from localStorage.
 */

const STORAGE_KEY = 'd_voice_confirm';

export type VoiceConfirmType =
  | { kind: 'leave_voice'; channelName: string }
  | { kind: 'end_call'; callName: string }
  | { kind: 'leave_group_call'; callName: string }
  | { kind: 'switch_voice'; fromChannel: string; toChannel: string };

export interface VoiceConfirmState {
  pending: VoiceConfirmType | null;
  onConfirm: (() => void) | null;
  onCancel: (() => void) | null;
}

/** Returns true if the user has opted out of confirmation dialogs. */
export function isConfirmDisabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'false';
}

/** Set whether the confirmation dialog is enabled. */
export function setConfirmEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

/** Returns true if confirmation is enabled (default: true). */
export function isConfirmEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

/**
 * Wraps an action with a confirmation check.
 * If confirmation is disabled, runs the action immediately and returns null.
 * Otherwise, returns the confirmation state for the modal to display.
 */
export function requestConfirmation(
  type: VoiceConfirmType,
  action: () => void,
): VoiceConfirmState | null {
  if (!isConfirmEnabled()) {
    action();
    return null;
  }
  return {
    pending: type,
    onConfirm: action,
    onCancel: null, // caller sets this
  };
}
