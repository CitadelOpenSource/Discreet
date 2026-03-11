-- ═══════════════════════════════════════════════════════════════════════════
-- CITADEL DATABASE SCHEMA — Complete (v0.3.0-alpha)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Run: psql -d citadel -f migrations/001_schema.sql
--
-- Design principles:
--   • content_ciphertext columns store ONLY MLS ApplicationMessage blobs
--   • The server NEVER has plaintext content columns
--   • All UUIDs are v4 (random) to prevent enumeration
--   • Passwords are Argon2id hashes
--   • Timestamps are TIMESTAMPTZ (always UTC)
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. USERS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username          VARCHAR(32) NOT NULL UNIQUE,
    display_name      VARCHAR(64),
    email             VARCHAR(256) UNIQUE,
    password_hash     TEXT NOT NULL,
    avatar_url        TEXT,
    identity_public_key    BYTEA,    -- Ed25519 public key
    key_agreement_public_key BYTEA,  -- X25519 public key
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_name       VARCHAR(128),
    ip_address        INET,
    expires_at        TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at        TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_key_packages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_package       BYTEA NOT NULL,
    claimed_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at        TIMESTAMPTZ
);

CREATE INDEX idx_user_kp_available ON user_key_packages(user_id)
    WHERE claimed_by IS NULL;

-- ── 2. SERVERS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS servers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(128) NOT NULL,
    description       TEXT,
    icon_url          TEXT,
    owner_id          UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_members (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname          VARCHAR(64),
    joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);

CREATE TABLE IF NOT EXISTS server_invites (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    code              VARCHAR(16) NOT NULL UNIQUE,
    created_by        UUID NOT NULL REFERENCES users(id),
    max_uses          INTEGER,
    use_count         INTEGER NOT NULL DEFAULT 0,
    expires_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_bans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id),
    banned_by         UUID NOT NULL REFERENCES users(id),
    reason            TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, user_id)
);

-- ── 3. ROLES & PERMISSIONS ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name              VARCHAR(64) NOT NULL,
    color             VARCHAR(7),
    permissions       BIGINT NOT NULL DEFAULT 0,
    position          INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_roles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id           UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(server_id, user_id, role_id)
);

-- ── 4. CHANNELS ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name              VARCHAR(128) NOT NULL,
    topic             TEXT,
    channel_type      VARCHAR(16) NOT NULL DEFAULT 'text'
                        CHECK (channel_type IN ('text', 'voice', 'announcement')),
    position          INTEGER NOT NULL DEFAULT 0,
    mls_group_id      BYTEA,
    mls_epoch         BIGINT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id);

-- ── 5. MESSAGES (ZERO-KNOWLEDGE) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id         UUID NOT NULL REFERENCES users(id),
    -- The ONLY content column. MLS ApplicationMessage ciphertext.
    -- The server cannot decrypt this.
    content_ciphertext BYTEA NOT NULL,
    mls_epoch         BIGINT NOT NULL,
    -- Optional: encrypted attachment reference (file key inside ciphertext).
    attachment_blob_id UUID,
    edited_at         TIMESTAMPTZ,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX idx_messages_author ON messages(author_id);

-- ── 6. DIRECT MESSAGES ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dm_channels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a            UUID NOT NULL REFERENCES users(id),
    user_b            UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_a, user_b),
    CHECK (user_a < user_b)
);

CREATE TABLE IF NOT EXISTS dm_messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_channel_id     UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    sender_id         UUID NOT NULL REFERENCES users(id),
    content_ciphertext BYTEA NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dm_messages_channel ON dm_messages(dm_channel_id, created_at);

-- ── 7. FILE ATTACHMENTS ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_blobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id       UUID NOT NULL REFERENCES users(id),
    -- Encrypted file blob. Key is inside the MLS message ciphertext.
    encrypted_blob    BYTEA NOT NULL,
    size_bytes        BIGINT NOT NULL,
    mime_type_hint    VARCHAR(128),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. AI AGENTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name      VARCHAR(128) NOT NULL,
    specialization    JSONB NOT NULL,
    status            VARCHAR(32) NOT NULL DEFAULT 'spawning',
    identity_public_key      BYTEA NOT NULL,
    key_agreement_public_key BYTEA NOT NULL,
    fingerprint       VARCHAR(128) NOT NULL,
    runtime_config    JSONB NOT NULL,
    safety_config     JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decommissioned_at TIMESTAMPTZ
);

CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_spec ON agents USING GIN(specialization);

CREATE TABLE IF NOT EXISTS agent_channels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    mls_group_id      BYTEA,
    topic             VARCHAR(512) NOT NULL,
    member_count      INTEGER NOT NULL DEFAULT 0,
    archived          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, channel_id)
);

CREATE INDEX idx_agent_channels_server ON agent_channels(server_id);

CREATE TABLE IF NOT EXISTS agent_spawn_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requesting_user_id UUID NOT NULL REFERENCES users(id),
    server_id         UUID NOT NULL REFERENCES servers(id),
    query             VARCHAR(1024) NOT NULL,
    inferred_specialization JSONB NOT NULL,
    confidence        DOUBLE PRECISION NOT NULL,
    status            VARCHAR(32) NOT NULL DEFAULT 'analyzing',
    agent_id          UUID REFERENCES agents(id),
    channel_id        UUID REFERENCES channels(id),
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_spawn_log_user ON agent_spawn_log(requesting_user_id, created_at);

CREATE TABLE IF NOT EXISTS agent_key_packages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key_package       BYTEA NOT NULL,
    claimed_by        UUID REFERENCES channels(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at        TIMESTAMPTZ
);

CREATE INDEX idx_agent_kp_available ON agent_key_packages(agent_id)
    WHERE claimed_by IS NULL;

CREATE TABLE IF NOT EXISTS agent_usage (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL REFERENCES agents(id),
    user_id           UUID NOT NULL REFERENCES users(id),
    channel_id        UUID NOT NULL REFERENCES channels(id),
    tokens_in         INTEGER NOT NULL DEFAULT 0,
    tokens_out        INTEGER NOT NULL DEFAULT 0,
    inference_ms      INTEGER NOT NULL DEFAULT 0,
    rag_chunks        INTEGER NOT NULL DEFAULT 0,
    safety_filtered   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_usage_billing ON agent_usage(user_id, created_at);

CREATE TABLE IF NOT EXISTS agent_knowledge_bases (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name              VARCHAR(256) NOT NULL,
    description       TEXT,
    vector_store_id   VARCHAR(256),
    document_count    INTEGER NOT NULL DEFAULT 0,
    total_chunks      INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. POST-QUANTUM CRYPTOGRAPHY ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pq_identity_keys (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL,
    owner_type        VARCHAR(16) NOT NULL CHECK (owner_type IN ('user', 'agent')),
    kem_public_key    BYTEA NOT NULL,
    sig_public_key    BYTEA NOT NULL,
    security_level    INTEGER NOT NULL DEFAULT 3,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pq_key_packages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL,
    owner_type        VARCHAR(16) NOT NULL,
    mls_key_package   BYTEA NOT NULL,
    pq_kem_public     BYTEA NOT NULL,
    hybrid_signature  BYTEA NOT NULL,
    security_level    INTEGER NOT NULL,
    claimed_by        UUID REFERENCES channels(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at        TIMESTAMPTZ
);

CREATE INDEX idx_pq_kp_available ON pq_key_packages(owner_id, owner_type)
    WHERE claimed_by IS NULL;

CREATE TABLE IF NOT EXISTS pq_rekey_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id        UUID NOT NULL REFERENCES channels(id),
    triggered_by      UUID NOT NULL,
    previous_gen      BIGINT NOT NULL,
    new_gen           BIGINT NOT NULL,
    reason            VARCHAR(32) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. FEDERATION ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS federation_instances (
    instance_id       VARCHAR(256) PRIMARY KEY,
    domain            VARCHAR(256) NOT NULL UNIQUE,
    display_name      VARCHAR(256),
    signing_public_key BYTEA NOT NULL,
    transport_public_key BYTEA,
    capabilities      JSONB NOT NULL DEFAULT '{}',
    version           VARCHAR(32),
    trust_level       VARCHAR(32) NOT NULL DEFAULT 'probationary',
    status            VARCHAR(32) NOT NULL DEFAULT 'handshaking',
    last_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS federation_links (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    remote_instance_id VARCHAR(256) NOT NULL REFERENCES federation_instances(instance_id),
    negotiated_caps   JSONB NOT NULL DEFAULT '{}',
    messages_relayed  BIGINT NOT NULL DEFAULT 0,
    last_heartbeat    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS federated_users (
    federated_id      VARCHAR(512) PRIMARY KEY,
    display_name      VARCHAR(128),
    identity_public_key BYTEA,
    instance_id       VARCHAR(256) NOT NULL REFERENCES federation_instances(instance_id),
    last_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS federated_agents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id          UUID NOT NULL,
    home_instance_id  VARCHAR(256) NOT NULL REFERENCES federation_instances(instance_id),
    display_name      VARCHAR(256) NOT NULL,
    specialization    JSONB NOT NULL,
    identity_public_key BYTEA NOT NULL,
    available         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Total: 27 tables across 10 domains
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Friends System ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

CREATE TABLE IF NOT EXISTS pinned_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id),
    pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(channel_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pins_channel ON pinned_messages(channel_id);

-- ── Channel Categories ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_categories_server ON channel_categories(server_id);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES channel_categories(id) ON DELETE SET NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS position INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_settings (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme       TEXT NOT NULL DEFAULT 'dark',
    font_size   TEXT NOT NULL DEFAULT 'medium'
                CHECK (font_size IN ('small', 'medium', 'large')),
    compact_mode BOOLEAN NOT NULL DEFAULT false,
    show_embeds  BOOLEAN NOT NULL DEFAULT true,
    dm_privacy   TEXT NOT NULL DEFAULT 'everyone'
                CHECK (dm_privacy IN ('everyone', 'friends', 'nobody')),
    friend_request_privacy TEXT NOT NULL DEFAULT 'everyone'
                CHECK (friend_request_privacy IN ('everyone', 'friends_of_friends', 'nobody')),
    notification_level TEXT NOT NULL DEFAULT 'all'
                CHECK (notification_level IN ('all', 'mentions', 'nothing')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_notification_settings (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    muted       BOOLEAN NOT NULL DEFAULT false,
    mute_until  TIMESTAMPTZ,
    level       TEXT NOT NULL DEFAULT 'default'
                CHECK (level IN ('default', 'all', 'mentions', 'nothing')),
    suppress_everyone BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (user_id, server_id)
);

-- ── Audit Log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id    UUID NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    changes     JSONB,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_log(server_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

-- Hash-chained immutable audit ledger (Session 19)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS chain_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS sequence_num BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_chain ON audit_log(server_id, sequence_num);

-- Valid audit actions:
-- MEMBER_BAN, MEMBER_UNBAN, MEMBER_KICK
-- ROLE_CREATE, ROLE_UPDATE, ROLE_DELETE, ROLE_ASSIGN, ROLE_UNASSIGN
-- CHANNEL_CREATE, CHANNEL_UPDATE, CHANNEL_DELETE
-- SERVER_UPDATE
-- MESSAGE_PIN, MESSAGE_UNPIN, MESSAGE_DELETE
-- INVITE_CREATE, INVITE_DELETE

ALTER TABLE servers ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon_url TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS default_notification_level TEXT DEFAULT 'all';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS verification_level INT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS explicit_content_filter INT NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS system_channel_id UUID REFERENCES channels(id);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS vanity_code TEXT UNIQUE;

-- verification_level: 0=none, 1=email verified, 2=registered >5min, 3=member >10min
-- explicit_content_filter: 0=disabled, 1=members without roles, 2=all members

