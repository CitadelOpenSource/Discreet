-- Migration 015: Email verification tokens and password reset

-- Email field on users (may already exist from earlier migrations)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Token storage for email verification and password reset
CREATE TABLE IF NOT EXISTS email_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       VARCHAR(255) NOT NULL,
    token       VARCHAR(64) NOT NULL,
    token_type  VARCHAR(20) NOT NULL, -- 'verify' or 'reset'
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, token_type)
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_lookup ON email_tokens(token, token_type, expires_at);
