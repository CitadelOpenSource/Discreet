-- 092_scheduled_messages.sql — Deferred message delivery.
--
-- Stores messages scheduled for future sending. A background worker
-- polls every 30 seconds and delivers messages whose send_at has passed.

CREATE TABLE IF NOT EXISTS scheduled_messages (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id          UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    content_ciphertext  TEXT        NOT NULL,
    mls_epoch           INT         DEFAULT 0,
    send_at             TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending
    ON scheduled_messages (send_at) WHERE status = 'pending';
