-- 104_username_case_insensitive.sql — Case-insensitive unique username index.
--
-- Enforces case-insensitive uniqueness at the database level so "John" and
-- "john" cannot both exist, even under race conditions. The username column
-- still stores the original case for display purposes.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
    ON users (LOWER(username));
