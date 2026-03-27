-- AI configuration platform settings.
INSERT INTO platform_settings (key, value) VALUES
    ('ai_global_model',          '""'::jsonb),
    ('ai_rate_limit_per_minute', '0'::jsonb),
    ('ai_emergency_stop',        'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
