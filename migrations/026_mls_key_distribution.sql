-- Migration 026: MLS Key Distribution Infrastructure
-- Adds tables for MLS KeyPackages, Commits, and Welcome messages.
-- This is the foundation for real E2EE with RFC 9420 (replacing PBKDF2 channel keys).

-- ── KeyPackages ──────────────────────────────────────────────────────────
-- Pre-keys uploaded by clients. Consumed (claimed) when adding a user to an MLS group.
-- Each KeyPackage is single-use. Clients upload batches of 50-100 at registration.

CREATE TABLE IF NOT EXISTS key_packages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_package BYTEA NOT NULL,              -- Serialized MLS KeyPackage
    claimed     BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_by  UUID REFERENCES users(id),   -- Who consumed this KP (for audit)
    claimed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_packages_user ON key_packages(user_id, claimed);
CREATE INDEX IF NOT EXISTS idx_key_packages_unclaimed ON key_packages(user_id) WHERE claimed = FALSE;

-- ── MLS Commits ──────────────────────────────────────────────────────────
-- Commits update the group state (new epoch). Stored for members who were
-- offline when the commit was issued. They process commits sequentially to
-- catch up to the current epoch.

CREATE TABLE IF NOT EXISTS mls_commits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id),
    commit_data BYTEA NOT NULL,              -- Serialized MLS Commit message
    epoch       BIGINT NOT NULL,             -- The epoch this commit transitions TO
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mls_commits_channel ON mls_commits(channel_id, epoch);

-- ── MLS Welcome Messages ─────────────────────────────────────────────────
-- Welcome messages are sent to new members when they're added to a group.
-- They contain the group state encrypted for the new member's KeyPackage.

CREATE TABLE IF NOT EXISTS mls_welcomes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id   UUID NOT NULL REFERENCES users(id),   -- The new member
    welcome     BYTEA NOT NULL,              -- Serialized MLS Welcome message
    processed   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mls_welcomes_target ON mls_welcomes(target_id, processed);

-- ── Identity Keys ────────────────────────────────────────────────────────
-- Public identity keys for each user. Used for out-of-band verification
-- (safety numbers) and for encrypting KeyPackage claims.

CREATE TABLE IF NOT EXISTS identity_keys (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       VARCHAR(64) NOT NULL DEFAULT 'primary',
    signing_key     BYTEA NOT NULL,          -- Ed25519 public key
    identity_key    BYTEA NOT NULL,          -- X25519 public key  
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, device_id)
);

-- ── Update channels table ────────────────────────────────────────────────
-- Add mls_version to track which encryption mode each channel uses.
-- 0 = legacy PBKDF2 (current), 1 = real MLS (RFC 9420)
-- This enables incremental migration: channels can be upgraded individually.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'channels' AND column_name = 'mls_version'
    ) THEN
        ALTER TABLE channels ADD COLUMN mls_version INTEGER NOT NULL DEFAULT 0;
        COMMENT ON COLUMN channels.mls_version IS '0=legacy PBKDF2, 1=MLS RFC 9420';
    END IF;
END $$;
