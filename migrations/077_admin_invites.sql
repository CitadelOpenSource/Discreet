-- Admin invite codes for gated registration.
CREATE TABLE IF NOT EXISTS admin_invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses    INT NOT NULL DEFAULT 10,
    uses        INT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_invites_code ON admin_invites(code);
