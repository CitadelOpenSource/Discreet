-- Migration: @everyone and @here mention controls.
--
-- mention_everyone_role / mention_here_role: who can trigger @everyone / @here pings.
-- Values: 'admin', 'moderator', 'everyone'. Default 'admin' (restrictive).
-- Users without permission can still type @everyone but the ping is silently suppressed.
--
-- suppress_everyone_pings on server_members: per-server suppression.
-- suppress_all_everyone on user_settings: global master suppression.

ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS mention_everyone_role TEXT NOT NULL DEFAULT 'admin',
    ADD COLUMN IF NOT EXISTS mention_here_role     TEXT NOT NULL DEFAULT 'admin';

ALTER TABLE server_members
    ADD COLUMN IF NOT EXISTS suppress_everyone_pings BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS suppress_all_everyone BOOLEAN NOT NULL DEFAULT FALSE;
