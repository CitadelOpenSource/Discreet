-- Migration 084: Agent configuration table.
--
-- Stores per-server AI agent configurations. Each server can have multiple
-- agents with different providers, models, and system prompts.
--
-- The encrypted_api_key column stores the API key encrypted with AES-256-GCM
-- using a key derived from HKDF-SHA256 with salt "discreet-agent-v1" and
-- the server's JWT_SECRET as input key material. This ensures API keys are
-- encrypted at rest and cannot be recovered without the server secret.

CREATE TABLE IF NOT EXISTS agent_configs (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id        UUID         NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name             VARCHAR(100) NOT NULL,
    provider_type    VARCHAR(50)  NOT NULL CHECK (provider_type IN (
                         'openai', 'anthropic', 'openjarvis', 'ollama', 'vllm', 'custom'
                     )),
    model            VARCHAR(100),
    encrypted_api_key BYTEA,
    endpoint_url     TEXT,
    system_prompt    TEXT         DEFAULT 'You are a helpful assistant in the Discreet messaging platform.',
    max_tokens       INT          DEFAULT 1000,
    temperature      REAL         DEFAULT 0.7,
    enabled          BOOLEAN      DEFAULT TRUE,
    created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_server
    ON agent_configs (server_id);
