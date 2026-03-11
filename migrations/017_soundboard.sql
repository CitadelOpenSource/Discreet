-- Migration 017: Server soundboard — short audio clips for voice channels

CREATE TABLE IF NOT EXISTS soundboard_clips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(32) NOT NULL,
    audio_data  TEXT NOT NULL, -- base64 data URL (max 500KB, ~10sec)
    emoji       VARCHAR(10), -- optional emoji label
    uploaded_by UUID NOT NULL REFERENCES users(id),
    play_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, name)
);

CREATE INDEX IF NOT EXISTS idx_soundboard_server ON soundboard_clips(server_id);
