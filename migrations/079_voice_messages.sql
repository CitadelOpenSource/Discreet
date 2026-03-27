-- Migration 079: Voice message support.
--
-- Adds duration and waveform columns to the messages table.
-- voice_duration_ms is NULL for text messages, non-NULL for voice messages.
-- voice_waveform stores a compressed amplitude envelope for UI rendering.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_duration_ms INT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS voice_waveform BYTEA;

CREATE INDEX IF NOT EXISTS idx_messages_voice
    ON messages(channel_id, created_at)
    WHERE voice_duration_ms IS NOT NULL;
