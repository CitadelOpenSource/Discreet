-- Migration 009: Message replies and mention tracking
-- Adds reply_to_id for message threading/reply chains
-- Also adds mentions array for @mention notification tracking

-- Reply-to support for messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- Reply-to support for DM messages
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL;
