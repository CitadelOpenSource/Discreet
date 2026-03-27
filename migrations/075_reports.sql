-- Migration: Content reports.
--
-- Users can report messages for review by platform admins.
-- No automated scanning. No external API calls.
-- status: 'open', 'dismissed', 'actioned'.

CREATE TABLE IF NOT EXISTS content_reports (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID        NOT NULL REFERENCES users(id),
    message_id  UUID,
    channel_id  UUID,
    server_id   UUID,
    reason      TEXT        NOT NULL,
    details     TEXT,
    status      TEXT        NOT NULL DEFAULT 'open',
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status
    ON content_reports (status, created_at DESC);
