-- 102_anon_disabled.sql — Platform setting to disable anonymous registration.

INSERT INTO platform_settings (key, value) VALUES
    ('anon_disabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
