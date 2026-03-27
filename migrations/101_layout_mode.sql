-- 101_layout_mode.sql — Layout mode setting (simple, standard, power).
--
-- Controls which UI components render. Independent of theme (colors/fonts).

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS layout_mode VARCHAR(10) NOT NULL DEFAULT 'standard';
