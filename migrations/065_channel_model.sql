-- Migration: Per-channel AI model override.
--
-- When set, the agent uses this model for the channel instead of the
-- server-level default. NULL = use server default.
-- Use case: Claude for #support, GPT for #code-review, Ollama for #private.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS ai_model_override TEXT DEFAULT NULL;
