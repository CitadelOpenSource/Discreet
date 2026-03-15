-- Migration: Smart platform defaults.
--
-- thread_auto_archive_days: threads auto-archive metadata after N days.
-- Messages in archived threads remain accessible; only the thread
-- metadata (active/pinned status) is cleared. Default 7 days.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS thread_auto_archive_days INTEGER NOT NULL DEFAULT 7;
