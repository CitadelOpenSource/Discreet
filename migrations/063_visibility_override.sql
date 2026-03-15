-- Migration: Per-server online visibility override.
--
-- visibility_override: NULL = use global status, 'online'/'idle'/'invisible'.
-- When set, presence broadcasts to this server use the override instead of
-- the user's actual status. Privacy-first: lets users appear offline on
-- specific servers while being online on others.

ALTER TABLE server_members
    ADD COLUMN IF NOT EXISTS visibility_override TEXT DEFAULT NULL;
