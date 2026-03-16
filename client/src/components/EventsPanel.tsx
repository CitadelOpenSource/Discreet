/**
 * EventsPanel — server events with calendar grid, RSVP, and enhanced creation.
 *
 * API fields use backend naming: start_time, end_time, reminder_minutes, etc.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { T, getInp, btn } from '../theme';
import { api } from '../api/CitadelAPI';
import { useTimezone } from '../hooks/TimezoneContext';

// ─── Types ────────────────────────────────────────────────

interface ServerEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time?: string;
  accepted_count?: number;
  declined_count?: number;
  tentative_count?: number;
  my_rsvp?: string | null;
  creator_id?: string;
  creator_username?: string;
  reminder_minutes?: number[];
  recurring_rule?: string;
  voice_channel_id?: string;
  invite_code?: string;
  max_attendees?: number;
}

export interface EventsPanelProps {
  serverId: string;
  isOwner: boolean;
  channels?: { id: string; name: string; type?: string }[];
}

// ─── Helpers ──────────────────────────────────────────────

function fmtDate(iso: string, tz?: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz });
}

function isPast(iso: string): boolean { return new Date(iso) < new Date(); }

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Ended';
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `in ${days}d ${hrs % 24}h`;
  if (hrs > 0) return `in ${hrs}h ${mins % 60}m`;
  return `in ${mins}m`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const RSVP_CFG: { status: string; label: string; color: string }[] = [
  { status: 'accepted', label: 'Accept', color: '#3ba55d' },
  { status: 'tentative', label: 'Tentative', color: '#faa61a' },
  { status: 'declined', label: 'Decline', color: '#ed4245' },
];

const RECURRING_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const REMINDER_PRESETS = [
  { minutes: 15, label: '15 min before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
];

// ─── Mini Calendar ──────────────────────────────────────

function MiniCalendar({ events, selectedDate, onSelect }: {
  events: ServerEvent[];
  selectedDate: Date | null;
  onSelect: (d: Date | null) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date());

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const eventDates = useMemo(() => {
    const set = new Set<string>();
    events.forEach(ev => set.add(dayKey(new Date(ev.start_time))));
    return set;
  }, [events]);

  const today = new Date();
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  return (
    <div style={{ marginBottom: 14 }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button onClick={() => setViewMonth(new Date(year, month - 1, 1))} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 14, padding: '2px 8px' }}>&lt;</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.tx }}>
          {viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={() => setViewMonth(new Date(year, month + 1, 1))} style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 14, padding: '2px 8px' }}>&gt;</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, textAlign: 'center', marginBottom: 2 }}>
        {dayNames.map(d => (
          <div key={d} style={{ fontSize: 10, color: T.mt, fontWeight: 600, padding: 2 }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const cellDate = new Date(year, month, day);
          const isToday = sameDay(cellDate, today);
          const isSelected = selectedDate && sameDay(cellDate, selectedDate);
          const hasEvent = eventDates.has(dayKey(cellDate));

          return (
            <div
              key={day}
              onClick={() => onSelect(isSelected ? null : cellDate)}
              style={{
                width: '100%', aspectRatio: '1', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                borderRadius: 6, fontSize: 12, position: 'relative',
                color: isSelected ? '#000' : isToday ? T.ac : T.tx,
                background: isSelected ? T.ac : isToday ? `${T.ac}15` : 'transparent',
                fontWeight: isToday || isSelected ? 700 : 400,
                transition: 'background 0.1s',
              }}
            >
              {day}
              {hasEvent && (
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: isSelected ? '#000' : T.ac,
                  position: 'absolute', bottom: 2,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <div style={{ marginTop: 6, textAlign: 'center' }}>
          <button onClick={() => onSelect(null)} style={{ background: 'none', border: 'none', color: T.ac, cursor: 'pointer', fontSize: 11 }}>
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}

// ─── EventCard ──────────────────────────────────────────

function EventCard({ event, onRsvp, onDelete, isOwner }: {
  event: ServerEvent;
  onRsvp: (eid: string, status: string) => Promise<void>;
  onDelete: (eid: string) => Promise<void>;
  isOwner: boolean;
}) {
  const { timezone } = useTimezone();
  const [busy, setBusy] = useState(false);
  const past = isPast(event.start_time);

  const handleRsvp = async (status: string) => {
    if (busy || past) return;
    setBusy(true);
    await onRsvp(event.id, status);
    setBusy(false);
  };

  const accepted = event.accepted_count ?? 0;
  const tentative = event.tentative_count ?? 0;
  const declined = event.declined_count ?? 0;

  return (
    <div style={{
      border: `1px solid ${past ? T.bd : `${T.ac}33`}`,
      borderRadius: 10, background: past ? T.sf2 : `${T.ac}06`,
      padding: '12px 14px', marginBottom: 10, opacity: past ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T.mt, flexWrap: 'wrap', marginTop: 2 }}>
            <span>{fmtDate(event.start_time, timezone)}</span>
            {event.end_time && <span>→ {fmtDate(event.end_time, timezone)}</span>}
            {!past && <span style={{ color: T.ac, fontWeight: 600 }}>{timeUntil(event.start_time)}</span>}
            {past && <span>Ended</span>}
          </div>
        </div>
        {event.recurring_rule && (
          <span style={{ fontSize: 10, color: T.mt, background: T.sf2, borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
            {event.recurring_rule}
          </span>
        )}
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: T.mt, flexWrap: 'wrap', marginBottom: 4 }}>
        {event.location && <span>📍 {event.location}</span>}
        {event.voice_channel_id && <span>🔊 Voice linked</span>}
        {event.max_attendees && <span>👥 {accepted}/{event.max_attendees} spots</span>}
        {event.invite_code && <span>🔗 {event.invite_code}</span>}
      </div>

      {event.description && (
        <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.5, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
          {event.description}
        </div>
      )}

      {/* RSVP counts */}
      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: T.mt, marginBottom: 8 }}>
        <span><b style={{ color: '#3ba55d' }}>{accepted}</b> accepted</span>
        <span><b style={{ color: '#faa61a' }}>{tentative}</b> tentative</span>
        <span><b style={{ color: '#ed4245' }}>{declined}</b> declined</span>
      </div>

      {/* RSVP buttons */}
      {!past && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {RSVP_CFG.map(opt => {
            const active = event.my_rsvp === opt.status;
            return (
              <button
                key={opt.status}
                onClick={() => handleRsvp(opt.status)}
                disabled={busy}
                style={{
                  padding: '5px 14px', fontSize: 11, borderRadius: 6, cursor: busy ? 'default' : 'pointer',
                  fontWeight: active ? 700 : 400,
                  background: active ? `${opt.color}22` : T.sf2,
                  color: active ? opt.color : T.mt,
                  border: `1px solid ${active ? opt.color + '66' : T.bd}`,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {opt.label}
              </button>
            );
          })}
          {isOwner && (
            <button
              onClick={() => onDelete(event.id)}
              style={{ marginLeft: 'auto', padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: 'rgba(237,66,69,0.08)', color: '#ed4245', border: '1px solid rgba(237,66,69,0.25)' }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CreateEventModal ───────────────────────────────────

function CreateEventModal({ channels, onSubmit, onCancel }: {
  channels: { id: string; name: string; type?: string }[];
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [voiceChannelId, setVoiceChannelId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [reminderMins, setReminderMins] = useState<number[]>([15, 60]);
  const [recurringRule, setRecurringRule] = useState('');
  const [maxAttendees, setMaxAttendees] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const voiceChannels = channels.filter(c => c.type === 'voice');
  const inp = { ...getInp(), marginBottom: 10 };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 3, textTransform: 'uppercase' };

  const toggleReminder = (mins: number) => {
    setReminderMins(prev => prev.includes(mins) ? prev.filter(m => m !== mins) : [...prev, mins]);
  };

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    if (!startTime) { setErr('Start date is required'); return; }
    setSaving(true);
    setErr('');
    const data: Record<string, any> = {
      title: title.trim(),
      start_time: new Date(startTime).toISOString(),
    };
    if (description) data.description = description;
    if (location) data.location = location;
    if (endTime) data.end_time = new Date(endTime).toISOString();
    if (voiceChannelId) data.voice_channel_id = voiceChannelId;
    if (inviteCode) data.invite_code = inviteCode;
    if (reminderMins.length > 0) data.reminder_minutes = reminderMins;
    if (recurringRule) data.recurring_rule = recurringRule;
    if (maxAttendees && parseInt(maxAttendees) > 0) data.max_attendees = parseInt(maxAttendees);
    await onSubmit(data);
    setSaving(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.sf, border: `1px solid ${T.bd}`, borderRadius: 14,
        padding: 24, width: 460, maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.tx, marginBottom: 16 }}>New Event</div>

        <label style={lbl}>Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" style={inp} autoFocus />

        <label style={lbl}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's happening?" rows={3}
          style={{ ...getInp(), marginBottom: 10, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />

        <label style={lbl}>Location</label>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Online, voice channel, address..." style={inp} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Start * <span style={{ fontWeight: 400, textTransform: 'none' }}>({tz})</span></label>
            <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={getInp()} />
          </div>
          <div>
            <label style={lbl}>End (optional)</label>
            <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} style={getInp()} />
          </div>
        </div>

        {/* Voice channel */}
        {voiceChannels.length > 0 && (
          <>
            <label style={lbl}>Voice Channel</label>
            <select value={voiceChannelId} onChange={e => setVoiceChannelId(e.target.value)}
              style={{ ...getInp(), marginBottom: 10 }}>
              <option value="">None</option>
              {voiceChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}

        {/* Invite code */}
        <label style={lbl}>Invite Code</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Optional" style={{ ...getInp(), marginBottom: 0, flex: 1 }} />
          <button onClick={() => setInviteCode(generateInviteCode())} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>
            Generate
          </button>
        </div>

        {/* Reminders */}
        <label style={lbl}>Reminders</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {REMINDER_PRESETS.map(r => (
            <label key={r.minutes} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.tx, cursor: 'pointer' }}>
              <input type="checkbox" checked={reminderMins.includes(r.minutes)} onChange={() => toggleReminder(r.minutes)} />
              {r.label}
            </label>
          ))}
        </div>

        {/* Recurring */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={lbl}>Recurring</label>
            <select value={recurringRule} onChange={e => setRecurringRule(e.target.value)} style={getInp()}>
              {RECURRING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Max Attendees</label>
            <input type="number" min="0" value={maxAttendees} onChange={e => setMaxAttendees(e.target.value)} placeholder="Unlimited" style={getInp()} />
          </div>
        </div>

        {err && <div style={{ fontSize: 11, color: '#ed4245', marginBottom: 8 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={saving} style={{ ...btn(true), flex: 1, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Creating...' : 'Create Event'}
          </button>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.bd}`, background: T.sf2, color: T.mt, cursor: 'pointer', fontSize: 13 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EventsPanel ────────────────────────────────────────

export function EventsPanel({ serverId, isOwner, channels = [] }: EventsPanelProps) {
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listEvents(serverId);
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not load events');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { load(); }, [load]);

  const handleRsvp = async (eid: string, status: string) => {
    await api.rsvpEvent(eid, status);
    setEvents(prev => prev.map(ev => {
      if (ev.id !== eid) return ev;
      const wasAccepted = ev.my_rsvp === 'accepted';
      const nowAccepted = status === 'accepted';
      const wasTentative = ev.my_rsvp === 'tentative';
      const nowTentative = status === 'tentative';
      const wasDeclined = ev.my_rsvp === 'declined';
      const nowDeclined = status === 'declined';
      return {
        ...ev,
        my_rsvp: status,
        accepted_count: (ev.accepted_count ?? 0) + (nowAccepted ? 1 : 0) - (wasAccepted ? 1 : 0),
        tentative_count: (ev.tentative_count ?? 0) + (nowTentative ? 1 : 0) - (wasTentative ? 1 : 0),
        declined_count: (ev.declined_count ?? 0) + (nowDeclined ? 1 : 0) - (wasDeclined ? 1 : 0),
      };
    }));
  };

  const handleDelete = async (eid: string) => {
    await api.fetch(`/events/${eid}`, { method: 'DELETE' });
    setEvents(prev => prev.filter(ev => ev.id !== eid));
  };

  const handleCreate = async (data: Record<string, any>) => {
    const created = await api.createEvent(serverId, data);
    if (created?.id) {
      await load();
      setShowModal(false);
    }
  };

  // Filtering
  const visible = events.filter(ev => {
    const past = isPast(ev.start_time);
    if (filter === 'upcoming' && past) return false;
    if (filter === 'past' && !past) return false;
    if (selectedDate && !sameDay(new Date(ev.start_time), selectedDate)) return false;
    return true;
  }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const upcomingCount = events.filter(ev => !isPast(ev.start_time)).length;
  const pastCount = events.filter(ev => isPast(ev.start_time)).length;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Calendar grid */}
      <MiniCalendar events={events} selectedDate={selectedDate} onSelect={setSelectedDate} />

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['upcoming', `Upcoming${upcomingCount ? ` (${upcomingCount})` : ''}`],
            ['past', `Past${pastCount ? ` (${pastCount})` : ''}`],
            ['all', 'All'],
          ] as const).map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)} style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontWeight: filter === val ? 700 : 400,
              background: filter === val ? `${T.ac}22` : T.sf2,
              color: filter === val ? T.ac : T.mt,
              border: `1px solid ${filter === val ? T.ac + '44' : T.bd}`,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={load} disabled={loading} title="Refresh" style={{ background: 'none', border: 'none', color: T.mt, cursor: 'pointer', fontSize: 14, opacity: loading ? 0.4 : 1 }}>↻</button>
          {isOwner && (
            <button onClick={() => setShowModal(true)} style={{ ...btn(true), padding: '4px 12px', fontSize: 12, width: 'auto' }}>+ Event</button>
          )}
        </div>
      </div>

      {/* States */}
      {loading && <div style={{ textAlign: 'center', padding: 32, color: T.mt, fontSize: 12 }}>Loading events...</div>}
      {error && !loading && <div style={{ textAlign: 'center', padding: 16, color: T.mt, fontSize: 12 }}>{error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: T.mt, fontSize: 12 }}>
          {selectedDate ? 'No events on this day.' : filter === 'upcoming' ? 'No upcoming events.' : filter === 'past' ? 'No past events.' : 'No events yet.'}
          {isOwner && !selectedDate && filter === 'upcoming' && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowModal(true)} style={{ ...btn(true), fontSize: 12, padding: '6px 16px', width: 'auto' }}>Create the first event</button>
            </div>
          )}
        </div>
      )}

      {/* Event list */}
      {!loading && !error && visible.map(ev => (
        <EventCard key={ev.id} event={ev} onRsvp={handleRsvp} onDelete={handleDelete} isOwner={isOwner} />
      ))}

      {/* Creation modal */}
      {showModal && (
        <CreateEventModal channels={channels} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
      )}
    </div>
  );
}
