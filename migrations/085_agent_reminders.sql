-- Migration 085: Agent reminders table.
--
-- Stores scheduled messages that agents create via the set_reminder tool.
-- A background task checks for due reminders and posts them to the channel.

CREATE TABLE IF NOT EXISTS agent_reminders (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID        NOT NULL,
    channel_id  UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message     TEXT        NOT NULL,
    send_at     TIMESTAMPTZ NOT NULL,
    sent        BOOLEAN     NOT NULL DEFAULT FALSE,
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_reminders_pending
    ON agent_reminders (send_at)
    WHERE sent = FALSE;
