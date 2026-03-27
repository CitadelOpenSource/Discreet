/**
 * CalendarView — Monthly calendar with server + personal events.
 *
 * Features:
 *  - Monthly grid, today highlighted
 *  - Server events (api.listEvents) + personal events (localStorage)
 *  - Countdown timer on upcoming events
 *  - 15-minute browser + in-app notification before meetings
 *  - Meeting code display, Join Meeting button, Copy Code button
 *  - Recurring events (daily / weekly / monthly)
 *  - 8 preset event colors
 *
 * Props:
 *   serverId       — null for personal-only calendar
 *   onJoinMeeting  — callback to open MeetingRoom with a pre-filled code
 */
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { T, ta, getInp, btn } from '../theme';
import { api } from '../api/CitadelAPI';

const MeetingRoom = lazy(() =>
  import('./MeetingRoom').then(m => ({ default: m.MeetingRoom }))
);

// ── Types ──────────────────────────────────────────────────────────────

type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
type RsvpStatus = 'going' | 'interested' | 'not_going';
type Visibility  = 'public' | 'friends' | 'private';

interface CalEvent {
  id: string;
  title: string;
  description?: string;
  start_time: string;        // ISO-8601
  end_time?: string;
  location?: string;
  visibility: Visibility;
  rsvp_enabled: boolean;
  going_count: number;
  interested_count: number;
  my_rsvp?: RsvpStatus | null;
  creator_username?: string;
  meeting_code?: string;
  color?: string;            // hex, overrides accent
  recurrence?: Recurrence;
  recurrence_group_id?: string;
  source: 'server' | 'local';
}

interface FormState {
  title: string;
  description: string;
  date: string;         // YYYY-MM-DD
  startTime: string;    // HH:MM
  endTime: string;      // HH:MM
  location: string;
  visibility: Visibility;
  rsvpEnabled: boolean;
  scheduleMeeting: boolean;
  repeat: Recurrence;
  color: string;
}

export interface CalendarViewProps {
  serverId: string | null;
  /** Optional: lifted handler so App.tsx can open MeetingRoom at top level. */
  onJoinMeeting?: (code: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────

const DAY_LABELS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const LS_EVENTS_KEY   = 'd_calendar_events';
const LS_RSVP_KEY     = 'd_event_rsvps';
const LS_NOTIFIED_KEY = 'd_cal_notified';
const LS_NOTES_PREFIX = 'd_calendar_notes_';
const LS_REMINDERS    = 'd_calendar_reminders';

const COLOR_SERVER  = '#00d4aa';
const COLOR_LOCAL   = '#faa61a';
const COLOR_MEETING = '#5865f2';

const PRESET_COLORS = [
  '#00d4aa', // teal
  '#5865f2', // indigo
  '#faa61a', // amber
  '#3ba55d', // green
  '#ed4245', // red
  '#f47fff', // pink
  '#ff7043', // orange
  '#80d8ff', // sky
];

const RECUR_COUNTS: Record<Recurrence, number> = {
  none: 1, daily: 30, weekly: 8, monthly: 6,
};

// ── Helpers ────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function eventDateKey(iso: string): string { return dateKey(new Date(iso)); }

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Returns "Starts in Xh Ym", "Starts in Xm", "Started Xm ago", or null if >48h away. */
function timeUntil(iso: string, now: Date): string | null {
  const diff = new Date(iso).getTime() - now.getTime();
  const absDiff = Math.abs(diff);
  if (absDiff > 48 * 60 * 60 * 1000) return null;
  const mins  = Math.floor(absDiff / 60_000);
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  const label = hours > 0 ? `${hours}h ${rem}m` : `${mins}m`;
  return diff > 0 ? `Starts in ${label}` : `Started ${label} ago`;
}

function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last  = new Date(year, month + 1, 0);
  const grid: Date[] = [];
  for (let i = 0; i < first.getDay(); i++) grid.push(new Date(year, month, 1 - (first.getDay() - i)));
  for (let d = 1; d <= last.getDate(); d++) grid.push(new Date(year, month, d));
  while (grid.length < 42) grid.push(new Date(year, month + 1, grid.length - last.getDate() - first.getDay() + 1));
  return grid;
}

function expandRecurring(
  baseDateStr: string, startTime: string, endTime: string,
  repeat: Recurrence,
): Array<{ startIso: string; endIso: string }> {
  const count    = RECUR_COUNTS[repeat];
  const startMs  = new Date(`${baseDateStr}T${startTime}:00.000Z`).getTime();
  const endMs    = new Date(`${baseDateStr}T${endTime}:00.000Z`).getTime();
  const durationMs = endMs - startMs;
  const results: Array<{ startIso: string; endIso: string }> = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(`${baseDateStr}T${startTime}:00.000Z`);
    if      (repeat === 'daily')   d.setUTCDate(d.getUTCDate() + i);
    else if (repeat === 'weekly')  d.setUTCDate(d.getUTCDate() + i * 7);
    else if (repeat === 'monthly') d.setUTCMonth(d.getUTCMonth() + i);
    results.push({ startIso: d.toISOString(), endIso: new Date(d.getTime() + durationMs).toISOString() });
  }
  return results;
}

function loadLocalEvents(): CalEvent[] {
  try { return JSON.parse(localStorage.getItem(LS_EVENTS_KEY) || '[]'); } catch { return []; }
}
function saveLocalEvents(evts: CalEvent[]) {
  localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(evts));
}
function loadRsvpMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_RSVP_KEY) || '{}'); } catch { return {}; }
}
function saveRsvpMap(m: Record<string, string>) {
  localStorage.setItem(LS_RSVP_KEY, JSON.stringify(m));
}
function loadNotified(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_NOTIFIED_KEY) || '[]')); } catch { return new Set(); }
}
function saveNotified(s: Set<string>) {
  localStorage.setItem(LS_NOTIFIED_KEY, JSON.stringify([...s]));
}

interface Reminder { id: string; date: string; time: string; text: string; triggered: boolean; }
function loadReminders(): Reminder[] {
  try { return JSON.parse(localStorage.getItem(LS_REMINDERS) || '[]'); } catch { return []; }
}
function saveReminders(rs: Reminder[]) {
  localStorage.setItem(LS_REMINDERS, JSON.stringify(rs));
}

function defaultForm(day?: Date): FormState {
  return {
    title: '', description: '',
    date: day ? dateKey(day) : dateKey(new Date()),
    startTime: '10:00', endTime: '11:00',
    location: '', visibility: 'public',
    rsvpEnabled: true, scheduleMeeting: false,
    repeat: 'none', color: PRESET_COLORS[0],
  };
}

// ── Sub-components ─────────────────────────────────────────────────────

const labelSt: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: T.mt,
  textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4,
};

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: T.mt }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
      {label}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <div style={{ width: 30, height: 16, borderRadius: 'var(--radius-md)', background: value ? T.ac : T.sf2, border: `1px solid ${T.bd}`, position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 14 : 2, width: 12, height: 12, borderRadius: 6, background: value ? '#000' : T.mt, transition: 'left .2s' }} />
      </div>
      <span style={{ fontSize: 12, color: T.mt, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {PRESET_COLORS.map(c => (
        <div
          key={c}
          onClick={() => onChange(c)}
          title={c}
          style={{
            width: 22, height: 22, borderRadius: 11, background: c, cursor: 'pointer',
            border: value === c ? `3px solid ${T.tx}` : `2px solid transparent`,
            boxSizing: 'border-box', transition: 'border .1s',
          }}
        />
      ))}
    </div>
  );
}

function RsvpButtons({ eventId, rsvpEnabled, rsvpMap, onRsvp }: {
  eventId: string; rsvpEnabled: boolean;
  rsvpMap: Record<string, string>; onRsvp: (id: string, s: string) => void;
}) {
  if (!rsvpEnabled) return null;
  const current = rsvpMap[eventId] ?? null;
  const opts = [
    { label: '✓ Going',   status: 'going',     color: '#3ba55d' },
    { label: '~ Maybe',   status: 'interested', color: '#faa61a' },
    { label: "✕ Can't",  status: 'not_going',  color: '#ed4245' },
  ];
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
      {opts.map(o => (
        <button key={o.status} onClick={() => onRsvp(eventId, o.status)} style={{
          padding: '3px 10px', borderRadius: 'var(--border-radius)', fontSize: 11, fontWeight: 600,
          border: `1px solid ${current === o.status ? o.color : T.bd}`,
          background: current === o.status ? `${o.color}22` : T.sf2,
          color: current === o.status ? o.color : T.mt,
          cursor: 'pointer', transition: 'all .15s',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function AttendeeRow({ going, interested }: { going: number; interested: number }) {
  if (going + interested === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <div style={{ display: 'flex' }}>
        {Array.from({ length: Math.min(going, 5) }).map((_, i) => (
          <div key={i} style={{
            width: 18, height: 18, borderRadius: 9,
            background: `hsl(${(i * 47 + 160) % 360},60%,55%)`,
            marginLeft: i > 0 ? -5 : 0, border: `2px solid ${T.sf}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 700, color: '#fff',
          }}>{i + 1}</div>
        ))}
      </div>
      <span style={{ fontSize: 11, color: T.mt }}>
        {going > 0 && `${going} going`}
        {going > 0 && interested > 0 && ' · '}
        {interested > 0 && `${interested} interested`}
      </span>
    </div>
  );
}

function EventCard({ event, rsvpMap, now, onRsvp, onDelete, onJoinMeeting, onCopyCode, onFlash }: {
  event: CalEvent;
  rsvpMap: Record<string, string>;
  now: Date;
  onRsvp: (id: string, status: string) => void;
  onDelete?: () => void;
  onJoinMeeting?: (code: string) => void;
  onCopyCode?: (code: string) => void;
  onFlash: (msg: string) => void;
}) {
  const accent = event.color
    ? event.color
    : event.meeting_code ? COLOR_MEETING
    : event.source === 'server' ? COLOR_SERVER
    : COLOR_LOCAL;

  const countdown = timeUntil(event.start_time, now);
  const isSoon = countdown !== null && countdown.startsWith('Starts in');

  return (
    <div style={{
      background: T.sf2, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)',
      padding: '10px 12px', marginBottom: 8, borderInlineStart: `3px solid ${accent}`,
    }}>
      {/* Title + delete */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{event.title}</div>
        {onDelete && (
          <button onClick={onDelete} title="Delete" style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 16, padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>×</button>
        )}
      </div>

      {/* Time + creator */}
      <div style={{ fontSize: 11, color: T.mt, marginTop: 3 }}>
        {formatTime(event.start_time)}
        {event.end_time && ` – ${formatTime(event.end_time)}`}
        {event.creator_username && ` · ${event.creator_username}`}
        {event.recurrence && event.recurrence !== 'none' && (
          <span style={{ marginLeft: 5, fontSize: 10, color: accent, fontWeight: 600 }}>
            ↻ {event.recurrence}
          </span>
        )}
      </div>

      {/* Countdown */}
      {countdown && (
        <div style={{
          fontSize: 11, fontWeight: 700, marginTop: 4,
          color: isSoon ? '#faa61a' : T.mt,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {isSoon && <span style={{ fontSize: 9 }}>⏰</span>}
          {countdown}
        </div>
      )}

      {/* Location */}
      {event.location && (
        <div style={{ fontSize: 11, color: T.mt, marginTop: 3 }}>📍 {event.location}</div>
      )}

      {/* Meeting code row */}
      {event.meeting_code && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#7984f5', fontWeight: 700 }}>
            📹 <span style={{ letterSpacing: 2 }}>{event.meeting_code}</span>
          </span>
          <button
            onClick={() => onJoinMeeting?.(event.meeting_code!)}
            style={{
              padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700,
              background: '#5865f2', color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >Join</button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(event.meeting_code!);
              onFlash('Meeting code copied!');
            }}
            style={{
              padding: '3px 8px', borderRadius: 10, fontSize: 11,
              background: T.sf, border: `1px solid ${T.bd}`, color: T.mt, cursor: 'pointer',
            }}
          >Copy code</button>
        </div>
      )}

      {/* Description */}
      {event.description && (
        <div style={{ fontSize: 12, color: T.tx, marginTop: 6, opacity: 0.8, lineHeight: 1.45 }}>
          {event.description}
        </div>
      )}

      <AttendeeRow going={event.going_count} interested={event.interested_count} />
      <RsvpButtons
        eventId={event.id} rsvpEnabled={event.rsvp_enabled}
        rsvpMap={rsvpMap} onRsvp={onRsvp}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export function CalendarView({ serverId, onJoinMeeting }: CalendarViewProps) {
  const today = new Date();
  const [year,              setYear]          = useState(today.getFullYear());
  const [month,             setMonth]         = useState(today.getMonth());
  const [selectedDay,       setSelectedDay]   = useState<Date | null>(null);
  const [serverEvents,      setServerEvents]  = useState<CalEvent[]>([]);
  const [localEvents,       setLocalEvents]   = useState<CalEvent[]>(loadLocalEvents);
  const [rsvpMap,           setRsvpMap]       = useState<Record<string, string>>(loadRsvpMap);
  const [showForm,          setShowForm]      = useState(false);
  const [form,              setForm]          = useState<FormState>(defaultForm);
  const [saving,            setSaving]        = useState(false);
  const [toast,             setToast]         = useState('');
  const [now,               setNow]           = useState(today);
  const [inlineMeetCode,    setInlineMeetCode] = useState<string | null>(null);
  const notifiedRef = useRef<Set<string>>(loadNotified());
  const [calNotes,        setCalNotes]        = useState<Record<string, string>>({});
  const [inlineEditDay,   setInlineEditDay]   = useState<string | null>(null);
  const [inlineNoteText,  setInlineNoteText]  = useState('');
  const [reminderPrompt,  setReminderPrompt]  = useState<{ dk: string; text: string } | null>(null);
  const [reminderTime,    setReminderTime]    = useState('09:00');
  const [reminderDate,    setReminderDate]    = useState('');
  const [reminderChecked, setReminderChecked] = useState(false);
  const [showReminders,   setShowReminders]   = useState(false);
  const [reminderList,    setReminderList]    = useState<Reminder[]>(loadReminders);
  // Form: event reminder fields
  const [formReminder,    setFormReminder]    = useState<'none'|'at_time'|'15min'|'1hr'|'1day'>('none');
  const [formReminderPush, setFormReminderPush] = useState(false);

  // ── Live clock (30s tick for countdowns) ────────────────────────────

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Request notification permission ─────────────────────────────────

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Load server events ───────────────────────────────────────────────

  const loadServerEvents = useCallback(async () => {
    if (!serverId) { setServerEvents([]); return; }
    try {
      const raw = await api.listEvents(serverId);
      if (!Array.isArray(raw)) return;
      setServerEvents(raw.map((e: any): CalEvent => ({
        id: String(e.id), title: e.title, description: e.description,
        start_time: e.start_time, end_time: e.end_time, location: e.location,
        visibility: 'public', rsvp_enabled: true,
        going_count: e.going_count ?? 0, interested_count: e.interested_count ?? 0,
        my_rsvp: e.my_rsvp ?? null, creator_username: e.creator_username,
        source: 'server',
      })));
    } catch {}
  }, [serverId]);

  useEffect(() => { loadServerEvents(); }, [loadServerEvents]);

  // ── 15-minute notifications ──────────────────────────────────────────

  useEffect(() => {
    const check = () => {
      const nowMs = Date.now();
      const window15 = 15 * 60_000;
      const allEvts  = [...serverEvents, ...localEvents];

      for (const evt of allEvts) {
        const diff = new Date(evt.start_time).getTime() - nowMs;
        if (diff > 0 && diff <= window15) {
          const key = `${evt.id}-${eventDateKey(evt.start_time)}`;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);
            saveNotified(notifiedRef.current);

            const mins = Math.round(diff / 60_000);
            const msg  = `Meeting "${evt.title}" starts in ${mins} minute${mins !== 1 ? 's' : ''}.`;

            // In-app toast
            setToast(msg);
            setTimeout(() => setToast(''), 8_000);

            // Browser notification
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`⏰ ${evt.title}`, { body: msg, icon: '/favicon.ico' });
            }
          }
        }
      }
    };

    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [serverEvents, localEvents]);

  // ── Reminder check (60s) ─────────────────────────────────────────────

  useEffect(() => {
    const check = () => {
      const reminders = loadReminders();
      const nowMs = Date.now();
      let changed = false;
      const updated = reminders.map(r => {
        if (r.triggered) return r;
        const dt = new Date(`${r.date}T${r.time}:00`);
        if (dt.getTime() <= nowMs) {
          changed = true;
          const msg = `Reminder: ${r.text}`;
          setToast(msg);
          setTimeout(() => setToast(''), 8_000);
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('⏰ Reminder', { body: msg, icon: '/favicon.ico' });
          }
          return { ...r, triggered: true };
        }
        return r;
      });
      if (changed) saveReminders(updated);
    };
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────

  const allEvents = [...serverEvents, ...localEvents];
  const todayKey  = dateKey(today);
  const grid      = buildGrid(year, month);

  const byDay: Record<string, CalEvent[]> = {};
  for (const e of allEvents) {
    const k = eventDateKey(e.start_time);
    (byDay[k] = byDay[k] || []).push(e);
  }

  const dayEvents: CalEvent[] = selectedDay ? (byDay[dateKey(selectedDay)] || []) : [];

  // ── Navigation ───────────────────────────────────────────────────────

  const prevMonth = () => { if (month === 0) { setYear(y => y-1); setMonth(11); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y+1); setMonth(0); } else setMonth(m => m+1); };
  const goToday   = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  // ── RSVP ─────────────────────────────────────────────────────────────

  const handleRsvp = useCallback(async (eventId: string, status: string) => {
    if (serverEvents.some(e => e.id === eventId)) {
      try { await api.rsvpEvent(eventId, status); await loadServerEvents(); } catch {}
    }
    const next = { ...rsvpMap, [eventId]: status };
    setRsvpMap(next); saveRsvpMap(next);
  }, [rsvpMap, serverEvents, loadServerEvents]);

  // ── Join meeting ─────────────────────────────────────────────────────

  const handleJoinMeeting = (code: string) => {
    if (onJoinMeeting) { onJoinMeeting(code); }
    else { setInlineMeetCode(code); }
  };

  // ── Save event ───────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      let meetingCode: string | undefined;
      if (form.scheduleMeeting) {
        meetingCode = String(Math.floor(100000 + Math.random() * 900000));
        try {
          const mtg = await api.createMeeting(form.title);
          if (mtg?.code)         meetingCode = String(mtg.code);
          else if (mtg?.meeting_code) meetingCode = String(mtg.meeting_code);
        } catch {}
      }

      const occurrences = expandRecurring(form.date, form.startTime, form.endTime, form.repeat);
      const groupId = form.repeat !== 'none' ? `rg-${Date.now()}` : undefined;
      const toCreate: CalEvent[] = occurrences.map(({ startIso, endIso }, idx) => ({
        id: `local-${Date.now()}-${idx}`,
        title: form.title, description: form.description || undefined,
        start_time: startIso, end_time: endIso,
        location: meetingCode
          ? (form.location ? `${form.location} · Code: ${meetingCode}` : `Meeting code: ${meetingCode}`)
          : (form.location || undefined),
        visibility: form.visibility, rsvp_enabled: form.rsvpEnabled,
        going_count: 0, interested_count: 0,
        creator_username: api.username ?? undefined,
        meeting_code: idx === 0 ? meetingCode : undefined,
        color: form.color !== PRESET_COLORS[0] ? form.color : undefined,
        recurrence: form.repeat !== 'none' ? form.repeat : undefined,
        recurrence_group_id: groupId,
        source: 'local' as const,
      }));

      // Publish first occurrence to server if public
      if (serverId && form.visibility === 'public') {
        await api.createEvent(serverId, {
          title: form.title,
          description: form.description || undefined,
          location: toCreate[0].location,
          start_time: toCreate[0].start_time,
          end_time: toCreate[0].end_time,
        });
        await loadServerEvents();
      }

      const updated = [...localEvents, ...toCreate];
      setLocalEvents(updated); saveLocalEvents(updated);

      const label = form.repeat !== 'none'
        ? `${occurrences.length} recurring events created!`
        : meetingCode ? `Meeting scheduled! Code: ${meetingCode}` : 'Event created!';

      // Save reminder if set
      if (formReminder !== 'none') {
        const eventDate = new Date(`${form.date}T${form.startTime || '09:00'}`);
        let reminderDate = new Date(eventDate);
        if (formReminder === '15min') reminderDate = new Date(eventDate.getTime() - 15 * 60000);
        else if (formReminder === '1hr') reminderDate = new Date(eventDate.getTime() - 60 * 60000);
        else if (formReminder === '1day') reminderDate = new Date(eventDate.getTime() - 24 * 60 * 60000);
        const rDate = `${reminderDate.getFullYear()}-${String(reminderDate.getMonth() + 1).padStart(2, '0')}-${String(reminderDate.getDate()).padStart(2, '0')}`;
        const rTime = `${String(reminderDate.getHours()).padStart(2, '0')}:${String(reminderDate.getMinutes()).padStart(2, '0')}`;
        const rs = loadReminders();
        rs.push({ id: `rem-${Date.now()}`, date: rDate, time: rTime, text: form.title, triggered: false });
        saveReminders(rs);
        setReminderList(rs);
      }

      flash(label);
      setShowForm(false);
      setForm(defaultForm(selectedDay ?? undefined));
      setFormReminder('none');
      setFormReminderPush(false);
    } catch {
      flash('Could not save event.');
    } finally {
      setSaving(false);
    }
  };

  const deleteLocal = (id: string) => {
    const updated = localEvents.filter(e => e.id !== id);
    setLocalEvents(updated); saveLocalEvents(updated);
  };

  const deleteGroup = (groupId: string) => {
    const updated = localEvents.filter(e => e.recurrence_group_id !== groupId);
    setLocalEvents(updated); saveLocalEvents(updated);
  };

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4_000); };
  const openForm = (day?: Date) => { setForm(defaultForm(day ?? selectedDay ?? undefined)); setShowForm(true); };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', height: '100%', overflow: 'hidden', background: T.bg }}>

      {/* ── Calendar grid ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflowY: 'auto', minWidth: 0 }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <button onClick={prevMonth} style={navBtn}>‹</button>
          <button onClick={nextMonth} style={navBtn}>›</button>
          <span style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{MONTH_NAMES[month]} {year}</span>
          <button onClick={goToday} style={{ background: T.sf2, border: `1px solid ${T.bd}`, color: T.mt, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Today</button>
          <button onClick={() => { setReminderList(loadReminders()); setShowReminders(true); }} style={{ background: T.sf2, border: `1px solid ${T.bd}`, color: T.mt, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', position: 'relative' }}>
            🔔 Reminders{reminderList.filter(r => !r.triggered).length > 0 && <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: 7, background: '#ed4245', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{reminderList.filter(r => !r.triggered).length}</span>}
          </button>
          <button onClick={() => openForm()} style={{ ...btn(true), padding: '6px 12px', fontSize: 12, maxWidth: 140, marginRight: 40 }}>+ Create Event</button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DAY_LABELS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: T.mt, padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, flex: 1 }}>
          {grid.map((day, i) => {
            const dk         = dateKey(day);
            const isToday    = dk === todayKey;
            const inMonth    = day.getMonth() === month;
            const isSelected = selectedDay ? dateKey(selectedDay) === dk : false;
            const dots       = byDay[dk] || [];
            const noteText   = calNotes[dk] || '';
            const isEditing  = inlineEditDay === dk;
            return (
              <div
                key={i}
                onClick={() => { if (!isEditing) setSelectedDay(day); }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setInlineEditDay(dk);
                  setInlineNoteText(noteText);
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = isToday ? 'rgba(0,212,170,0.06)' : 'transparent'; }}
                style={{
                  minHeight: 68, padding: '5px 6px', borderRadius: 6, cursor: 'pointer',
                  background: isSelected ? 'rgba(0,212,170,0.12)' : isToday ? 'rgba(0,212,170,0.06)' : 'transparent',
                  border: `1px solid ${isSelected ? T.ac : isToday ? `${ta(T.ac,'55')}` : `${ta(T.bd,'66')}`}`,
                  opacity: inMonth ? 1 : 0.3,
                  transition: 'background .1s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? T.ac : inMonth ? T.tx : T.mt, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                  {day.getDate()}
                  {isToday && <span style={{ width: 5, height: 5, borderRadius: 3, background: T.ac, display: 'inline-block' }} />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {dots.slice(0, 3).map((e, ei) => {
                    const c = e.color || (e.meeting_code ? COLOR_MEETING : e.source === 'server' ? COLOR_SERVER : COLOR_LOCAL);
                    return <div key={ei} title={e.title} style={{ height: 5, borderRadius: 3, background: c, width: '100%' }} />;
                  })}
                  {dots.length > 3 && <span style={{ fontSize: 9, color: T.mt, lineHeight: 1 }}>+{dots.length - 3}</span>}
                </div>
                {isEditing ? (
                  <input
                    autoFocus
                    value={inlineNoteText}
                    onChange={e => setInlineNoteText(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const text = inlineNoteText.trim();
                        if (text) {
                          localStorage.setItem(`${LS_NOTES_PREFIX}${dk}`, text);
                          setCalNotes(prev => ({ ...prev, [dk]: text }));
                          setReminderPrompt({ dk, text });
                          setReminderTime('09:00');
                          setReminderDate(dk);
                          setReminderChecked(false);
                        }
                        setInlineEditDay(null);
                      } else if (e.key === 'Escape') {
                        setInlineEditDay(null);
                      }
                    }}
                    placeholder="Quick note…"
                    style={{ width: '100%', fontSize: 12, padding: '4px 6px', background: T.bg, border: `1px solid ${T.ac}`, borderRadius: 4, color: T.tx, outline: 'none', marginTop: 3, boxSizing: 'border-box', minHeight: 28 } as React.CSSProperties}
                  />
                ) : noteText ? (
                  <div title={noteText} style={{ fontSize: 9, color: T.mt, lineHeight: 1.3, marginTop: 2, overflow: 'hidden', maxHeight: 24, wordBreak: 'break-word' }}>
                    {noteText}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.bd}` }}>
          {serverId && <LegendDot color={COLOR_SERVER} label="Server events" />}
          <LegendDot color={COLOR_LOCAL}   label="Personal" />
          <LegendDot color={COLOR_MEETING} label="Meetings" />
        </div>
      </div>

      {/* ── Day panel ── */}
      {selectedDay && (
        <div style={{ width: 300, borderInlineStart: `1px solid ${T.bd}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '14px 14px 12px', borderBottom: `1px solid ${T.bd}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <div style={{ fontSize: 11, color: T.mt, marginTop: 2 }}>{dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => openForm(selectedDay)} style={{ background: T.ac, color: '#000', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Add</button>
              <button onClick={() => setSelectedDay(null)} style={{ background: T.sf2, border: `1px solid ${T.bd}`, color: T.mt, borderRadius: 6, padding: '4px 8px', fontSize: 13, cursor: 'pointer' }}>×</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {dayEvents.length === 0 ? (
              <div style={{ color: T.mt, fontSize: 13, textAlign: 'center', padding: '40px 16px', lineHeight: 1.7 }}>
                No events this day.<br /><span style={{ fontSize: 11 }}>Click + Add to create one.</span>
              </div>
            ) : dayEvents.map(evt => (
              <EventCard
                key={evt.id}
                event={evt}
                rsvpMap={rsvpMap}
                now={now}
                onRsvp={handleRsvp}
                onDelete={evt.source === 'local'
                  ? (evt.recurrence_group_id
                    ? () => {
                        if (window.confirm(`Delete all recurring "${evt.title}" events?`)) deleteGroup(evt.recurrence_group_id!);
                        else deleteLocal(evt.id);
                      }
                    : () => deleteLocal(evt.id))
                  : undefined}
                onJoinMeeting={handleJoinMeeting}
                onFlash={flash}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Create Event modal ── */}
      {showForm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', padding: 24, width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 18 }}>Create Event</div>

            {/* Color picker */}
            <label style={labelSt}>Color</label>
            <div style={{ marginBottom: 14 }}>
              <ColorPicker value={form.color} onChange={c => setForm(f => ({ ...f, color: c }))} />
            </div>

            <label style={labelSt}>Title *</label>
            <input
              style={{ ...getInp(), marginBottom: 12 }} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Event title" autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />

            <label style={labelSt}>Description</label>
            <textarea
              style={{ ...getInp(), marginBottom: 12, resize: 'vertical', height: 60 } as React.CSSProperties}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional details"
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div><label style={labelSt}>Date</label><input type="date" style={getInp()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div><label style={labelSt}>Start</label><input type="time" style={getInp()} value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><label style={labelSt}>End</label><input type="time" style={getInp()} value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>

            <label style={labelSt}>Location</label>
            <input style={{ ...getInp(), marginBottom: 12 }} value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Address, link, or voice channel name" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <div>
                <label style={labelSt}>Visibility</label>
                <select style={getInp()} value={form.visibility} onChange={e => setForm(f => ({ ...f, visibility: e.target.value as Visibility }))}>
                  {serverId && <option value="public">Public (server)</option>}
                  <option value="friends">Friends only</option>
                  <option value="private">Private (only you)</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>Repeat</label>
                <select style={getInp()} value={form.repeat} onChange={e => setForm(f => ({ ...f, repeat: e.target.value as Recurrence }))}>
                  <option value="none">None</option>
                  <option value="daily">Daily (30×)</option>
                  <option value="weekly">Weekly (8×)</option>
                  <option value="monthly">Monthly (6×)</option>
                </select>
              </div>
            </div>

            {form.repeat !== 'none' && (
              <div style={{ background: 'rgba(0,212,170,0.06)', border: `1px solid ${ta(T.ac,'44')}`, borderRadius: 'var(--radius-md)', padding: '7px 12px', marginBottom: 12, fontSize: 11, color: T.mt }}>
                ↻ Will create {RECUR_COUNTS[form.repeat]} events starting {form.date}.
              </div>
            )}

            <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
              <Toggle label="Enable RSVP" value={form.rsvpEnabled} onChange={v => setForm(f => ({ ...f, rsvpEnabled: v }))} />
              <Toggle label="Voice Meeting" value={form.scheduleMeeting} onChange={v => setForm(f => ({ ...f, scheduleMeeting: v }))} />
            </div>

            {form.scheduleMeeting && (
              <div style={{ background: 'rgba(88,101,242,0.08)', border: '1px solid #5865f244', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginBottom: 14, fontSize: 12, color: '#7984f5' }}>
                A 6-digit meeting code will be generated and attached to this event.
              </div>
            )}

            {/* Reminder options */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <div>
                <label style={labelSt}>Reminder</label>
                <select style={getInp()} value={formReminder} onChange={e => setFormReminder(e.target.value as any)}>
                  <option value="none">No Reminder</option>
                  <option value="at_time">At event time</option>
                  <option value="15min">15 minutes before</option>
                  <option value="1hr">1 hour before</option>
                  <option value="1day">1 day before</option>
                </select>
              </div>
              <div>
                <label style={labelSt}>Push Notification</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34 }}>
                  <Toggle label="Browser push" value={formReminderPush} onChange={v => { setFormReminderPush(v); if (v && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.title.trim()} style={{ ...btn(!!form.title.trim()), padding: '8px 18px' }}>
                {saving ? 'Saving…' : form.scheduleMeeting ? '📹 Schedule Meeting' : form.repeat !== 'none' ? `↻ Create ${RECUR_COUNTS[form.repeat]} Events` : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline MeetingRoom (when no onJoinMeeting prop provided) ── */}
      {inlineMeetCode && (
        <Suspense fallback={null}>
          <MeetingRoom
            initialCode={inlineMeetCode}
            onClose={() => setInlineMeetCode(null)}
          />
        </Suspense>
      )}

      {/* Reminder prompt */}
      {reminderPrompt && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setReminderPrompt(null); }}
        >
          <div style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', padding: 20, width: 320 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Note saved!</div>
            <div style={{ fontSize: 12, color: T.mt, marginBottom: 14, wordBreak: 'break-word', fontStyle: 'italic' }}>"{reminderPrompt.text}"</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }} onClick={() => setReminderChecked(v => !v)}>
              <input type="checkbox" id="rem-chk" checked={reminderChecked} onChange={e => setReminderChecked(e.target.checked)} style={{ cursor: 'pointer', width: 15, height: 15 }} onClick={e => e.stopPropagation()} />
              <label htmlFor="rem-chk" style={{ fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>Set reminder</label>
            </div>
            {reminderChecked && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Remind on</label>
                <input type="date" value={reminderDate} onChange={e => setReminderDate(e.target.value)} style={{ ...getInp(), marginBottom: 8 }} />
                <label style={labelSt}>Time</label>
                <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} style={getInp()} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setReminderPrompt(null)} style={{ padding: '6px 14px', background: T.sf2, color: T.mt, border: `1px solid ${T.bd}`, borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>
                No Reminder
              </button>
              {reminderChecked && (
                <button
                  onClick={() => {
                    const rs = loadReminders();
                    rs.push({ id: `rem-${Date.now()}`, date: reminderDate || reminderPrompt.dk, time: reminderTime, text: reminderPrompt.text, triggered: false });
                    saveReminders(rs);
                    setReminderList(rs);
                    flash('Reminder set!');
                    setReminderPrompt(null);
                  }}
                  style={{ ...btn(true), padding: '6px 14px', fontSize: 12 }}
                >Save Reminder</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reminders list modal */}
      {showReminders && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowReminders(false); }}
        >
          <div style={{ background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 'var(--border-radius)', padding: 24, width: 400, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Your Reminders</div>
              <button onClick={() => setShowReminders(false)} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            {reminderList.length === 0 ? (
              <div style={{ fontSize: 13, color: T.mt, textAlign: 'center', padding: 20 }}>No reminders set.</div>
            ) : reminderList.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${T.bd}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: r.triggered ? T.mt : T.tx, textDecoration: r.triggered ? 'line-through' : 'none' }}>{r.text}</div>
                  <div style={{ fontSize: 11, color: T.mt }}>{r.date} at {r.time}{r.triggered ? ' · Done' : ''}</div>
                </div>
                <button onClick={() => {
                  const rs = reminderList.filter(x => x.id !== r.id);
                  saveReminders(rs);
                  setReminderList(rs);
                  flash('Reminder deleted');
                }} style={{ background: 'none', border: 'none', color: T.err || '#ed4245', cursor: 'pointer', fontSize: 16, padding: '4px 8px' }}>🗑</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: T.sf, border: `1px solid ${T.bd}`, color: T.tx, padding: '9px 18px', borderRadius: 20, fontSize: 13, zIndex: 2000, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', pointerEvents: 'none', maxWidth: 380, textAlign: 'center' }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Style constants ─────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  background: T.sf2, border: `1px solid ${T.bd}`, color: T.tx,
  borderRadius: 6, width: 28, height: 28, cursor: 'pointer',
  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
};
