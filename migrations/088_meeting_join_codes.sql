-- Meeting join codes: 8-character alphanumeric codes for shareable meeting links.
ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS join_code VARCHAR(8) UNIQUE;

-- Index for fast lookup by join_code on active meetings.
CREATE INDEX IF NOT EXISTS idx_meeting_join_code ON meeting_rooms (join_code) WHERE is_active = TRUE;
