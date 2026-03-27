-- 107_admin_user_flags.sql — Admin moderation flags on user accounts.

-- Suspension (temporary, preserves account, blocks login + deletion)
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Admin overrides
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_override_disappearing BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS restricted_channel_creation BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_qr_invite BOOLEAN NOT NULL DEFAULT FALSE;

-- High-risk flag (visual only, does not affect user experience)
ALTER TABLE users ADD COLUMN IF NOT EXISTS high_risk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS high_risk_reason TEXT;

-- Platform audit log for all admin actions
CREATE TABLE IF NOT EXISTS platform_audit_log (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id    UUID        NOT NULL REFERENCES users(id),
    target_user_id   UUID        REFERENCES users(id),
    target_server_id UUID        REFERENCES servers(id),
    action           VARCHAR(100) NOT NULL,
    reason           TEXT,
    metadata         JSONB DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_target ON platform_audit_log (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_admin ON platform_audit_log (admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_log (action);
