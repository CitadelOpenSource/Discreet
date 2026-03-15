-- Migration: Scheduled tasks table.
--
-- Supports recurring automated actions within servers:
--   - Scheduled announcements
--   - Recurring polls
--   - Channel purge / archival
--   - Automated reminders
--
-- cron_expr uses standard 5-field cron syntax: min hour dom month dow
-- config is a JSONB blob whose schema depends on task_type.

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  UUID        REFERENCES channels(id) ON DELETE SET NULL,
    created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type   TEXT        NOT NULL,
    config      JSONB       NOT NULL DEFAULT '{}',
    cron_expr   TEXT        NOT NULL,
    next_run    TIMESTAMPTZ,
    last_run    TIMESTAMPTZ,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_server
    ON scheduled_tasks (server_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run
    ON scheduled_tasks (next_run)
    WHERE enabled = TRUE;
