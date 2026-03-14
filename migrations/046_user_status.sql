-- 046: Add custom status, status emoji, and presence mode to users.
-- All NOT NULL with defaults so existing rows are safe.

ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_status VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_emoji  VARCHAR(32)  NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_mode VARCHAR(16)  NOT NULL DEFAULT 'online';
