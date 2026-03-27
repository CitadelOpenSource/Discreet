-- 052_terms_accepted.sql — Track when user accepted Terms of Service.
--
-- Stores the client-reported timestamp of terms acceptance at registration.
-- Legally required for proof of consent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
