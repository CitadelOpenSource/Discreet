-- 024_bot_config_expand.sql — Extend bot_configs with behavioural config columns.
--
-- All columns use IF NOT EXISTS so this migration is safe to re-run.
-- Defaults match the values used in the Rust handler (UpdateBotConfigRequest).
--
-- Column reference:
--   greeting_message   — Sent automatically when a user first interacts with the bot.
--   response_prefix    — Short string prepended to every bot reply (e.g. "[Bot] ").
--   blocked_topics     — Comma-separated topics the bot refuses to engage with.
--   rate_limit_per_min — Max messages the bot will send per minute (per server).
--   typing_delay       — Simulated typing delay in ms before the reply appears.
--   context_memory     — Whether the bot retains conversation context across turns.
--   context_window     — How many prior messages to include in each LLM context.
--   dm_auto_respond    — Whether the bot replies automatically in DM channels.
--   dm_greeting        — Greeting message sent when a user opens a DM with the bot.
--   emoji_reactions    — Whether the bot adds emoji reactions to messages it sees.
--   language           — Preferred response language ('auto' = match user language).
--   knowledge_base     — Free-text domain knowledge injected into the system prompt.
--   response_mode      — 'auto' | 'always' | 'mention_only' | 'silent'.
--   auto_thread        — Whether the bot auto-creates a thread for each conversation.

ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS greeting_message   TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS response_prefix    VARCHAR(50);
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS blocked_topics     TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER     NOT NULL DEFAULT 20;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS typing_delay       INTEGER     NOT NULL DEFAULT 800;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS context_memory     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS context_window     INTEGER     NOT NULL DEFAULT 20;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS dm_auto_respond    BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS dm_greeting        TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS emoji_reactions    BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS language           VARCHAR(10) NOT NULL DEFAULT 'auto';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS knowledge_base     TEXT;
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS response_mode      VARCHAR(20) NOT NULL DEFAULT 'auto';
ALTER TABLE bot_configs ADD COLUMN IF NOT EXISTS auto_thread        BOOLEAN     NOT NULL DEFAULT FALSE;

-- Constraint: response_mode must be one of the recognised values.
ALTER TABLE bot_configs DROP CONSTRAINT IF EXISTS bot_configs_response_mode_check;
ALTER TABLE bot_configs ADD  CONSTRAINT bot_configs_response_mode_check
    CHECK (response_mode IN ('auto', 'always', 'mention_only', 'silent'));
