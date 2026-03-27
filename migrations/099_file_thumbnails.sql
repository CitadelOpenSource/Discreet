-- 099_file_thumbnails.sql — Add thumbnail_blob column for image file previews.
--
-- Stores a 200px client-generated thumbnail alongside the full-size image.
-- Both are encrypted client-side — the server stores opaque blobs.

ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS thumbnail_blob TEXT;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE file_blobs ADD COLUMN IF NOT EXISTS height INTEGER;
