-- Migration: Do Not Disturb schedule columns.
--
-- dnd_start / dnd_end: HH:MM local time strings (e.g. "22:00" / "08:00").
-- dnd_days: comma-separated day numbers 0-6 (0=Sun, 1=Mon, ..., 6=Sat).
--           Default "0,1,2,3,4,5,6" = every day.
-- dnd_enabled: master toggle for the schedule (manual DND overrides this).

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS dnd_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dnd_start   TEXT    NOT NULL DEFAULT '22:00',
    ADD COLUMN IF NOT EXISTS dnd_end     TEXT    NOT NULL DEFAULT '08:00',
    ADD COLUMN IF NOT EXISTS dnd_days    TEXT    NOT NULL DEFAULT '0,1,2,3,4,5,6';
