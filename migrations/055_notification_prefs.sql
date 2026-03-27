-- Migration 055: Notification preferences — event and email reminder toggles
-- Extends server_notification_settings with event-specific controls.

ALTER TABLE server_notification_settings
    ADD COLUMN IF NOT EXISTS event_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS email_reminders BOOLEAN NOT NULL DEFAULT FALSE;
