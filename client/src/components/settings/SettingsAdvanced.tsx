import React from 'react';
import { T, ta } from '../../theme';

export interface SettingsAdvancedProps {
  sel: React.CSSProperties;
  curServer?: { id: string } | null;
  DevTools: React.ComponentType<{ curServer?: { id: string } | null }>;
}

export default function SettingsAdvanced({ sel, curServer, DevTools }: SettingsAdvancedProps) {
  return (<>
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Advanced Settings</div>
    <div style={{ fontSize: 11, color: (T as any).warn, marginBottom: 12, padding: '8px 12px', background: 'rgba(250,166,26,0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(250,166,26,0.15)' }}>Warning: Power user settings. Incorrect changes may affect performance.</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>WS Reconnect</label>
        <select style={sel} value={localStorage.getItem('d_ws_reconnect') || '3000'} onChange={e => localStorage.setItem('d_ws_reconnect', e.target.value)}>
          <option value="1000">1s (aggressive)</option><option value="3000">3s (default)</option><option value="5000">5s</option><option value="10000">10s (saver)</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Message Cache</label>
        <select style={sel} value={localStorage.getItem('d_msg_cache') || '200'} onChange={e => localStorage.setItem('d_msg_cache', e.target.value)}>
          <option value="50">50 msgs</option><option value="100">100 msgs</option><option value="200">200 (default)</option><option value="500">500 msgs</option><option value="1000">1000 msgs</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Image Quality</label>
        <select style={sel} value={localStorage.getItem('d_img_quality') || 'high'} onChange={e => localStorage.setItem('d_img_quality', e.target.value)}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High (default)</option><option value="original">Original</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Max Upload</label>
        <div style={{ padding: '8px 12px', background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}`, fontSize: 12, color: T.ac, fontFamily: 'monospace' }}>50 MB</div>
      </div>
    </div>
    {[
      { key: 'd_dev_tools',    label: 'Developer Mode',          desc: 'Show IDs and API debug info' },
      { key: 'd_raw_cipher',   label: 'Show Raw Ciphertext',      desc: 'Display encrypted data alongside decrypted messages' },
      { key: 'd_perf_overlay', label: 'Performance Overlay',      desc: 'FPS, memory, WebSocket latency' },
      { key: 'd_verbose_log',  label: 'Verbose Console Logs',     desc: 'Log all API calls and WS events' },
      { key: 'd_experimental', label: 'Experimental Features',    desc: 'Enable unstable features in development' },
    ].map(opt => {
      const val = localStorage.getItem(opt.key) === 'true';
      return (
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: T.sf2, borderRadius: 'var(--radius-md)', marginBottom: 3 }}>
          <div><div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>{opt.label}</div><div style={{ fontSize: 10, color: T.mt }}>{opt.desc}</div></div>
          <div onClick={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : T.bd, cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0, marginInlineStart: 12}}>
            <div style={{ width: 16, height: 16, borderRadius: 'var(--radius-md)', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </div>
        </div>
      );
    })}
    <div style={{ marginTop: 12, padding: 10, background: T.bg, borderRadius: 'var(--radius-md)', border: `1px solid ${T.bd}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.err, textTransform: 'uppercase', marginBottom: 8 }}>Danger Zone</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => { if (confirm('Clear ALL local settings?')) { localStorage.clear(); window.location.reload(); } }} className="pill-btn" style={{ background: 'rgba(255,71,87,0.1)', color: T.err, border: '1px solid rgba(255,71,87,0.3)', padding: '5px 12px', fontSize: 10 }}>Reset All Settings</button>
        <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localStorage))} className="pill-btn" style={{ background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, padding: '5px 12px', fontSize: 10 }}>Export Settings</button>
      </div>
    </div>
    {localStorage.getItem('d_dev_tools') === 'true' && (
      <div style={{ marginTop: 16, padding: 12, background: T.bg, borderRadius: 10, border: `1px solid ${ta(T.ac,'22')}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.ac, textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>Developer Tools</div>
        <div style={{ fontSize: 11, color: T.mt, marginBottom: 10 }}>API testing and debugging tools. Available to verified accounts on their own servers.</div>
        <DevTools curServer={curServer} />
      </div>
    )}
  </>);
}
