-- Migration 027: Waitlist
-- Simple email collection for launch waitlist.

CREATE TABLE IF NOT EXISTS waitlist (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
