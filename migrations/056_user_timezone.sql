-- Migration: Add timezone preference to user_settings.
--
-- Stores the user's IANA timezone (e.g. "America/New_York").
-- Used for rendering all timestamps in the client.
-- Defaults to 'UTC' — the client auto-detects and saves on first login.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
