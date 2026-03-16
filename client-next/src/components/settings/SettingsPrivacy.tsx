import React from 'react';
import { T } from '../../theme';
import * as I from '../../icons';
import { OfflineContacts } from '../OfflineContacts';

interface UserSettings { [key: string]: unknown; }

export interface SettingsPrivacyProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sel: React.CSSProperties;
  sectionVisible: (section: string) => boolean;
}

export default function SettingsPrivacy({ s, save, sel, sectionVisible }: SettingsPrivacyProps) {
  return (<>
    <div style={{ display: sectionVisible('privacy') ? undefined : 'none' }}>
    <div data-section="privacy" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Privacy</div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Who can DM me</label>
        <select style={sel} value={(s.dm_privacy as string) || 'everyone'} onChange={e => save('dm_privacy', e.target.value)}>
          <option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">Nobody</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Friend requests</label>
        <select style={sel} value={(s.friend_request_privacy as string) || 'everyone'} onChange={e => save('friend_request_privacy', e.target.value)}>
          <option value="everyone">Everyone</option><option value="friends_of_friends">Friends of friends</option><option value="nobody">Nobody</option>
        </select>
      </div>
      <div><label style={{ fontSize: 12, color: T.mt, marginBottom: 4, display: 'block' }}>Default Online Status</label>
        <select style={sel} value={(s.default_status as string) || 'online'} onChange={e => save('default_status', e.target.value)}>
          <option value="online">Online</option>
          <option value="idle">Idle</option>
          <option value="invisible">Invisible</option>
        </select>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Your status on servers without a per-server override. Right-click a server icon to set per-server appearance.</div>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Show Shared Servers</div>
        <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>Let others see which servers you both share when they search for you.</div>
      </div>
      <div onClick={() => save('show_shared_servers', !(s.show_shared_servers === true))} style={{ width: 36, height: 20, borderRadius: 10, background: s.show_shared_servers === true ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: s.show_shared_servers === true ? 18 : 2, transition: 'left 0.2s' }} />
      </div>
    </div>
    {/* Privacy Toggles (privacy-first defaults: all OFF) */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Communication Privacy</div>
    {[
      { key: 'show_read_receipts',    label: 'Show Read Receipts',    desc: 'Let others know when you\'ve read their messages. When off, you also cannot see others\' read status (mutual).', def: false },
      { key: 'show_typing_indicator',  label: 'Show Typing Indicator', desc: 'Let others see when you\'re typing. The server will not broadcast your typing events when off.', def: false },
      { key: 'show_link_previews',     label: 'Link Previews',         desc: 'Show rich previews for URLs in messages. Previews are generated client-side only — URLs are never sent to the server.', def: false },
    ].map(opt => {
      const val = s[opt.key] !== undefined ? !!s[opt.key] : opt.def;
      return (
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
          <div><div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div><div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>{opt.desc}</div></div>
          <div onClick={() => save(opt.key, !val)} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.2s' }} />
          </div>
        </div>
      );
    })}
    </div>
    <div style={{ display: sectionVisible('interaction') ? undefined : 'none' }}>
    <div data-section="interaction" style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Interaction Controls</div>
    {[
      { key: 'hide_online_status',      label: 'Hide Online Status from Non-Friends',        desc: 'Only friends can see when you\'re online, idle, or DND.', def: true },
      { key: 'hide_activity',            label: 'Hide Activity from Non-Friends',             desc: "Don't show what server you're in or what you're doing to non-friends.", def: true },
      { key: 'block_stranger_dms',       label: 'Block DMs from Server Strangers',            desc: 'People you share a server with but aren\'t friends with cannot DM you.', def: true },
      { key: 'require_mutual_friends',   label: 'Require Mutual Friends for Friend Requests', desc: 'Only allow friend requests from people who share a mutual friend with you.', def: false },
    ].map(opt => {
      const val = s[opt.key] !== undefined ? !!s[opt.key] : opt.def;
      return (
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
          <div><div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div><div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>{opt.desc}</div></div>
          <div onClick={() => save(opt.key, !val)} style={{ width: 36, height: 20, borderRadius: 10, background: val ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.2s' }} />
          </div>
        </div>
      );
    })}
    <div style={{ padding: '8px 12px', background: T.bg, borderRadius: 6, fontSize: 11, color: T.mt, lineHeight: 1.5, marginTop: 8 }}>
      <I.Shield /> Discreet respects your privacy. Shared server info is never publicly exposed.
    </div>
    </div>
    <OfflineContacts />
  </>);
}
