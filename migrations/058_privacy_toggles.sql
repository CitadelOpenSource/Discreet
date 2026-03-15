-- Migration: Privacy toggles for read receipts, typing indicators, link previews.
--
-- All default to FALSE (privacy-first — Discreet principle).
-- show_read_receipts: mutual — if off, you also can't see others' read status.
-- show_typing_indicator: server checks before broadcasting TYPING_START.
-- show_link_previews: client-side only — server never sees URLs.

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS show_read_receipts     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_typing_indicator   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_link_previews      BOOLEAN NOT NULL DEFAULT FALSE;
