-- Migration 010: Group DMs
-- Adds group_dm_channels and group_dm_members tables
-- Group DMs can have 2-10 members with an optional name

CREATE TABLE IF NOT EXISTS group_dm_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100),
    owner_id    UUID NOT NULL REFERENCES users(id),
    icon_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_dm_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_dm_id     UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_dm_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_dm_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_dm_id         UUID NOT NULL REFERENCES group_dm_channels(id) ON DELETE CASCADE,
    sender_id           UUID NOT NULL REFERENCES users(id),
    content_ciphertext  BYTEA NOT NULL,
    reply_to_id         UUID REFERENCES group_dm_messages(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_dm_members_user ON group_dm_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_dm_messages_channel ON group_dm_messages(group_dm_id, created_at);
