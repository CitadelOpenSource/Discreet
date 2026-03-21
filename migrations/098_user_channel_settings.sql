-- 098_user_channel_settings.sql — Per-user per-channel notification overrides.
--
-- Stores mute state, notification level, and mention suppression per user
-- per channel. Checked before every notification delivery.

CREATE TABLE IF NOT EXISTS user_channel_settings (
    user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id           UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    notification_level   VARCHAR(20) NOT NULL DEFAULT 'default',
    muted                BOOLEAN     NOT NULL DEFAULT FALSE,
    muted_until          TIMESTAMPTZ,
    suppress_everyone    BOOLEAN     NOT NULL DEFAULT FALSE,
    suppress_role_mentions BOOLEAN   NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, channel_id)
);
