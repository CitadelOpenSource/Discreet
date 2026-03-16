import React from 'react';
import { T, getInp } from '../../theme';
import { api } from '../../api/CitadelAPI';
import { previewSound, SOUND_OPTIONS } from '../../utils/sounds';

interface UserSettings { [key: string]: unknown; }

interface NotifState {
  sounds: boolean; soundSend: boolean; soundReceive: boolean;
  soundVoice: boolean; soundMention: boolean; desktop: boolean;
  desktopPerm: NotificationPermission; desktopLevel: string;
  group: boolean; dnd: boolean; dndSchedule: boolean;
  dndStart: string; dndEnd: string; dndDays: string;
  mentionsOnly: boolean; vol: number;
}

export interface SettingsNotificationsProps {
  s: UserSettings;
  save: (k: string, v: unknown) => void;
  sel: React.CSSProperties;
  ns: NotifState;
  setN: <K extends keyof NotifState>(key: K, val: NotifState[K], lsKey: string) => void;
  setNs: React.Dispatch<React.SetStateAction<NotifState>>;
  requestDesktopPermission: () => void;
  toggleMuteServer: (sid: string) => void;
  toggleMentionServer: (sid: string) => void;
  muteServerIds: string[];
  mentionServerIds: string[];
  notifServers: { id: string; name: string; icon_url?: string }[];
  Toggle: React.ComponentType<{ on: boolean; onToggle: () => void; disabled?: boolean }>;
  NRow: React.ComponentType<{ label: string; sub: string; on: boolean; onToggle: () => void; disabled?: boolean }>;
  notifSound: { play: (type: string) => void };
}

export default function SettingsNotifications({
  s, save, sel, ns, setN, setNs, requestDesktopPermission,
  toggleMuteServer, toggleMentionServer, muteServerIds, mentionServerIds,
  notifServers, Toggle, NRow, notifSound,
}: SettingsNotificationsProps) {
  return (<>
    {/* Global level */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Message Notifications</div>
    <div style={{ marginBottom: 6 }}>
      <label style={{ fontSize: 12, color: T.mt, display: 'block', marginBottom: 4 }}>Default notification level</label>
      <select style={{ ...sel, marginBottom: 0 }} value={(s?.notification_level as string) || 'all'} onChange={e => save('notification_level', e.target.value)}>
        <option value="all">All messages</option>
        <option value="mentions">Mentions only</option>
        <option value="nothing">Nothing</option>
      </select>
    </div>
    <NRow label="Mentions-only mode" sub="Only show a badge/alert when you are directly @mentioned" on={ns.mentionsOnly} onToggle={() => setN('mentionsOnly', !ns.mentionsOnly, 'd_notif_mentions_only')} />
    <NRow label="Group notifications" sub="Bundle multiple messages from the same channel into one alert" on={ns.group} onToggle={() => setN('group', !ns.group, 'd_notif_group')} />

    {/* Sound alerts */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Sound Alerts</div>
    <NRow label="Enable sounds" sub="Master switch for all notification tones" on={ns.sounds} onToggle={() => setN('sounds', !ns.sounds, 'd_sounds')} />

    {ns.sounds && (<>
      <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.tx, marginBottom: 8 }}>Volume</div>
        <input type="range" min="0" max="100" value={Math.round(ns.vol * 100)}
          onChange={e => { const v = parseInt(e.target.value) / 100; setNs(p => ({ ...p, vol: v })); localStorage.setItem('d_notif_vol', v.toFixed(2)); }}
          style={{ width: '100%', accentColor: T.ac } as React.CSSProperties} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.mt, marginTop: 2 }}>
          <span>0%</span><span>{Math.round(ns.vol * 100)}%</span><span>100%</span>
        </div>
      </div>

      {([
        { key: 'soundSend',    lsKey: 'd_sound_send',           label: 'Message send',      sub: 'Short blip when you send a message',          test: 'send'    },
        { key: 'soundReceive', lsKey: 'd_sound_receive',        label: 'Message receive',   sub: 'Tone when a new message arrives',              test: 'message' },
        { key: 'soundMention', lsKey: 'd_notif_sound_mention',  label: 'Mention',           sub: 'Distinct chime when you are @mentioned',       test: 'mention' },
        { key: 'soundVoice',   lsKey: 'd_sound_voice',          label: 'Voice join / leave', sub: 'Sounds when users enter or leave voice chat', test: 'join'    },
      ] as const).map(opt => (
        <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>{opt.label}</div>
            <div style={{ fontSize: 11, color: T.mt }}>{opt.sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
            <button onClick={() => notifSound.play(opt.test)} title="Preview sound"
              style={{ background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 5, color: T.mt, cursor: 'pointer', fontSize: 10, padding: '3px 8px' }}>
              &#9654; Test
            </button>
            <Toggle on={ns[opt.key]} onToggle={() => setN(opt.key, !ns[opt.key], opt.lsKey)} />
          </div>
        </div>
      ))}

      {/* Sound customization */}
      <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 16 }}>Sound Style</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 6 }}>
        {([
          { key: 'sound_dm',      lsKey: 'd_sound_dm',      label: 'DM Sound' },
          { key: 'sound_server',  lsKey: 'd_sound_server',  label: 'Server Message' },
          { key: 'sound_mention', lsKey: 'd_sound_mention', label: '@Mention' },
        ] as const).map(opt => (
          <div key={opt.key}>
            <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>{opt.label}</label>
            <select style={sel} value={(s[opt.key] as string) || 'default'}
              onChange={e => { const v = e.target.value; save(opt.key, v); localStorage.setItem(opt.lsKey, v); previewSound(v as any); }}>
              {SOUND_OPTIONS.map(so => (<option key={so.value} value={so.value}>{so.label}</option>))}
            </select>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: T.mt, lineHeight: 1.5, padding: '4px 0' }}>
        Sounds are synthesized locally — no audio files are downloaded.
      </div>
    </>)}

    {/* Desktop notifications */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Desktop Notifications</div>
    <div style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ns.desktopPerm !== 'granted' ? 8 : 0 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Browser permission</div>
          <div style={{ fontSize: 11, color: ns.desktopPerm === 'granted' ? '#3ba55d' : ns.desktopPerm === 'denied' ? T.err : T.mt }}>
            {ns.desktopPerm === 'granted' ? '\u2713 Granted' : ns.desktopPerm === 'denied' ? '\u2715 Denied \u2014 change in browser settings' : '\u26a0 Not yet requested'}
          </div>
        </div>
        {ns.desktopPerm !== 'granted' && ns.desktopPerm !== 'denied' && (
          <button onClick={requestDesktopPermission}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: T.ac, color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Allow
          </button>
        )}
      </div>
    </div>
    <NRow label="Enable desktop notifications" sub="Show OS notifications when Discreet is in the background"
      on={ns.desktop && ns.desktopPerm === 'granted'} disabled={ns.desktopPerm !== 'granted'}
      onToggle={() => ns.desktopPerm === 'granted' && setN('desktop', !ns.desktop, 'd_notif_desktop')} />
    {ns.desktop && ns.desktopPerm === 'granted' && (
      <div style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: T.mt, display: 'block', marginBottom: 4 }}>Show desktop notification for</label>
        <select style={{ ...sel, marginBottom: 0 }} value={ns.desktopLevel}
          onChange={e => setN('desktopLevel', e.target.value as typeof ns.desktopLevel, 'd_notif_desktop_level')}>
          <option value="all">All messages</option><option value="mentions">Mentions only</option><option value="dms">DMs only</option>
        </select>
      </div>
    )}

    {/* Do Not Disturb */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Do Not Disturb</div>
    <NRow label="Manual DND override" sub="Immediately suppress all notifications (overrides schedule)" on={ns.dnd} onToggle={() => setN('dnd', !ns.dnd, 'd_notif_dnd')} />
    {ns.dnd && (
      <div style={{ padding: '8px 14px', background: 'rgba(237,66,69,0.08)', borderRadius: 8, border: '1px solid rgba(237,66,69,0.2)', marginBottom: 6, fontSize: 11, color: '#ed4245', display: 'flex', alignItems: 'center', gap: 6 }}>
        DND is active — all notifications suppressed except DM @mentions.
      </div>
    )}
    <div style={{ padding: '14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.tx }}>Scheduled quiet hours</div>
          <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>Automatically enable DND during these times. DM @mentions still come through.</div>
        </div>
        <Toggle on={ns.dndSchedule} onToggle={() => { const next = !ns.dndSchedule; setN('dndSchedule', next, 'd_notif_dnd_schedule'); save('dnd_enabled', next); }} />
      </div>
      {ns.dndSchedule && (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>Start</label>
            <input type="time" value={ns.dndStart} onChange={e => { setN('dndStart', e.target.value, 'd_notif_dnd_start'); save('dnd_start', e.target.value); }}
              style={{ ...getInp(), marginBottom: 0, width: '100%', boxSizing: 'border-box' } as React.CSSProperties} />
          </div>
          <div style={{ color: T.mt, fontSize: 13, paddingTop: 18 }}>&rarr;</div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: T.mt, display: 'block', marginBottom: 3 }}>End</label>
            <input type="time" value={ns.dndEnd} onChange={e => { setN('dndEnd', e.target.value, 'd_notif_dnd_end'); save('dnd_end', e.target.value); }}
              style={{ ...getInp(), marginBottom: 0, width: '100%', boxSizing: 'border-box' } as React.CSSProperties} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: T.mt, marginBottom: 6 }}>Active on:</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
            const activeDays = ns.dndDays.split(',').map(Number);
            const isActive = activeDays.includes(i);
            return (
              <div key={day} onClick={() => {
                const next = isActive ? activeDays.filter(d => d !== i) : [...activeDays, i].sort();
                const daysStr = next.join(',');
                setN('dndDays', daysStr, 'd_notif_dnd_days');
                save('dnd_days', daysStr);
              }} style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: isActive ? `${T.ac}22` : T.bg, color: isActive ? T.ac : T.mt,
                border: `1px solid ${isActive ? T.ac : T.bd}`, transition: 'all .15s',
              }}>{day}</div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: T.mt, marginTop: 8 }}>
          {ns.dndStart} — {ns.dndEnd} on selected days. Synced to your account.
        </div>
      </>)}
    </div>

    {/* @everyone suppression */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Mention Controls</div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.tx }}>Suppress @everyone and @here</div>
        <div style={{ fontSize: 11, color: T.mt, lineHeight: 1.4, marginTop: 2 }}>The text still shows, but you won't get pinged or notified. Applies to all servers.</div>
      </div>
      <div onClick={() => save('suppress_all_everyone', !(s.suppress_all_everyone === true))} role="switch" aria-checked={s.suppress_all_everyone === true} style={{ width: 36, height: 20, borderRadius: 10, background: s.suppress_all_everyone === true ? T.ac : '#555', cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 2, left: s.suppress_all_everyone === true ? 18 : 2, transition: 'left 0.2s' }} />
      </div>
    </div>

    {/* Per-server mute */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Per-Server Settings</div>
    {notifServers.length === 0 && (
      <div style={{ fontSize: 12, color: T.mt, textAlign: 'center', padding: '16px 0' }}>No servers — join one to configure per-server notifications.</div>
    )}
    {notifServers.map(sv => {
      const muted      = muteServerIds.includes(sv.id);
      const mentionOnly = mentionServerIds.includes(sv.id);
      return (
        <div key={sv.id} style={{ padding: '10px 14px', background: T.sf2, borderRadius: 8, border: `1px solid ${T.bd}`, marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: sv.icon_url ? 'transparent' : `${T.ac}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: T.ac, overflow: 'hidden', flexShrink: 0 }}>
              {sv.icon_url ? <img src={sv.icon_url} alt="" style={{ width: 28, height: 28, objectFit: 'cover' }} /> : sv.name[0]?.toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: muted ? T.mt : T.tx, flex: 1 }}>{sv.name}</span>
            {muted && <span style={{ fontSize: 10, color: T.mt, background: T.bg, border: `1px solid ${T.bd}`, borderRadius: 4, padding: '1px 6px' }}>Muted</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: T.tx }}>Mute server</span>
              <Toggle on={muted} onToggle={() => toggleMuteServer(sv.id)} />
            </div>
            {!muted && (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: T.tx }}>Mentions only</span>
                <Toggle on={mentionOnly} onToggle={() => toggleMentionServer(sv.id)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: T.tx }}>Event reminders</span>
                <Toggle on={localStorage.getItem(`d_event_reminders_${sv.id}`) !== 'false'} onToggle={() => {
                  const key = `d_event_reminders_${sv.id}`;
                  const cur = localStorage.getItem(key) !== 'false';
                  localStorage.setItem(key, cur ? 'false' : 'true');
                  api.fetch(`/servers/${sv.id}/notification-settings`, { method: 'PATCH', body: JSON.stringify({ event_reminders: !cur }) }).catch(() => {});
                }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: T.tx }}>Email reminders</span>
                <Toggle on={localStorage.getItem(`d_email_reminders_${sv.id}`) === 'true'} onToggle={() => {
                  const key = `d_email_reminders_${sv.id}`;
                  const cur = localStorage.getItem(key) === 'true';
                  localStorage.setItem(key, cur ? 'false' : 'true');
                  api.fetch(`/servers/${sv.id}/notification-settings`, { method: 'PATCH', body: JSON.stringify({ email_reminders: !cur }) }).catch(() => {});
                }} />
              </div>
            </>)}
          </div>
        </div>
      );
    })}

    {/* Status & Presence */}
    <div style={{ fontSize: 11, fontWeight: 700, color: T.mt, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 20 }}>Status & Presence</div>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Auto-Idle Timeout</div>
      <select style={sel} value={localStorage.getItem('d_idle_timeout') || '300'} onChange={e => localStorage.setItem('d_idle_timeout', e.target.value)}>
        <option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes (default)</option>
        <option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option>
        <option value="3600">1 hour</option><option value="0">Never (stay online)</option>
      </select>
      <div style={{ fontSize: 10, color: T.mt, marginTop: 4 }}>Automatically switch to Idle after this much inactivity.</div>
    </div>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: T.tx, marginBottom: 4 }}>Show Media Automatically</div>
      {[
        { key: 'd_show_images', label: 'Auto-show images in chat' },
        { key: 'd_show_videos', label: 'Auto-play videos in chat'  },
      ].map(opt => {
        const val = localStorage.getItem(opt.key) !== 'false';
        return (
          <div key={opt.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: T.sf2, borderRadius: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: T.tx }}>{opt.label}</span>
            <Toggle on={val} onToggle={() => localStorage.setItem(opt.key, val ? 'false' : 'true')} />
          </div>
        );
      })}
    </div>
  </>);
}
