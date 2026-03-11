-- 002_friends.sql — Friends system for Discreet
-- Supports: send request, accept, decline, block

CREATE TABLE IF NOT EXISTS friendships (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'blocked')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, friend_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- user_id sends request to friend_id.
-- When accepted, friend_id updates status to 'accepted'.
-- When blocked, blocker sets status to 'blocked'.
-- To check if two users are friends: WHERE status = 'accepted' AND
--   ((user_id = A AND friend_id = B) OR (user_id = B AND friend_id = A))
