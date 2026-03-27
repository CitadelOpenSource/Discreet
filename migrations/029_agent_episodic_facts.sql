-- Migration 029: Encrypted episodic memory for AI agents
--
-- Stores AES-256-GCM encrypted JSON blobs of facts each agent has learned
-- about users in each channel. The server cannot read these facts.
-- Only the agent with the correct derived key can decrypt them.
--
-- Zero-knowledge personalization — the server facilitates storage
-- but cannot decrypt agent-learned user knowledge.

CREATE TABLE IF NOT EXISTS agent_episodic_facts (
    agent_id    UUID NOT NULL,
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    facts_encrypted BYTEA NOT NULL,
    facts_nonce     BYTEA NOT NULL,
    fact_count      INT DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_episodic_facts_channel
    ON agent_episodic_facts(channel_id);

COMMENT ON TABLE agent_episodic_facts IS
    'Encrypted persistent memory for AI agents. Each row contains an AES-256-GCM '
    'encrypted JSON blob of facts the agent has learned about the user in this channel. '
    'The server cannot read these facts.';
