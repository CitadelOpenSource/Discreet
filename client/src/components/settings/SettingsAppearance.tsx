import React, { useState, useRef } from 'react';
import { T, ta, PRESETS, getThemeName, setTheme, getTheme, exportTheme, validateCustomTheme, applyCustomTheme, loadCustomTheme, previewTheme, revertPreview, type ThemeRaw } from '../../theme';
import { useTimezone, detectedTimezone } from '../../hooks/TimezoneContext';
import { api } from '../../api/CitadelAPI';

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

export default function SettingsAppearance({ s, save, sel, sectionVisible, setSaved }: SettingsAppearanceProps) {
  const tzCtx = useTimezone();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErr, setImportErr] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [draft, setDraft] = useState<ThemeRaw>(() => loadCustomTheme() || getTheme());
  const [editorDirty, setEditorDirty] = useState(false);

  return (<>
    <div style={{ display: sectionVisible('theme') ? undefined : 'none' }}>
    <div data-section="theme" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Theme</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
      {PRESETS.map(p => {
        const active = getThemeName() === p.id;
        const c = p.colors;
        return (
          <div key={p.id}
            onClick={() => { setTheme(p.id); save('theme', p.id); }}
            style={{
              cursor: 'pointer', borderRadius: 10, overflow: 'hidden',
              border: active ? `2px solid ${c.ac}` : `2px solid ${c.bd}`,
              transition: 'border-color .15s',
            }}>
            {/* Live preview mini-mockup */}
            <div style={{ display: 'flex', height: 72, background: c.bg }}>
              {/* Sidebar */}
              <div style={{ width: 40, background: c.sf, borderRight: `1px solid ${c.bd}`, padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ width: 20, height: 20, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 6) : 6, background: c.sf2, margin: '0 auto' }} />
                <div style={{ width: 20, height: 20, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 6) : 6, background: c.ac, margin: '0 auto', opacity: 0.3 }} />
                <div style={{ width: 20, height: 20, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 6) : 6, background: c.sf2, margin: '0 auto' }} />
              </div>
              {/* Chat area */}
              <div style={{ flex: 1, padding: 6, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 3 }}>
                {/* Fake message lines */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {!p.hideAvatars && <div style={{ width: 10, height: 10, borderRadius: 5, background: c.mt, flexShrink: 0 }} />}
                  <div style={{ height: 6, width: '70%', background: c.mt, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 3) : 3, opacity: 0.4 }} />
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {!p.hideAvatars && <div style={{ width: 10, height: 10, borderRadius: 5, background: c.ac, flexShrink: 0 }} />}
                  <div style={{ height: 6, width: '50%', background: c.ac, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 3) : 3, opacity: 0.5 }} />
                </div>
                {/* Input bar */}
                <div style={{ height: 10, background: c.sf2, borderRadius: p.borderRadius != null ? Math.min(p.borderRadius, 4) : 4, border: `1px solid ${c.bd}`, marginTop: 2 }} />
              </div>
            </div>
            {/* Label */}
            <div style={{ padding: '8px 10px', background: c.sf, borderTop: `1px solid ${c.bd}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: active ? c.ac : c.tx, fontFamily: p.font || 'inherit' }}>{p.name}</div>
                {active && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, background: c.ac, color: c.bg, fontWeight: 700 }}>ACTIVE</span>}
              </div>
              <div style={{ fontSize: 10, color: c.mt, marginTop: 2 }}>{p.description}</div>
            </div>
          </div>
        );
      })}
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
      }} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
        Export Theme
      </button>
      <button onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: T.sf2, color: T.tx, border: `1px solid ${T.bd}` }}>
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
        style={{ width: '100%', padding: '9px 0', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
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
          <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${draft.bd}`, marginBottom: 12 }}>
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
            width: '100%', padding: '9px 0', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: editorDirty ? 'pointer' : 'not-allowed',
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
          <option value="dm-sans">DM Sans (Default)</option><option value="inter">Inter</option><option value="system">System UI</option><option value="mono">JetBrains Mono</option><option value="serif">Georgia (Serif)</option>
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
                style={{ flex: 1, padding: '12px 10px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}` }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Chat Bubbles</div>
            <div style={{ fontSize: 10, color: T.mt, marginTop: 2, lineHeight: 1.4 }}>Show messages in rounded bubbles — your messages colored, others neutral</div>
          </div>
          <div onClick={() => { const next = !(s.chat_bubbles === true); save('chat_bubbles', next); localStorage.setItem('d_chat_bubbles', String(next)); }}
            style={{ width: 36, height: 20, borderRadius: 10, background: s.chat_bubbles === true ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: s.chat_bubbles === true ? 18 : 2, transition: 'left 0.2s' }} />
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
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${active ? T.ac : T.bd}`, background: active ? 'rgba(0,212,170,0.06)' : 'transparent', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: active ? T.ac : T.tx }}>{bp.label}</div>
                  <div style={{ fontSize: 9, color: T.mt, marginTop: 2 }}>{bp.desc}</div>
                </div>
              );
            })}
          </div>
        )}
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
        <div style={{ marginTop: 8, padding: '10px 12px', background: T.bg, borderRadius: 8, border: `1px solid ${T.bd}` }}>
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
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
          <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt, marginTop: 1 }}>{opt.desc}</div></div>
          <div onClick={() => { if ((opt as any).local) { localStorage.setItem(opt.key, val ? 'false' : 'true'); } else { save(opt.key, !val); } }}
            style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
      );
    })}
    </div>
  </>);
}
