-- Bug report submission table.
-- reporter_user_id is nullable so unauthenticated users (login page) can still report bugs.

CREATE TABLE IF NOT EXISTS bug_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    page              VARCHAR(100) NOT NULL,
    description       TEXT NOT NULL,
    error_code        VARCHAR(50),
    browser_info      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports (created_at DESC);
