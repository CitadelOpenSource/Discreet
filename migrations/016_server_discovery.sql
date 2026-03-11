-- Migration 016: Server discovery — public listing for browsable servers

ALTER TABLE servers ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE servers ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS member_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_servers_public ON servers(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_servers_category ON servers(category) WHERE is_public = TRUE;
