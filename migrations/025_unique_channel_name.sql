-- 026_unique_channel_name.sql — Prevent duplicate channel names within a server.
--
-- Adds a partial unique index on (server_id, name) for non-deleted channels.
-- Existing duplicates: keeps the first (oldest), renames others with a suffix.

-- First, fix any existing duplicates by appending a suffix
DO $$
DECLARE
  rec RECORD;
  suffix INTEGER;
BEGIN
  FOR rec IN
    SELECT id, server_id, name, ROW_NUMBER() OVER (PARTITION BY server_id, name ORDER BY created_at) AS rn
    FROM channels
  LOOP
    IF rec.rn > 1 THEN
      suffix := rec.rn;
      UPDATE channels SET name = name || '-' || suffix WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;

-- Now add the unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_unique_name_per_server
  ON channels (server_id, name);
