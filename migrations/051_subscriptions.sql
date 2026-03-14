-- 051_subscriptions.sql — Subscription tracking for paid tiers.
--
-- Tracks who has a paid tier, when it started/expires, and the payment
-- processor reference (Stripe customer ID, etc.). The server never
-- processes payments directly — a future webhook handler from Stripe/
-- Paddle will INSERT/UPDATE rows here.
--
-- The account_tier column on users remains the source of truth for
-- access control.  This table exists to track *why* a user has that
-- tier and *when* it expires.

CREATE TABLE IF NOT EXISTS subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    tier            VARCHAR(20) NOT NULL DEFAULT 'pro',       -- pro | teams | enterprise
    status          VARCHAR(20) NOT NULL DEFAULT 'active',    -- active | cancelled | past_due | trialing
    payment_provider VARCHAR(32),                             -- stripe | paddle | manual | null
    provider_customer_id  VARCHAR(256),                       -- e.g. cus_xxx
    provider_subscription_id VARCHAR(256),                    -- e.g. sub_xxx
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,                         -- null = lifetime
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub
    ON subscriptions(payment_provider, provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;
