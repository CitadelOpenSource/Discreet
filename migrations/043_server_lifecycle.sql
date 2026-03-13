-- 043: Server lifecycle — last_activity_at, archived, scheduled deletion.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE servers ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ DEFAULT NULL;

-- Backfill last_activity_at from most recent message or server creation.
UPDATE servers SET last_activity_at = COALESCE(
    (SELECT MAX(m.created_at) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.server_id = servers.id),
    servers.created_at
) WHERE last_activity_at IS NULL OR last_activity_at = servers.created_at;

CREATE INDEX IF NOT EXISTS idx_servers_last_activity ON servers (last_activity_at);
CREATE INDEX IF NOT EXISTS idx_servers_archived ON servers (is_archived) WHERE is_archived = TRUE;
CREATE INDEX IF NOT EXISTS idx_servers_scheduled_deletion ON servers (scheduled_deletion_at) WHERE scheduled_deletion_at IS NOT NULL;

-- Ensure is_archived is NOT NULL (original ADD COLUMN omitted NOT NULL).
UPDATE servers SET is_archived = FALSE WHERE is_archived IS NULL;
ALTER TABLE servers ALTER COLUMN is_archived SET NOT NULL;
