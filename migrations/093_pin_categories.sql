-- 093_pin_categories.sql — Pin categories for organized pinned messages.
--
-- Adds a category column to pinned_messages for grouping pins as
-- Important, Action Required, or Reference.

ALTER TABLE pinned_messages
    ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'important';
