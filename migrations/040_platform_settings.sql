-- Platform-wide settings (kill switches, maintenance mode, etc.)
CREATE TABLE IF NOT EXISTS platform_settings (
    key   VARCHAR(64) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT 'true'::jsonb
);

-- Seed defaults so queries always find rows.
INSERT INTO platform_settings (key, value) VALUES
    ('registrations_enabled', 'true'::jsonb),
    ('logins_enabled',        'true'::jsonb),
    ('guest_access_enabled',  'true'::jsonb),
    ('ai_bots_enabled',       'true'::jsonb),
    ('maintenance_mode',      'false'::jsonb),
    ('maintenance_message',   '"The platform is undergoing scheduled maintenance. Please try again shortly."'::jsonb)
ON CONFLICT (key) DO NOTHING;
