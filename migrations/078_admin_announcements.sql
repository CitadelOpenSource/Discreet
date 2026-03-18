-- Platform-wide admin announcements.
CREATE TABLE IF NOT EXISTS admin_announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    target      TEXT NOT NULL DEFAULT 'all',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_announcements_created
    ON admin_announcements(created_at DESC);
