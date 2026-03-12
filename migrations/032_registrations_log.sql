-- Migration: Registration rate-limit log
--
-- Tracks full account registrations per IP to cap abuse.
-- Each row expires naturally; old rows are cheap to ignore.

CREATE TABLE IF NOT EXISTS registrations_log (
    id         BIGSERIAL    PRIMARY KEY,
    ip_address TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registrations_log_ip_created
    ON registrations_log(ip_address, created_at);
