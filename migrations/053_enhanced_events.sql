-- Migration 053: Enhanced events — reminders, recurrence, voice, invites, capacity
-- Extends server_events (014) and event_rsvps with richer scheduling support.

-- Add new columns to server_events
ALTER TABLE server_events
    ADD COLUMN IF NOT EXISTS reminder_minutes   INT[] DEFAULT '{15,60}',
    ADD COLUMN IF NOT EXISTS recurring_rule     TEXT,
    ADD COLUMN IF NOT EXISTS voice_channel_id   UUID REFERENCES channels(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invite_code        TEXT,
    ADD COLUMN IF NOT EXISTS max_attendees      INT;

-- Add responded_at to event_rsvps and tighten status values
ALTER TABLE event_rsvps
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ DEFAULT NOW();

-- Replace the loose VARCHAR status with a CHECK constraint.
-- Drop any existing constraint first (idempotent).
ALTER TABLE event_rsvps DROP CONSTRAINT IF EXISTS event_rsvps_status_check;
ALTER TABLE event_rsvps ADD CONSTRAINT event_rsvps_status_check
    CHECK (status IN ('accepted', 'declined', 'tentative'));

-- Migrate legacy status values to new vocabulary
UPDATE event_rsvps SET status = 'accepted'  WHERE status = 'going';
UPDATE event_rsvps SET status = 'tentative' WHERE status = 'interested';
UPDATE event_rsvps SET status = 'declined'  WHERE status = 'not_going';

-- Server-side event reminders
CREATE TABLE IF NOT EXISTS event_reminders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remind_at   TIMESTAMPTZ NOT NULL,
    sent        BOOLEAN NOT NULL DEFAULT FALSE,
    method      TEXT NOT NULL DEFAULT 'push'
);

-- Fast lookup for the reminder dispatcher: unsent reminders due now
CREATE INDEX IF NOT EXISTS idx_event_reminders_pending
    ON event_reminders (remind_at)
    WHERE NOT sent;
