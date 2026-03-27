-- 002_reactions.sql — Message reactions.
--
-- Users can add emoji reactions to messages. Each user can react with
-- each emoji once per message. The reaction is stored as a Unicode emoji
-- string (e.g., "👍", "🔥") — not an enumerated ID.
--
-- For E2EE: reactions are NOT encrypted (they're metadata, like read receipts).
-- This is a deliberate design choice — encrypting reactions would require
-- re-encrypting for every group member on every react, which is impractical.

CREATE TABLE IF NOT EXISTS message_reactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(32) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user    ON message_reactions(user_id, message_id);
