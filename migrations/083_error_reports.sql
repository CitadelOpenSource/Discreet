-- Migration 083: Error reports table for client and server telemetry.
--
-- Stores errors from React ErrorBoundary (source='client') and
-- server-side handler failures (source='server'). Admins can
-- view, filter, and resolve reports via the developer dashboard.

CREATE TABLE IF NOT EXISTS error_reports (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         REFERENCES users(id) ON DELETE SET NULL,
    source         VARCHAR(20)  NOT NULL CHECK (source IN ('client', 'server')),
    component      VARCHAR(100),
    error_message  TEXT         NOT NULL,
    stack_trace    TEXT,
    browser        VARCHAR(200),
    severity       VARCHAR(20)  NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    resolved       BOOLEAN      NOT NULL DEFAULT FALSE,
    resolved_by    UUID         REFERENCES users(id) ON DELETE SET NULL,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_reports_created
    ON error_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_reports_unresolved
    ON error_reports (created_at DESC)
    WHERE resolved = FALSE;
