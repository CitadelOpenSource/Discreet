-- 039: Add slash_commands_enabled toggle to servers.
ALTER TABLE servers ADD COLUMN IF NOT EXISTS slash_commands_enabled BOOLEAN NOT NULL DEFAULT TRUE;
