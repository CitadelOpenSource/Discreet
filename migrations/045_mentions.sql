-- 045: Mention tracking — mentioned_user_ids JSONB on messages.
-- Client sends the list of mentioned UUIDs alongside ciphertext.
-- NOT NULL with DEFAULT so existing rows are valid.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentioned_user_ids JSONB NOT NULL DEFAULT '[]';
