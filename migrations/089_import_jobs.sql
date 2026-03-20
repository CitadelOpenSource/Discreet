-- 089_import_jobs.sql — Message import job tracking.
--
-- Stores one row per import job (Signal, WhatsApp, iMessage, Android SMS).
-- Jobs are created by POST /api/v1/users/@me/import and processed in the
-- background. Status transitions: pending -> processing -> completed | failed.

CREATE TABLE IF NOT EXISTS import_jobs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source           VARCHAR(50) NOT NULL CHECK (source IN ('signal', 'whatsapp', 'imessage', 'android_sms')),
    status           VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_messages   INT         DEFAULT 0,
    imported_count   INT         DEFAULT 0,
    error_message    TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_user_id ON import_jobs (user_id);
