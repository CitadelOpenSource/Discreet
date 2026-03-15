-- Migration: Per-server notification level on server_members.
--
-- Stored directly on the membership row for fast access during WS broadcast.
-- Values: 'all' (every message), 'mentions' (@mentions only), 'nothing' (muted).
-- Default 'mentions' — privacy-first, consistent with Discreet philosophy.

ALTER TABLE server_members
    ADD COLUMN IF NOT EXISTS notification_level TEXT NOT NULL DEFAULT 'mentions';
