-- Migration 021: Polls — native voting in channels

CREATE TABLE IF NOT EXISTS polls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    creator_id      UUID NOT NULL REFERENCES users(id),
    question        VARCHAR(300) NOT NULL,
    allow_multiple  BOOLEAN NOT NULL DEFAULT FALSE,
    anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ, -- NULL = no expiry
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS poll_options (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id         UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label           VARCHAR(100) NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id         UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id       UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (poll_id, option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_polls_channel ON polls(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_votes ON poll_votes(poll_id);
