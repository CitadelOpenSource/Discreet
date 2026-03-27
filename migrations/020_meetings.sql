-- Migration 020: Meeting rooms (Zoom-style join-by-code) + ghost rate limiting

CREATE TABLE IF NOT EXISTS meeting_rooms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(10) NOT NULL UNIQUE, -- 6-digit meeting code
    host_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id       UUID REFERENCES servers(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES channels(id) ON DELETE SET NULL,
    title           VARCHAR(100) NOT NULL DEFAULT 'Meeting',
    password_hash   VARCHAR(256), -- optional password protection (argon2)
    max_participants INTEGER DEFAULT 50,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    allow_guests    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_meeting_code ON meeting_rooms(code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_meeting_host ON meeting_rooms(host_id);

-- Guest account rate limiting: track creation per IP
CREATE TABLE IF NOT EXISTS guest_rate_limits (
    ip_address      VARCHAR(45) NOT NULL, -- IPv4 or IPv6
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ip_address, created_at)
);

CREATE INDEX IF NOT EXISTS idx_guest_rate_ip ON guest_rate_limits(ip_address, created_at);
