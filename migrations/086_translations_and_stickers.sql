-- Migration 086: Translation messages and sticker packs.
--
-- Translations: messages with is_translation flag link back to original.
-- Stickers: pack-based image stickers for chat.

-- ── Translation support ─────────────────────────────────────────────────

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_translation BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS original_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS translation_language VARCHAR(50);

-- ── Sticker packs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sticker_packs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    server_id   UUID        REFERENCES servers(id) ON DELETE CASCADE,
    creator_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stickers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id     UUID        NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    name        VARCHAR(50) NOT NULL,
    image_url   TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id);
CREATE INDEX IF NOT EXISTS idx_sticker_packs_server ON sticker_packs(server_id);

-- ── Sticker reference on messages ───────────────────────────────────────

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;
