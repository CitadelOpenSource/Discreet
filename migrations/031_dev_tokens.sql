-- Migration: Developer API token table
--
-- Tokens allow developers to authenticate against the Citadel API
-- programmatically without using JWT session tokens.
--
-- SECURITY:
--   token_hash stores SHA-256(raw_token) — the plaintext is NEVER stored.
--   token_prefix stores the first 8 chars (e.g. "dsk_xA3b") for display only.
--   The full token is returned exactly ONCE at creation time.

CREATE TABLE IF NOT EXISTS dev_tokens (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(128) NOT NULL UNIQUE,
    token_prefix VARCHAR(8)   NOT NULL,
    name         VARCHAR(100) NOT NULL,
    permissions  JSONB        NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dev_tokens_user_id ON dev_tokens(user_id);
