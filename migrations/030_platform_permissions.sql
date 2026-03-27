-- Migration 030: Platform-level permission tiers and roles
--
-- TWO SEPARATE PERMISSION LAYERS:
--   Layer 1 (this migration): Platform-level — who you are on the platform
--   Layer 2 (already exists):  Server-level — who you are in a community
--
-- Platform tier determines features you CAN access.
-- Server role determines what you can DO within a server.
-- These never cross. A guest can be a server member if invited.
-- A platform_admin still sees [encrypted] in servers they haven't joined.

-- ── Upgrade account_tier to the full 6-tier system ──────────────────────

-- Existing tiers: 'guest', 'registered', 'verified'
-- New tiers: 'unverified' (replaces 'registered'), 'premium', 'dev', 'admin'

-- Step 1: Rename 'registered' to 'unverified' for clarity
UPDATE users SET account_tier = 'unverified' WHERE account_tier = 'registered';
ALTER TABLE users ALTER COLUMN account_tier SET DEFAULT 'unverified';

-- Step 2: Add platform_role column for the internal staff layer
-- This is SEPARATE from account_tier. A verified user who is also
-- a contributor gets platform_role = 'dev'. A paid user gets
-- account_tier = 'premium' but platform_role stays NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role VARCHAR(20);

-- Step 3: Badge display column (shown next to username in UI)
-- shield = verified, gem = premium, wrench = dev, crown = admin
ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_type VARCHAR(20);

-- Step 4: Set your admin account (first user or by username)
-- Run manually after migration: UPDATE users SET platform_role = 'admin', badge_type = 'crown' WHERE username = 'YOUR_USERNAME';

-- ── Platform roles reference table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_roles (
    role_name   VARCHAR(20) PRIMARY KEY,
    display_name VARCHAR(50) NOT NULL,
    badge_icon  VARCHAR(20),
    description TEXT,
    priority    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_roles (role_name, display_name, badge_icon, description, priority)
VALUES
    ('admin',     'Platform Admin',   'crown',   'Full platform control. Admin dashboard, user management, telemetry.', 100),
    ('dev',       'Developer',        'wrench',  'Pre-generated test accounts. API tokens, debug panels, bypass rate limits.', 80),
    ('premium',   'Premium',          'gem',     'Paid tier. Sonnet AI, cosmetics, themes, priority support.', 60),
    ('verified',  'Verified',         'shield',  'Email confirmed. Full features. Account recovery.', 40),
    ('unverified','Unverified',       NULL,      'Registered, no email. Most features, no recovery.', 20),
    ('guest',     'Guest',            NULL,      'Observe and text if invited. No servers, no invites.', 10)
ON CONFLICT (role_name) DO NOTHING;

-- ── Platform permissions bitflags ───────────────────────────────────────
-- These are PLATFORM-level permissions, separate from server permissions.

CREATE TABLE IF NOT EXISTS platform_permissions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    bit_flag    BIGINT NOT NULL UNIQUE
);

INSERT INTO platform_permissions (name, description, bit_flag)
VALUES
    ('ACCESS_ADMIN_DASHBOARD',  'View admin dashboard and telemetry', 1),
    ('MANAGE_USERS',            'Promote, demote, ban platform users', 2),
    ('MANAGE_DEV_TOKENS',       'Create and revoke developer API tokens', 4),
    ('BYPASS_RATE_LIMITS',      'Skip registration and message rate limits', 8),
    ('VIEW_PLATFORM_STATS',     'See user counts, message volumes, growth', 16),
    ('IMPERSONATE_TIER',        'Test as any account tier (dev tool)', 32),
    ('MANAGE_PLATFORM_BOTS',    'Configure default AI agent settings', 64),
    ('VIEW_AUDIT_LOG',          'See platform-wide audit trail', 128),
    ('MANAGE_WAITLIST',         'View and export waitlist emails', 256),
    ('FEATURE_FLAGS',           'Toggle feature flags for rollout', 512)
ON CONFLICT (name) DO NOTHING;

-- ── Map permissions to roles ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_role_permissions (
    role_name   VARCHAR(20) NOT NULL REFERENCES platform_roles(role_name),
    permission_id INT NOT NULL REFERENCES platform_permissions(id),
    PRIMARY KEY (role_name, permission_id)
);

-- Admin gets everything
INSERT INTO platform_role_permissions (role_name, permission_id)
SELECT 'admin', id FROM platform_permissions
ON CONFLICT DO NOTHING;

-- Dev gets: bypass rate limits, impersonate tier, view stats, manage dev tokens
INSERT INTO platform_role_permissions (role_name, permission_id)
SELECT 'dev', id FROM platform_permissions
WHERE name IN ('BYPASS_RATE_LIMITS', 'IMPERSONATE_TIER', 'VIEW_PLATFORM_STATS', 'MANAGE_DEV_TOKENS')
ON CONFLICT DO NOTHING;

-- ── Pre-generate dev accounts ───────────────────────────────────────────
-- These are created empty. Run a script to set passwords.
-- Passwords should be generated and stored securely offline.

-- Dev accounts are created via API or script, not in migration.
-- See: POST /api/v1/admin/generate-dev-accounts

-- ── Guest display name generator seed ───────────────────────────────────

CREATE TABLE IF NOT EXISTS guest_name_pool (
    id      SERIAL PRIMARY KEY,
    adjective VARCHAR(30) NOT NULL,
    noun      VARCHAR(30) NOT NULL
);

INSERT INTO guest_name_pool (adjective, noun) VALUES
    ('Swift', 'Fox'), ('Silent', 'Owl'), ('Brave', 'Wolf'),
    ('Calm', 'River'), ('Sharp', 'Eagle'), ('Bright', 'Star'),
    ('Dark', 'Raven'), ('Iron', 'Bear'), ('Quick', 'Hawk'),
    ('Cold', 'Wind'), ('Red', 'Phoenix'), ('Blue', 'Falcon'),
    ('Wild', 'Tiger'), ('Grey', 'Storm'), ('Gold', 'Lion'),
    ('Frost', 'Dragon'), ('Shadow', 'Panther'), ('Ember', 'Viper'),
    ('Crystal', 'Dove'), ('Thunder', 'Shark')
ON CONFLICT DO NOTHING;

-- ── Index for fast platform_role lookups ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_platform_role ON users(platform_role)
    WHERE platform_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_account_tier ON users(account_tier);
