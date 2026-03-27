-- 095_server_ai_disabled.sql — Per-server AI agent disable toggle.
--
-- When enabled, the server rejects all AI agent endpoints.
-- Existing agent configs are preserved but deactivated.

ALTER TABLE servers ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN NOT NULL DEFAULT FALSE;
