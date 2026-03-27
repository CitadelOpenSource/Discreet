-- Auto-response message for away/afk users.
-- Cleared when user sends a message or sets status back to online.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_response_message VARCHAR(256) DEFAULT NULL;
