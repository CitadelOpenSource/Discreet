import React, { useState, useRef } from 'react';
import { T, ta, PRESETS, getThemeName, setTheme, getTheme, exportTheme, validateCustomTheme, applyCustomTheme, loadCustomTheme, previewTheme, revertPreview, type ThemeRaw, type ThemePreset } from '../../theme';
import { useTimezone, detectedTimezone, type TimestampFormat } from '../../hooks/TimezoneContext';
import { useLayout } from '../../contexts/LayoutContext';
import { LAYOUT_MODES } from '../../hooks/useLayoutMode';
import { api } from '../../api/CitadelAPI';
import * as I from '../../icons';
import { loadConfig as loadNightConfig, saveConfig as saveNightConfig, activateNow, overrideSession, clearSessionOverride, hasSessionOverride, shouldActivate, type NighttimeConfig } from '../../hooks/useNighttimeMode';

interface UserSettings { [key: string]: unknown; }

export interface SettingsAppearanceProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sel: React.CSSProperties;
  sectionVisible: (section: string) => boolean;
  setSaved: (v: boolean) => void;
}

// ─── Color picker field ─────────────────────────────────────────────────

const COLOR_FIELDS: { key: keyof ThemeRaw; label: string }[] = [
  { key: 'bg',   label: 'Background' },
  { key: 'sf',   label: 'Sidebar' },
  { key: 'sf2',  label: 'Card / Input' },
  { key: 'sf3',  label: 'Surface 3' },
  { key: 'bd',   label: 'Border' },
  { key: 'tx',   label: 'Text' },
  { key: 'mt',   label: 'Text Muted' },
  { key: 'ac',   label: 'Accent' },
  { key: 'ac2',  label: 'Accent Alt' },
  { key: 'err',  label: 'Danger' },
  { key: 'warn', label: 'Warning' },
  { key: 'ok',   label: 'Success' },
];

// ─── Theme preview card ─────────────────────────────────────────────────

/** Font-family name for display (extracts first family from CSS font stack). */
function fontLabel(p: ThemePreset): string | null {
  const f = p.font || p.headingFont;
  if (!f) return null;
  const match = f.match(/^'([^']+)'/);
  return match ? match[1] : null;
}

function ThemeCard({ p, save, isSkin }: { p: ThemePreset; save: (k: string, v: unknown) => void; isSkin: boolean }) {
  const active = getThemeName() === p.id;
  const c = p.colors;
  const r = (max: number) => p.borderRadius != null ? Math.min(p.borderRadius, max) : max;
  const font = isSkin ? fontLabel(p) : null;

  return (
    <div
      onClick={() => { setTheme(p.id); save('theme', p.id); }}
      style={{
        cursor: 'pointer', borderRadius: 10, overflow: 'hidden', position: 'relative',
        border: active ? `2px solid ${c.ac}` : `2px solid ${c.bd}`,
        transition: 'border-color .15s',
      }}>
      {/* Checkmark overlay */}
      {active && (
        <div style={{
          position: 'absolute', top: 6, right: 6, zIndex: 1,
          width: 22, height: 22, borderRadius: 11, background: c.ac,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c.bg} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
      {/* Mini UI mockup */}
      <div style={{ display: 'flex', height: 72, background: c.bg }}>
        <div style={{ width: 40, background: c.sf, borderRight: `1px solid ${c.bd}`, padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ width: 20, height: 20, borderRadius: r(6), background: c.sf2, margin: '0 auto' }} />
          <div style={{ width: 20, height: 20, borderRadius: r(6), background: c.ac, margin: '0 auto', opacity: 0.3 }} />
          <div style={{ width: 20, height: 20, borderRadius: r(6), background: c.sf2, margin: '0 auto' }} />
        </div>
        <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {!p.hideAvatars && <div style={{ width: 10, height: 10, borderRadius: 5, background: c.mt, flexShrink: 0 }} />}
            <div style={{ height: 6, width: '70%', background: c.mt, borderRadius: r(3), opacity: 0.4 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {!p.hideAvatars && <div style={{ width: 10, height: 10, borderRadius: 5, background: c.ac, flexShrink: 0 }} />}
            <div style={{ height: 6, width: '50%', background: c.ac, borderRadius: r(3), opacity: 0.5 }} />
          </div>
          <div style={{ height: 10, background: c.sf2, borderRadius: r(4), border: `1px solid ${c.bd}`, marginTop: 2 }} />
        </div>
      </div>
      {/* Label */}
      <div style={{ padding: '8px 10px', background: c.sf, borderTop: `1px solid ${c.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: active ? c.ac : c.tx }}>{p.name}</div>
        </div>
        <div style={{ fontSize: 10, color: c.mt, marginTop: 2 }}>{p.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
          {p.swatch && p.swatch.map((hex: string, si: number) => (
            <div key={si} style={{ width: 14, height: 14, borderRadius: r(4), background: hex, border: '1px solid rgba(128,128,128,0.3)' }} />
          ))}
          {font && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: c.sf2, color: c.mt, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              {font}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SettingsAppearance({ s, save, sel, sectionVisible, setSaved }: SettingsAppearanceProps) {
  const tzCtx = useTimezone();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErr, setImportErr] = useState('');
  const layout = useLayout();
  const [showEditor, setShowEditor] = useState(false);
  const [draft, setDraft] = useState<ThemeRaw>(() => loadCustomTheme() || getTheme());
  const [editorDirty, setEditorDirty] = useState(false);

  const [themeTab, setThemeTab] = useState<'colors' | 'skins'>('colors');
  const SKIN_IDS = ['phosphor', 'arcade', 'vapor', 'pixel', 'cipher', 'neon'];
  const filtered = PRESETS.filter(p => themeTab === 'skins' ? SKIN_IDS.includes(p.id) : !SKIN_IDS.includes(p.id));

  return (<>
    <div style={{ display: sectionVisible('theme') ? undefined : 'none' }}>
    <div data-section="theme" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Theme</div>

    {/* Category tabs */}
    <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: `1px solid ${T.bd}` }}>
      {(['colors', 'skins'] as const).map(tab => {
        const active = themeTab === tab;
        return (
          <button key={tab} onClick={() => setThemeTab(tab)}
            aria-label={`${tab} themes`}
            style={{
              flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: active ? T.ac : T.sf2, color: active ? '#000' : T.mt,
              transition: 'background var(--transition-fast)',
            }}>
            {tab === 'colors' ? 'Colors' : 'Skins'}
          </button>
        );
      })}
    </div>
    {themeTab === 'skins' && (
      <div style={{ fontSize: 11, color: T.mt, marginBottom: 10, padding: '6px 10px', background: T.sf2, borderRadius: 'var(--radius-sm)', border: `1px solid ${T.bd}`, lineHeight: 1.5 }}>
        Skins change fonts, borders, shadows, and animations in addition to colors.
      </div>
    )}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
      {filtered.map(p => <ThemeCard key={p.id} p={p} save={save} isSkin={SKIN_IDS.includes(p.id)} />)}
    </div>
    {/* ── Export / Import ── */}
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      <button onClick={() => {
        const data = exportTheme();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `discreet-theme-${data.name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
        Export Theme
      </button>
      <button onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
        Import Theme
      </button>
      <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => {
        setImportErr('');
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result as string);
            const colors = validateCustomTheme(parsed.colors || parsed);
            if (!colors) { setImportErr('Invalid theme file. Requires 12 hex color fields.'); return; }
            applyCustomTheme(colors);
            setDraft({ ...colors });
            save('theme', 'custom');
            setSaved(true); setTimeout(() => setSaved(false), 1500);
          } catch { setImportErr('Could not parse JSON file.'); }
        };
        reader.readAsText(file);
        e.target.value = '';
      }} />
    </div>
    {importErr && <div style={{ fontSize: 11, color: T.err, marginBottom: 12 }}>{importErr}</div>}

    {/* ── Custom Theme Editor ── */}
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => {
        if (showEditor && editorDirty) { revertPreview(); }
        setShowEditor(p => !p);
        if (!showEditor) { setDraft(loadCustomTheme() || getTheme()); setEditorDirty(false); }
      }}
        style={{ width: '100%', padding: '9px 0', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: showEditor ? ta(T.ac, '18') : T.sf2, color: showEditor ? T.ac : T.tx, border: `1px solid ${showEditor ? T.ac : T.bd}` }}>
        {showEditor ? 'Hide Custom Editor' : 'Custom Theme Editor'}
      </button>

      {showEditor && (
        <div style={{ marginTop: 10, padding: 14, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
          {/* Color pickers grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {COLOR_FIELDS.map(f => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" value={draft[f.key]} onChange={e => {
                  const next = { ...draft, [f.key]: e.target.value };
                  setDraft(next);
                  setEditorDirty(true);
                  previewTheme(next);
                }} style={{ width: 28, height: 28, border: `1px solid ${T.bd}`, borderRadius: 4, padding: 0, cursor: 'pointer', background: 'transparent' }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.tx }}>{f.label}</div>
                  <div style={{ fontSize: 9, color: T.mt, fontFamily: 'monospace' }}>{draft[f.key]}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Live preview */}
          <div style={{ fontSize: 10, fontWeight: 700, color: T.mt, textTransform: 'uppercase', marginBottom: 6 }}>Live Preview</div>
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', border: `1px solid ${draft.bd}`, marginBottom: 12 }}>
            <div style={{ display: 'flex', height: 80, background: draft.bg }}>
              <div style={{ width: 44, background: draft.sf, borderRight: `1px solid ${draft.bd}`, padding: 6, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: draft.sf2 }} />
                <div style={{ width: 22, height: 22, borderRadius: 6, background: draft.ac, opacity: 0.3 }} />
              </div>
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 6, background: draft.mt }} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: draft.tx }}>User </span>
                    <span style={{ fontSize: 10, color: draft.mt }}>Hello world</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 6, background: draft.ac }} />
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: draft.ac }}>You </span>
                    <span style={{ fontSize: 10, color: draft.tx }}>Hey!</span>
                  </div>
                </div>
                <div style={{ height: 14, background: draft.sf2, borderRadius: 4, border: `1px solid ${draft.bd}` }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '6px 8px', background: draft.sf, borderTop: `1px solid ${draft.bd}` }}>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: draft.ac, color: draft.bg, fontWeight: 700 }}>Accent</span>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: draft.err, color: '#fff', fontWeight: 700 }}>Danger</span>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: draft.warn, color: '#000', fontWeight: 700 }}>Warn</span>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: draft.ok, color: '#000', fontWeight: 700 }}>OK</span>
            </div>
          </div>

          {/* Save button */}
          <button onClick={() => {
            applyCustomTheme(draft);
            save('theme', 'custom');
            setEditorDirty(false);
            setSaved(true); setTimeout(() => setSaved(false), 1500);
          }} disabled={!editorDirty} style={{
            width: '100%', padding: '9px 0', fontSize: 13, fontWeight: 700, borderRadius: 'var(--radius-md)', border: 'none', cursor: editorDirty ? 'pointer' : 'not-allowed',
            background: editorDirty ? `linear-gradient(135deg,${draft.ac},${draft.ac2})` : T.sf3,
            color: editorDirty ? '#000' : T.mt,
          }}>
            {editorDirty ? 'Save Custom Theme' : 'No changes'}
          </button>
        </div>
      )}
    </div>

    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Text & Layout</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Font Size</label>
        <select style={sel} value={(s.font_size as string) || 'medium'} onChange={e => save('font_size', e.target.value)}>
          <option value="small">Small (13px)</option><option value="medium">Medium (15px)</option><option value="large">Large (18px)</option><option value="xl">Extra Large (20px)</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Font Family</label>
        <select style={sel} value={localStorage.getItem('d_font') || 'dm-sans'} onChange={e => localStorage.setItem('d_font', e.target.value)}>
          <option value="system">System UI (Default)</option><option value="mono">Fira Code (Mono)</option><option value="serif">Georgia (Serif)</option>
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ fontSize: 12, color: T.mt, marginBottom: 8, display: 'block' }}>Message Density</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { id: 'compact', label: 'Compact', desc: 'No avatars, IRC-style, timestamps on hover', icon: '≡' },
            { id: 'cozy', label: 'Cozy', desc: 'Default — avatars, balanced spacing', icon: '☰' },
            { id: 'spacious', label: 'Spacious', desc: 'Large avatars, extra padding between messages', icon: '▤' },
          ] as const).map(m => {
            const active = ((s.message_density as string) || 'cozy') === m.id;
            return (
              <div key={m.id} onClick={() => { save('message_density', m.id); localStorage.setItem('d_msg_density', m.id); }}
                style={{ flex: 1, padding: '12px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? 'rgba(124,58,237,0.06)' : 'transparent', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.6 }}>{m.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: active ? T.ac : T.tx }}>{m.label}</div>
                <div style={{ fontSize: 9, color: T.mt, marginTop: 2, lineHeight: 1.3 }}>{m.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Chat Bubbles */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Chat Bubbles</div>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 2, lineHeight: 1.4 }}>Show messages in rounded bubbles — your messages colored, others neutral</div>
          </div>
          <div onClick={() => { const next = !(s.chat_bubbles === true); save('chat_bubbles', next); localStorage.setItem('d_chat_bubbles', String(next)); }}
            style={{ width: 36, height: 20, borderRadius: 10, background: s.chat_bubbles === true ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: s.chat_bubbles === true ? 18 : 2, transition: 'left 0.2s' }} />
          </div>
        </div>
        {s.chat_bubbles === true && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {([
              { id: 'standard', label: 'Standard', desc: 'Your messages right, others left' },
              { id: 'aligned', label: 'Aligned Left', desc: 'All messages left-aligned' },
            ] as const).map(bp => {
              const active = ((s.bubble_position as string) || 'standard') === bp.id;
              return (
                <div key={bp.id} onClick={() => { save('bubble_position', bp.id); localStorage.setItem('d_bubble_position', bp.id); }}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? 'rgba(124,58,237,0.06)' : 'transparent', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? T.ac : T.tx }}>{bp.label}</div>
                  <div style={{ fontSize: 9, color: T.mt, marginTop: 2 }}>{bp.desc}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Layout Mode */}
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ fontSize: 12, color: T.mt, marginBottom: 8, display: 'block' }}>Layout Mode</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {LAYOUT_MODES.map(lm => {
            const active = layout.mode === lm.id;
            return (
              <div key={lm.id} onClick={() => { layout.setMode(lm.id); save('layout_mode', lm.id); }}
                style={{ flex: 1, padding: '12px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? ta(T.ac, '0f') : 'transparent', textAlign: 'center' }}>
                <div style={{ fontSize: 20, marginBottom: 4, opacity: 0.7 }}>{lm.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: active ? T.ac : T.tx }}>{lm.name}</div>
                <div style={{ fontSize: 9, color: T.mt, marginTop: 3, lineHeight: 1.4 }}>{lm.description}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Chat Width</label>
        <select style={sel} value={localStorage.getItem('d_chat_width') || 'normal'} onChange={e => localStorage.setItem('d_chat_width', e.target.value)}>
          <option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option><option value="full">Full Width</option>
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Message Text Size: {(s.chat_font_size as number) || 14}px</label>
        <input
          type="range" min="12" max="24" step="1"
          value={(s.chat_font_size as number) || 14}
          onChange={e => {
            const px = parseInt(e.target.value, 10);
            save('chat_font_size', px);
            localStorage.setItem('d_chat_font_size', String(px));
            document.documentElement.style.setProperty('--chat-font-size', `${px}px`);
          }}
          style={{ width: '100%', accentColor: T.ac } as React.CSSProperties}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}>
          <span>12px</span><span>16px</span><span>20px</span><span>24px</span>
        </div>
        <div style={{ marginTop: 8, padding: '10px 12px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.mt, marginBottom: 6, textTransform: 'uppercase' }}>Live Preview</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 14, background: T.ac, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000', flexShrink: 0 }}>J</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Jane <span style={{ fontSize: 10, color: T.mt, fontWeight: 400 }}>Today at 3:42 PM</span></div>
              <div style={{ fontSize: (s.chat_font_size as number) || 14, color: T.tx, lineHeight: 1.5, marginTop: 2 }}>Hey! Have you seen the new encryption features? The end-to-end encryption is incredible.</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: T.mt, marginTop: 4 }}>Only message content scales — UI elements (sidebar, buttons, headers) are not affected.</div>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Language</label>
        <select style={sel} value={(s.locale as string) || 'en'} onChange={e => save('locale', e.target.value)}>
          <option value="en">English</option>
          <option value="es">Espanol</option>
          <option value="fr">Francais</option>
          <option value="pt">Portugues</option>
          <option value="ru">Russian</option>
          <option value="uk">Ukrainian</option>
          <option value="zh">Chinese</option>
          <option value="ja">Japanese</option>
          <option value="ko">Korean</option>
          <option value="ar">Arabic</option>
          <option value="fa">Farsi</option>
          <option value="he">Hebrew</option>
          <option value="ku">Kurdish (Sorani)</option>
          <option value="my">Burmese</option>
          <option value="ps">Pashto</option>
          <option value="tr">Turkish</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Timezone</label>
        <select style={sel} value={tzCtx.timezone} onChange={e => { const tz = e.target.value; tzCtx.setTimezone(tz); api.saveTimezone(tz).catch(() => {}); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
          {(() => { try { return Intl.supportedValuesOf('timeZone').map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>); } catch { return [detectedTimezone].map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>); } })()}
        </select>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Auto-detected: {detectedTimezone.replace(/_/g, ' ')}</div>
      </div>
    </div>
    </div>
    {/* Timestamps */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Timestamps</div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Show message timestamps</div>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Display timestamps next to messages. Date separators always show.</div>
      </div>
      <div onClick={() => { const next = !(s.show_timestamps !== false); save('show_timestamps', next); localStorage.setItem('d_show_timestamps', String(next)); }}
        style={{ width: 36, height: 20, borderRadius: 10, background: s.show_timestamps !== false ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
        <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: s.show_timestamps !== false ? 18 : 2, transition: 'left 0.2s' }} />
      </div>
    </div>
    {s.show_timestamps !== false && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([
          { id: 'relative' as TimestampFormat, label: 'Relative', example: '2 min ago' },
          { id: '12h' as TimestampFormat, label: '12-hour', example: '3:42 PM' },
          { id: '24h' as TimestampFormat, label: '24-hour', example: '15:42' },
        ]).map(fmt => {
          const active = (s.timestamp_format as string || 'relative') === fmt.id;
          return (
            <div key={fmt.id} onClick={() => { save('timestamp_format', fmt.id); localStorage.setItem('d_timestamp_format', fmt.id); tzCtx.setTimestampFormat(fmt.id); }}
              style={{ flex: 1, padding: '10px 8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? 'rgba(124,58,237,0.06)' : 'transparent' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: active ? T.ac : T.tx }}>{fmt.label}</div>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 2, fontFamily: 'monospace' }}>{fmt.example}</div>
            </div>
          );
        })}
      </div>
    )}

    <div style={{ display: sectionVisible('display-options') ? undefined : 'none' }}>
    <div data-section="display-options" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Display Options</div>
    {[
      { key: 'compact_mode',       label: 'Compact Mode',                    desc: 'Reduce padding and margins throughout the UI',                          setting: true  },
      { key: 'd_show_embeds',      label: 'Show Link Previews',              desc: 'Preview links with title, description, and images',                     local: true,   def: true },
      { key: 'd_show_avatars',     label: 'Show Avatars in Chat',            desc: 'Display user avatars next to messages',                                 local: true,   def: true },
      { key: 'd_show_timestamps',  label: 'Show Timestamps',                 desc: 'Display time next to every message',                                    local: true,   def: true },
      { key: 'd_show_join_leave',  label: 'Show Join/Leave Messages',        desc: 'Display system messages when users join or leave',                      local: true,   def: true },
      { key: 'd_animate_emoji',    label: 'Animate Emoji',                   desc: 'Play animated emoji and GIFs automatically',                            local: true,   def: true },
      { key: 'd_show_typing',      label: 'Show Typing Indicators',          desc: 'See when others are typing in a channel',                               local: true,   def: true },
      { key: 'd_sticker_preview',  label: 'Sticker & Emoji Previews',        desc: 'Show larger previews when hovering emoji/stickers',                     local: true,   def: true },
      { key: 'd_smooth_scroll',    label: 'Smooth Scrolling',                desc: 'Enable smooth scroll animations in chat',                               local: true,   def: true },
      { key: 'd_slash_suggestions',label: 'Slash Command Suggestions',       desc: 'Show autocomplete dropdown when typing / commands',                     local: true,   def: true },
      { key: 'd_show_recent_emoji',label: 'Show Recently Used Emojis',       desc: 'Show your recently used emojis section in the emoji picker',            local: true,   def: true },
      { key: 'd_twemoji_render',   label: 'Twemoji Rendering',               desc: 'Render emojis as Twemoji images (fixes flags on Windows)',              local: true,   def: true },
    ].map(opt => {
      const val = (opt as any).local
        ? localStorage.getItem(opt.key) !== ((opt as any).def ? 'false' : 'true')
        : ((opt as any).def ? s[opt.key] !== false : !!s[opt.key]);
      return (
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 4 }}>
          <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
          <div onClick={() => { if ((opt as any).local) { localStorage.setItem(opt.key, val ? 'false' : 'true'); } else { save(opt.key, !val); } }}
            style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
      );
    })}
    </div>

    {/* ── Nighttime Mode ── */}
    <NighttimeModeSection s={s} save={save} />
  </>);
}

// ─── Nighttime Mode Section ──────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function NighttimeModeSection({ s, save }: { s: Record<string, unknown>; save: (k: string, v: unknown) => void }) {
  const [cfg, setCfg] = useState<NighttimeConfig>(loadNightConfig);
  const [sessionOff, setSessionOff] = useState(hasSessionOverride);
  const active = shouldActivate(cfg);

  const update = (patch: Partial<NighttimeConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    saveNightConfig(next);
    save('nighttime_mode', next);
  };

  const toggleDay = (i: number) => {
    const days = [...cfg.days];
    days[i] = !days[i];
    update({ days });
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><I.Moon s={12} /></span> Nighttime Mode
      </div>

      {/* Master toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: T.sf2, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Enable Nighttime Mode</div>
          <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>Automatically switch to dark theme, mute notifications, and reduce blue light on a schedule.</div>
        </div>
        <div onClick={() => update({ enabled: !cfg.enabled })}
          style={{ width: 36, height: 20, borderRadius: 10, background: cfg.enabled ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: cfg.enabled ? 18 : 2, transition: 'left 0.2s' }} />
        </div>
      </div>

      {/* Status + quick actions */}
      {cfg.enabled && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {active && !sessionOff && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'rgba(155,89,182,0.1)', border: '1px solid rgba(155,89,182,0.25)', borderRadius: 6, fontSize: 11, color: '#9b59b6', fontWeight: 600 }}>
              <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 3 }}><I.Moon s={11} /></span> Active now
            </div>
          )}
          {!active && (
            <button onClick={() => { activateNow(cfg); setCfg({ ...cfg }); }}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.ac, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Turn on now
            </button>
          )}
          {active && !sessionOff && (
            <button onClick={() => { overrideSession(); setSessionOff(true); }}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.mt, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Stay in day mode this session
            </button>
          )}
          {sessionOff && (
            <button onClick={() => { clearSessionOverride(); setSessionOff(false); }}
              style={{ padding: '6px 12px', borderRadius: 6, border: `1px solid ${T.bd}`, background: T.bg, color: T.ac, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Resume nighttime mode
            </button>
          )}
        </div>
      )}

      {/* Configuration panel — only when master toggle is ON */}
      {cfg.enabled && (
        <div style={{ padding: 14, background: T.sf2, borderRadius: 10, border: `1px solid ${T.bd}` }}>
          {/* Schedule */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Schedule</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: T.mt, marginBottom: 4 }}>Bedtime</label>
              <input type="time" value={cfg.bedtime} onChange={e => update({ bedtime: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                aria-label="Bedtime" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: T.mt, marginBottom: 4 }}>Wake up</label>
              <input type="time" value={cfg.wakeup} onChange={e => update({ wakeup: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', color: T.tx, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                aria-label="Wake up time" />
            </div>
          </div>

          {/* Days */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={d} onClick={() => toggleDay(i)}
                style={{
                  flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 6, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600,
                  background: cfg.days[i] ? ta(T.ac, '18') : T.bg,
                  color: cfg.days[i] ? T.ac : T.mt,
                  border: `1px solid ${cfg.days[i] ? ta(T.ac, '44') : T.bd}`,
                }}
                aria-label={d} aria-pressed={cfg.days[i]}>
                {d}
              </div>
            ))}
          </div>

          {/* Notification behavior */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Notification Behavior</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
            {([
              { id: 'normal' as const, label: 'Normal', desc: 'No change to notifications' },
              { id: 'muted' as const, label: 'Muted', desc: 'Suppress sounds and toasts — badge counts still update' },
              { id: 'priority_only' as const, label: 'Priority Only', desc: 'Only starred/favorited contacts trigger notifications' },
            ]).map(opt => (
              <div key={opt.id} onClick={() => update({ notifBehavior: opt.id })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  background: cfg.notifBehavior === opt.id ? ta(T.ac, '08') : T.bg,
                  border: `1px solid ${cfg.notifBehavior === opt.id ? ta(T.ac, '33') : T.bd}`,
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                }}>
                <div style={{
                  width: 16, height: 16, borderRadius: 'var(--radius-md)',
                  border: `2px solid ${cfg.notifBehavior === opt.id ? T.ac : T.bd}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  {cfg.notifBehavior === opt.id && <div style={{ width: 8, height: 8, borderRadius: 4, background: T.ac }} />}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: cfg.notifBehavior === opt.id ? T.tx : T.mt }}>{opt.label}</div>
                  <div style={{ fontSize: 10, color: T.mt }}>{opt.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Blue Light Reduction */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Blue Light Reduction</div>
              <div style={{ fontSize: 10, color: T.mt, marginTop: 2 }}>Apply a warm amber filter to reduce eye strain at night</div>
            </div>
            <div onClick={() => update({ blueLightReduction: !cfg.blueLightReduction })}
              style={{ width: 36, height: 20, borderRadius: 10, background: cfg.blueLightReduction ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
              <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: cfg.blueLightReduction ? 18 : 2, transition: 'left 0.2s' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
