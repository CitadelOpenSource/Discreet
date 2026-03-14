/**
 * EventsPanel — upcoming server events with RSVP and owner creation form.
 *
 * Uses existing API methods:
 *   api.listEvents(sid)          → ServerEvent[]
 *   api.createEvent(sid, data)   → ServerEvent
 *   api.rsvpEvent(eid, status)   → { status }
 *
 * Props: serverId, isOwner
 */
import React, { useEffect, useState, useCallback } from 'react';
import { T, getInp, btn } from '../theme';
import { api } from '../api/CitadelAPI';

// ─── Types ────────────────────────────────────────────────

interface ServerEvent {
  id:          string;
  title:       string;
  description?: string;
  location?:   string;
  starts_at:   string;   // ISO-8601
  ends_at?:    string;
  rsvp_count?: number;
  my_rsvp?:    'going' | 'maybe' | 'not_going' | null;
  created_by?: string;
}

export interface EventsPanelProps {
  serverId: string;
  isOwner:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function isPast(iso: string): boolean {
  return new Date(iso) < new Date();
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'Ended';
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days > 0)  return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${mins % 60}m`;
  return `in ${mins}m`;
}

// ─── RSVP status config ───────────────────────────────────

const RSVP_OPTIONS: { status: 'going' | 'maybe' | 'not_going'; label: string; color: string }[] = [
  { status: 'going',     label: 'Going',     color: '#3ba55d' },
  { status: 'maybe',     label: 'Maybe',     color: '#faa61a' },
  { status: 'not_going', label: 'Not Going', color: '#ed4245' },
];

// ─── EventCard sub-component ──────────────────────────────

interface EventCardProps {
  event:    ServerEvent;
  onRsvp:   (eid: string, status: 'going' | 'maybe' | 'not_going') => Promise<void>;
  onDelete: (eid: string) => Promise<void>;
  isOwner:  boolean;
}

function EventCard({ event, onRsvp, onDelete, isOwner }: EventCardProps) {
  const [busy, setBusy] = useState(false);
  const past = isPast(event.starts_at);

  const handleRsvp = async (status: 'going' | 'maybe' | 'not_going') => {
    if (busy || past) return;
    setBusy(true);
    await onRsvp(event.id, status);
    setBusy(false);
  };

  const dotColor = past ? T.mt : event.my_rsvp === 'going' ? '#3ba55d' : event.my_rsvp === 'maybe' ? '#faa61a' : T.ac;

  return (
    <div style={{
      border: `1px solid ${past ? T.bd : `${dotColor}44`}`,
      borderRadius: 10,
      background: past ? T.sf2 : `${dotColor}08`,
      padding: '12px 14px',
      marginBottom: 10,
      opacity: past ? 0.6 : 1,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T.mt, flexWrap: 'wrap' }}>
            <span>📅 {formatDate(event.starts_at)}</span>
            {event.ends_at && <span>→ {formatDate(event.ends_at)}</span>}
            {!past && <span style={{ color: dotColor, fontWeight: 600 }}>{timeUntil(event.starts_at)}</span>}
            {past && <span style={{ color: T.mt }}>Ended</span>}
          </div>
        </div>

        {/* RSVP count badge */}
        {(event.rsvp_count ?? 0) > 0 && (
          <div style={{ fontSize: 11, color: T.mt, flexShrink: 0, textAlign: 'right' }}>
            <span style={{ fontWeight: 700, color: T.tx }}>{event.rsvp_count}</span> going
          </div>
        )}
      </div>

      {/* Location */}
      {event.location && (
        <div style={{ fontSize: 11, color: T.mt, marginBottom: 6 }}>
          📍 {event.location}
        </div>
      )}

      {/* Description */}
      {event.description && (
        <div style={{ fontSize: 12, color: T.mt, lineHeight: 1.5, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
          {event.description}
        </div>
      )}

      {/* RSVP buttons */}
      {!past && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {RSVP_OPTIONS.map(opt => {
            const active = event.my_rsvp === opt.status;
            return (
              <button
                key={opt.status}
                onClick={() => handleRsvp(opt.status)}
                disabled={busy}
                style={{
                  padding: '4px 12px', fontSize: 11, borderRadius: 6, cursor: busy ? 'default' : 'pointer',
                  fontWeight: active ? 700 : 400,
                  background: active ? `${opt.color}22` : T.sf2,
                  color: active ? opt.color : T.mt,
                  border: `1px solid ${active ? opt.color + '66' : T.bd}`,
                  transition: 'all .15s',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {opt.label}
              </button>
            );
          })}

          {/* Owner delete */}
          {isOwner && (
            <button
              onClick={() => onDelete(event.id)}
              style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: 'rgba(237,66,69,0.08)', color: '#ed4245', border: '1px solid rgba(237,66,69,0.25)' }}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CreateEventForm sub-component ───────────────────────

interface CreateEventFormProps {
  onSubmit: (data: {
    title: string; description: string; location: string;
    starts_at: string; ends_at: string;
  }) => Promise<void>;
  onCancel: () => void;
}

function CreateEventForm({ onSubmit, onCancel }: CreateEventFormProps) {
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [location,    setLocation]    = useState('');
  const [startsAt,    setStartsAt]    = useState('');
  const [endsAt,      setEndsAt]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [err,         setErr]         = useState('');

  const submit = async () => {
    if (!title.trim())   { setErr('Title is required'); return; }
    if (!startsAt)       { setErr('Start date is required'); return; }
    setSaving(true);
    setErr('');
    await onSubmit({ title: title.trim(), description, location, starts_at: startsAt, ends_at: endsAt });
    setSaving(false);
  };

  const inp = { ...getInp(), marginBottom: 10 };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 3, textTransform: 'uppercase' };

  return (
    <div style={{ border: `1px solid ${T.ac}44`, borderRadius: 10, padding: '14px 16px', marginBottom: 14, background: `${T.ac}06` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.tx, marginBottom: 12 }}>New Event</div>

      <label style={lbl}>Title *</label>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" style={inp} />

      <label style={lbl}>Description</label>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="What's happening?"
        rows={3}
        style={{ ...getInp(), marginBottom: 10, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
      />

      <label style={lbl}>Location</label>
      <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Voice channel, online, IRL address" style={inp} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <label style={lbl}>Start *</label>
          <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={{ ...getInp() }} />
        </div>
        <div>
          <label style={lbl}>End (optional)</label>
          <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={{ ...getInp() }} />
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
  );
}

// ─── EventsPanel ──────────────────────────────────────────

export function EventsPanel({ serverId, isOwner }: EventsPanelProps) {
  const [events,      setEvents]      = useState<ServerEvent[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [showForm,    setShowForm]    = useState(false);
  const [filter,      setFilter]      = useState<'upcoming' | 'past' | 'all'>('upcoming');

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

  const handleRsvp = async (eid: string, status: 'going' | 'maybe' | 'not_going') => {
    await api.rsvpEvent(eid, status);
    // Optimistically update local state
    setEvents(prev => prev.map(ev =>
      ev.id === eid
        ? { ...ev, my_rsvp: status, rsvp_count: status === 'going' ? (ev.rsvp_count ?? 0) + (ev.my_rsvp === 'going' ? 0 : 1) : ev.my_rsvp === 'going' ? Math.max(0, (ev.rsvp_count ?? 0) - 1) : (ev.rsvp_count ?? 0) }
        : ev
    ));
  };

  const handleDelete = async (eid: string) => {
    await api.fetch(`/events/${eid}`, { method: 'DELETE' });
    setEvents(prev => prev.filter(ev => ev.id !== eid));
  };

  const handleCreate = async (data: { title: string; description: string; location: string; starts_at: string; ends_at: string }) => {
    const payload: Record<string, string> = { title: data.title };
    if (data.description) payload.description = data.description;
    if (data.location)    payload.location    = data.location;
    if (data.starts_at)   payload.starts_at   = new Date(data.starts_at).toISOString();
    if (data.ends_at)     payload.ends_at     = new Date(data.ends_at).toISOString();
    const created = await api.createEvent(serverId, payload);
    if (created?.id) {
      setEvents(prev => [created, ...prev]);
      setShowForm(false);
    }
  };

  // Filter
  const visible = events.filter(ev => {
    const past = isPast(ev.starts_at);
    if (filter === 'upcoming') return !past;
    if (filter === 'past')     return past;
    return true;
  }).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const upcomingCount = events.filter(ev => !isPast(ev.starts_at)).length;
  const pastCount     = events.filter(ev =>  isPast(ev.starts_at)).length;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['upcoming', `Upcoming${upcomingCount ? ` (${upcomingCount})` : ''}`],
            ['past',     `Past${pastCount ? ` (${pastCount})` : ''}`],
            ['all',      'All'],
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
          {isOwner && !showForm && (
            <button onClick={() => setShowForm(true)} style={{ ...btn(true), padding: '4px 12px', fontSize: 12 }}>+ Event</button>
          )}
        </div>
      </div>

      {/* ── Create form ── */}
      {showForm && (
        <CreateEventForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* ── States ── */}
      {loading && <div style={{ textAlign: 'center', padding: 32, color: T.mt, fontSize: 12 }}>Loading events...</div>}
      {error && !loading && <div style={{ textAlign: 'center', padding: 16, color: T.mt, fontSize: 12 }}>{error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: T.mt, fontSize: 12 }}>
          {filter === 'upcoming' ? 'No upcoming events.' : filter === 'past' ? 'No past events.' : 'No events yet.'}
          {isOwner && !showForm && filter === 'upcoming' && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowForm(true)} style={{ ...btn(true), fontSize: 12, padding: '6px 16px' }}>Create the first event</button>
            </div>
          )}
        </div>
      )}

      {/* ── Event list ── */}
      {!loading && !error && visible.map(ev => (
        <EventCard
          key={ev.id}
          event={ev}
          onRsvp={handleRsvp}
          onDelete={handleDelete}
          isOwner={isOwner}
        />
      ))}
    </div>
  );
}
