-- 034_deleted_user_ids.sql
--
-- Tombstone table for deleted user UUIDs.
-- Prevents UUID reuse after account deletion, which would cause
-- cryptographic key collisions (agent keys and encryption keys are
-- derived from user UUIDs).

CREATE TABLE IF NOT EXISTS deleted_user_ids (
    user_id    UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
