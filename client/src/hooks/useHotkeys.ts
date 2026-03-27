/**
 * useHotkeys — Global keyboard shortcut dispatcher.
 *
 * Reads keybindings from localStorage and dispatches actions on keydown.
 * Hotkeys are disabled when text inputs or textareas are focused.
 * "Always-active" hotkeys (Escape, Ctrl+K) work even in inputs.
 */

// ─── Types ──────────────────────────────────────────────

export interface HotkeyBinding {
  id: string;
  label: string;
  category: 'Navigation' | 'Voice' | 'Chat' | 'Modals';
  default: string;       // e.g. "Ctrl+Shift+M"
  alwaysActive?: boolean; // fires even when focused in an input
}

export interface HotkeyActions {
  [actionId: string]: () => void;
}

// ─── Default Bindings ───────────────────────────────────

export const HOTKEY_DEFINITIONS: HotkeyBinding[] = [
  // Navigation
  { id: 'quick_switcher',   label: 'Quick Switcher',            category: 'Navigation', default: 'Ctrl+K',       alwaysActive: true },
  { id: 'search_channel',   label: 'Search Current Channel',    category: 'Navigation', default: 'Ctrl+F' },
  { id: 'go_home',          label: 'Go to Home Page',           category: 'Navigation', default: 'Ctrl+Shift+H' },
  { id: 'return_to_voice',  label: 'Return to Voice Channel',   category: 'Navigation', default: 'Ctrl+Shift+V' },
  { id: 'create_server',    label: 'Create New Server',         category: 'Navigation', default: 'Ctrl+Shift+N' },
  // Voice
  { id: 'toggle_mute',      label: 'Toggle Mute',               category: 'Voice',      default: 'Ctrl+Shift+M' },
  { id: 'toggle_deafen',    label: 'Toggle Deafen',             category: 'Voice',      default: 'Ctrl+Shift+D' },
  // Chat
  { id: 'emoji_picker',     label: 'Emoji Picker',              category: 'Chat',       default: 'Ctrl+E' },
  { id: 'edit_last',        label: 'Edit Last Message',         category: 'Chat',       default: 'ArrowUp' },
  // Modals
  { id: 'close_modal',      label: 'Close Modal / Panel',       category: 'Modals',     default: 'Escape',       alwaysActive: true },
  { id: 'shortcuts_help',   label: 'Shortcuts Help',            category: 'Modals',     default: 'Ctrl+/' },
];

export const HOTKEY_CATEGORIES = ['Navigation', 'Voice', 'Chat', 'Modals'] as const;

// ─── Serialization ──────────────────────────────────────

const STORAGE_KEY = 'd_hotkeys';

/** Parse a key event into a normalized string like "Ctrl+Shift+M". */
export function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  // Don't include modifier-only keys as the base key.
  const key = e.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

/** Human-readable display for a combo string. */
export function comboDisplay(combo: string): string {
  return combo
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace(' ', 'Space');
}

/** Load all custom bindings from localStorage. */
export function loadBindings(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

/** Save all custom bindings to localStorage. */
export function saveBindings(bindings: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

/** Get the active combo for a hotkey (custom override or default). */
export function getBinding(id: string): string {
  const custom = loadBindings();
  if (custom[id]) return custom[id];
  const def = HOTKEY_DEFINITIONS.find(h => h.id === id);
  return def?.default || '';
}

/** Reset all custom bindings to defaults. */
export function resetBindings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Find conflicts: two actions bound to the same combo. */
export function findConflicts(bindings: Record<string, string>): Map<string, string[]> {
  const comboToIds = new Map<string, string[]>();
  for (const def of HOTKEY_DEFINITIONS) {
    const combo = bindings[def.id] || def.default;
    if (!combo) continue;
    const existing = comboToIds.get(combo) || [];
    existing.push(def.id);
    comboToIds.set(combo, existing);
  }
  const conflicts = new Map<string, string[]>();
  for (const [combo, ids] of comboToIds) {
    if (ids.length > 1) conflicts.set(combo, ids);
  }
  return conflicts;
}

// ─── Hook ───────────────────────────────────────────────

/**
 * Install the global keydown listener. Call once in the app root.
 * Returns a cleanup function.
 */
export function installHotkeyListener(actions: HotkeyActions): () => void {
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
    const combo = eventToCombo(e);
    if (!combo || combo === 'Ctrl' || combo === 'Shift' || combo === 'Alt') return;

    const bindings = loadBindings();

    for (const def of HOTKEY_DEFINITIONS) {
      const bound = bindings[def.id] || def.default;
      if (bound !== combo) continue;
      // Skip non-always-active hotkeys when in an input.
      if (inInput && !def.alwaysActive) continue;
      const action = actions[def.id];
      if (action) {
        e.preventDefault();
        action();
        return;
      }
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
