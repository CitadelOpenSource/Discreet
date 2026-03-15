-- Migration: Message priority and acknowledgements.
--
-- priority: NULL = normal, 'important' = yellow highlight, 'urgent' = orange banner + ack tracking.
-- message_acknowledgements: tracks who has acknowledged urgent messages.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS message_acknowledgements (
    message_id  UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_acks_message
    ON message_acknowledgements (message_id);
