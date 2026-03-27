-- 100_timestamp_settings.sql — Persist timestamp display preferences in user_settings.
--
-- show_timestamps: boolean (default true) — whether to show timestamps next to messages.
-- timestamp_format: text (default 'relative') — 'relative', '12h', or '24h'.

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_timestamps BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS timestamp_format VARCHAR(10) NOT NULL DEFAULT 'relative';
