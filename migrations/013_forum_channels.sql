-- Migration 013: Forum channels and threads
-- Forum channels contain threads instead of a flat message stream.
-- Each thread has a title, tags, and its own message stream.

-- Add 'forum' to channel types
-- (channel_type is VARCHAR, no enum constraint, so 'forum' just works)

-- Thread table
CREATE TABLE IF NOT EXISTS forum_threads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id       UUID NOT NULL REFERENCES users(id),
    title           VARCHAR(200) NOT NULL,
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,
    locked          BOOLEAN NOT NULL DEFAULT FALSE,
    tags            TEXT[] DEFAULT '{}',
    message_count   INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_channel ON forum_threads(channel_id, created_at DESC);

-- Thread messages (separate from channel messages for clean separation)
CREATE TABLE IF NOT EXISTS thread_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id           UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    author_id           UUID NOT NULL REFERENCES users(id),
    content_ciphertext  BYTEA NOT NULL,
    reply_to_id         UUID REFERENCES thread_messages(id) ON DELETE SET NULL,
    deleted             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thread_messages ON thread_messages(thread_id, created_at);
