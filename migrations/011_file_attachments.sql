-- Migration 011: File attachment enhancements
-- Add filename, channel/DM association, and delete support

-- Store original filename for display
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS filename VARCHAR(255);

-- Associate files with a channel or DM for persistence/listing
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS dm_channel_id UUID REFERENCES dm_channels(id) ON DELETE SET NULL;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS group_dm_id UUID REFERENCES group_dm_channels(id) ON DELETE SET NULL;

-- Soft-delete support
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for listing files in a channel
CREATE INDEX IF NOT EXISTS idx_file_blobs_channel ON file_blobs(channel_id) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_file_blobs_dm ON file_blobs(dm_channel_id) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_file_blobs_group_dm ON file_blobs(group_dm_id) WHERE deleted = FALSE;
