/**
 * KeybindSettings — Customizable keyboard shortcuts editor.
 *
 * Displays all bindable actions grouped by category with Record buttons
 * to capture key combos (including modifiers). Shows conflict warnings
 * and has Reset to Defaults.
 */
import React, { useState, useEffect } from 'react';
import { T, ta } from '../../theme';
import * as I from '../../icons';
import {
  HOTKEY_DEFINITIONS,
  HOTKEY_CATEGORIES,
  loadBindings,
  saveBindings,
  resetBindings,
  findConflicts,
  eventToCombo,
  comboDisplay,
} from '../../hooks/useHotkeys';

export default function KeybindSettings() {
  const [bindings, setBindings] = useState<Record<string, string>>(loadBindings);
  const [recording, setRecording] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Map<string, string[]>>(new Map());

  // Recompute conflicts whenever bindings change.
  useEffect(() => {
    setConflicts(findConflicts(bindings));
  }, [bindings]);

  const getCombo = (id: string): string => {
    return bindings[id] || HOTKEY_DEFINITIONS.find(h => h.id === id)?.default || '';
  };

  const isCustom = (id: string): boolean => !!bindings[id];

  const startRecording = (id: string) => {
    setRecording(id);
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording.
      if (e.key === 'Escape') {
        setRecording(null);
        document.removeEventListener('keydown', handler);
        return;
      }

      // Delete/Backspace clears the binding.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const next = { ...bindings };
        delete next[id];
        setBindings(next);
        saveBindings(next);
        setRecording(null);
        document.removeEventListener('keydown', handler);
        return;
      }

      // Ignore modifier-only presses — wait for a base key.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const combo = eventToCombo(e);
      const next = { ...bindings, [id]: combo };
      setBindings(next);
      saveBindings(next);
      setRecording(null);
      document.removeEventListener('keydown', handler);
    };
    document.addEventListener('keydown', handler);
  };

  const resetSingle = (id: string) => {
    const next = { ...bindings };
    delete next[id];
    setBindings(next);
    saveBindings(next);
  };

  const resetAll = () => {
    resetBindings();
    setBindings({});
  };

  // Find which actions conflict with a given action.
  const getConflict = (id: string): string[] | null => {
    const combo = getCombo(id);
    const ids = conflicts.get(combo);
    if (ids && ids.length > 1) return ids.filter(x => x !== id);
    return null;
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx }}>Keyboard Shortcuts</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Click any key to rebind. Press Escape to cancel, Delete to clear.</div>
        </div>
        <button onClick={resetAll} style={{
          padding: '5px 12px', borderRadius: 6, border: `1px solid ${T.bd}`,
          background: T.bg, color: T.mt, fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}>
          Reset to Defaults
        </button>
      </div>

      {/* Conflict banner */}
      {conflicts.size > 0 && (
        <div style={{
          padding: '8px 12px', background: 'rgba(250,166,26,0.08)',
          border: '1px solid rgba(250,166,26,0.2)', borderRadius: 8,
          marginBottom: 12, fontSize: 11, color: '#faa61a', lineHeight: 1.5,
        }}>
          <strong>Conflicts detected</strong> — Some shortcuts are bound to the same key combo.
          Conflicting shortcuts may not work as expected.
        </div>
      )}

      {/* Grouped bindings */}
      {HOTKEY_CATEGORIES.map(cat => {
        const defs = HOTKEY_DEFINITIONS.filter(h => h.category === cat);
        return (
          <div key={cat} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 10, fontWeight: 800, color: T.mt,
              textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8,
            }}>
              {cat}
            </div>

            {defs.map(def => {
              const combo = getCombo(def.id);
              const isRec = recording === def.id;
              const conflictIds = getConflict(def.id);
              const conflictNames = conflictIds?.map(cid => HOTKEY_DEFINITIONS.find(h => h.id === cid)?.label || cid);

              return (
                <div key={def.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', background: T.sf2, borderRadius: 8,
                  marginBottom: 3,
                  border: conflictIds ? '1px solid rgba(250,166,26,0.3)' : `1px solid transparent`,
                }}>
                  {/* Label */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {def.label}
                      {def.alwaysActive && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: ta(T.ac, '15'), color: T.ac, fontWeight: 700 }}>GLOBAL</span>}
                    </div>
                    {conflictNames && (
                      <div style={{ fontSize: 10, color: '#faa61a', marginTop: 1 }}>
                        Conflicts with: {conflictNames.join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Reset button (if custom) */}
                  {isCustom(def.id) && !isRec && (
                    <div
                      onClick={() => resetSingle(def.id)}
                      style={{ cursor: 'pointer', color: T.mt, padding: 2, fontSize: 10 }}
                      title="Reset to default"
                    >
                      <I.X s={10} />
                    </div>
                  )}

                  {/* Key display / Record button */}
                  <div
                    onClick={() => { if (!isRec) startRecording(def.id); }}
                    style={{
                      padding: '4px 12px', borderRadius: 6, minWidth: 80, textAlign: 'center',
                      border: `1px solid ${isRec ? T.ac : conflictIds ? 'rgba(250,166,26,0.4)' : T.bd}`,
                      background: isRec ? ta(T.ac, '12') : T.bg,
                      fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                      color: isRec ? T.ac : isCustom(def.id) ? T.tx : T.mt,
                      cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    {isRec ? 'Press keys...' : combo ? comboDisplay(combo) : 'None'}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Info box */}
      <div style={{
        padding: '10px 12px', background: T.bg, borderRadius: 8,
        border: `1px solid ${T.bd}`, fontSize: 11, color: T.mt, lineHeight: 1.5,
      }}>
        <strong style={{ color: T.tx }}>Tips:</strong> Hotkeys work while in voice/video calls so you can navigate without leaving.
        Hotkeys are disabled when typing in a text field (except those marked <span style={{ color: T.ac }}>GLOBAL</span>).
      </div>
    </div>
  );
}
