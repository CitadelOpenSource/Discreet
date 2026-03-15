-- Migration: User message bookmarks.
--
-- Allows users to save messages for later reference.
-- Composite PK ensures one bookmark per user per message.

CREATE TABLE IF NOT EXISTS user_bookmarks (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id  UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    channel_id  UUID        NOT NULL,
    server_id   UUID        NOT NULL,
    note        TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user_created
    ON user_bookmarks (user_id, created_at DESC);
