-- Migration: Add AI agent provider columns + context summary table
--
-- Adds provider configuration columns to bot_configs for real LLM integration.
-- Creates agent_context_summaries for optional long-term memory compression.
--
-- SECURITY: api_key_encrypted stores AES-256-GCM ciphertext.
--           api_key_nonce stores the 12-byte nonce.
--           Both are needed for decryption. The plaintext key is NEVER stored.

-- ── Agent provider configuration columns ────────────────────────────────

ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS provider_type VARCHAR(20) DEFAULT 'anthropic';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS api_key_encrypted BYTEA;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS api_key_nonce BYTEA;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS model_id VARCHAR(100) DEFAULT 'claude-haiku-4-5-20251001';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS endpoint_url VARCHAR(500);
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS mcp_tool_urls JSONB DEFAULT '[]';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS context_message_count INT DEFAULT 20;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS trigger_keywords JSONB DEFAULT '[]';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS memory_mode VARCHAR(20) DEFAULT 'sliding_window';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS disclosure_text TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS nsfw_allowed BOOLEAN DEFAULT FALSE;

-- MLS cryptographic identity — agent participates as an MLS group member
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS x25519_private_key BYTEA;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS x25519_public_key BYTEA;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS mls_leaf_secret BYTEA;

-- ── Agent context summary table (for Summary memory mode) ───────────────

CREATE TABLE IF NOT EXISTS agent_context_summaries (
    bot_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    summary_text TEXT,
    message_count BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_summaries_channel
    ON agent_context_summaries(channel_id);

-- ── Ensure bot_configs has temperature column if missing ────────────────

ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS temperature FLOAT DEFAULT 0.7;
