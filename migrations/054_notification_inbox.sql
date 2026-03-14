-- Migration 054: Notification inbox
-- Persistent, per-user notification store for events, mentions, system alerts.

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    action_url  TEXT,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unread-first, newest-first listing per user
CREATE INDEX IF NOT EXISTS idx_notifications_user_inbox
    ON notifications (user_id, read, created_at DESC);
