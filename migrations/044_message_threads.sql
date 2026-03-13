-- 044: Message threads — parent_message_id for threaded replies.
-- ON DELETE SET NULL ensures replies survive when parent is purged by retention.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_message_id) WHERE parent_message_id IS NOT NULL;
