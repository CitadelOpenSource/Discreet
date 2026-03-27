-- ═══════════════════════════════════════════════════════════════════════════
-- 007: Search support & privacy toggles
-- ═══════════════════════════════════════════════════════════════════════════

-- Privacy toggle: show which servers you share with other users
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_shared_servers BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for efficient member search across servers
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);

-- Index for message metadata queries (channel, author, time)
CREATE INDEX IF NOT EXISTS idx_messages_author_time ON messages(author_id, created_at DESC);
