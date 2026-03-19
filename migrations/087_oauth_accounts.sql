-- Migration 087: OAuth social login accounts.
--
-- Links external OAuth provider identities (Google, GitHub, Apple, Discord)
-- to Discreet user accounts. One user can have multiple linked providers.

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider          VARCHAR(50) NOT NULL,
    provider_user_id  VARCHAR(255) NOT NULL,
    provider_email    VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_user
    ON oauth_accounts (provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_oauth_user
    ON oauth_accounts (user_id);
