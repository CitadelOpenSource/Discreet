-- Migration 014: Server events / scheduling
-- Create events with time, description, RSVP

CREATE TABLE IF NOT EXISTS server_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
    creator_id  UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    location    VARCHAR(200),
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ,
    image_url   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_rsvps (
    event_id    UUID NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      VARCHAR(20) NOT NULL DEFAULT 'interested', -- 'going', 'interested', 'not_going'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_events ON server_events(server_id, start_time);
