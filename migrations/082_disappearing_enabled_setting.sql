-- Migration 082: Platform toggle for disappearing messages.
--
-- When false, the TTL PUT endpoints return 403 and the background
-- cleanup task skips deletion. Default: true (enabled).

INSERT INTO platform_settings (key, value)
VALUES ('disappearing_messages_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
