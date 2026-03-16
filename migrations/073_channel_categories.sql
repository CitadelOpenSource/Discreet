-- Migration: User-level channel categories (custom folders).
--
-- Users can create personal folders (Work, Gaming, Important) and
-- drag channels into them. These are per-user and per-server —
-- each user sees their own category organization.

-- Drop existing tables (base schema creates channel_categories without user_id).
-- Drop items first due to foreign key constraint on channel_categories.
DROP TABLE IF EXISTS channel_category_items CASCADE;
DROP TABLE IF EXISTS channel_categories CASCADE;

CREATE TABLE channel_categories (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id   UUID    NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    position    INT     NOT NULL DEFAULT 0,
    collapsed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_categories_user_server
    ON channel_categories (user_id, server_id);

CREATE TABLE IF NOT EXISTS channel_category_items (
    category_id UUID NOT NULL REFERENCES channel_categories(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    position    INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (category_id, channel_id)
);
