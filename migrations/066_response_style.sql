-- Migration: Agent response style.
--
-- response_style controls WHERE the agent sends its reply:
--   'inline'  — reply in the channel like a normal user (default)
--   'thread'  — always reply in a thread to keep the channel clean
--   'dm'      — reply via DM to the user who asked

ALTER TABLE bot_configs
    ADD COLUMN IF NOT EXISTS response_style TEXT NOT NULL DEFAULT 'inline';
