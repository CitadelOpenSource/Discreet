import React from 'react';
import { T } from '../../theme';
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

export default function SettingsAppearance({ s, save, sel, sectionVisible, setSaved }: SettingsAppearanceProps) {
  const tzCtx = useTimezone();

  return (<>
    <div style={{ display: sectionVisible('theme') ? undefined : 'none' }}>
    <div data-section="theme" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Theme & Colors</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Theme</label>
        <select style={sel} value={(s.theme as string) || 'dark'} onChange={e => save('theme', e.target.value)}>
          <option value="dark">Dark</option><option value="onyx">Onyx (OLED Black)</option><option value="light">Light</option><option value="midnight">Midnight</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Accent Color</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {['#00d4aa', '#7289da', '#ff6b6b', '#faa61a', '#43b581', '#e91e63', '#9b59b6', '#1abc9c'].map(c => (
            <div key={c} onClick={() => localStorage.setItem('d_accent', c)} style={{ width: 24, height: 24, borderRadius: 12, background: c, cursor: 'pointer', border: localStorage.getItem('d_accent') === c ? '2px solid #fff' : '2px solid transparent' }} />
          ))}
        </div>
      </div>
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
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Message Density</label>
        <select style={sel} value={(s.message_density as string) || 'comfortable'} onChange={e => { save('message_density', e.target.value); localStorage.setItem('d_msg_density', e.target.value); }}>
          <option value="comfortable">Comfortable (default)</option>
          <option value="compact">Compact</option>
          <option value="cozy">Cozy</option>
        </select>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>
          {((s.message_density as string) || 'comfortable') === 'compact' ? '2px gap, 28px avatars, inline timestamp' : ((s.message_density as string) || 'comfortable') === 'cozy' ? '12px gap, 44px avatars, spacious layout' : '8px gap, 36px avatars, balanced layout'}
        </div>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Chat Width</label>
        <select style={sel} value={localStorage.getItem('d_chat_width') || 'normal'} onChange={e => localStorage.setItem('d_chat_width', e.target.value)}>
          <option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option><option value="full">Full Width</option>
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Chat Font Size: {(s.chat_font_size as number) || 14}px</label>
        <input
          type="range" min="12" max="20" step="1"
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
          <span>12px</span><span>14px</span><span>16px</span><span>18px</span><span>20px</span>
        </div>
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
