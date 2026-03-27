-- 103_tester_tier.sql — Add 'tester' account tier.
--
-- Testers get admin-level rate limits (100x multiplier) but read-only
-- access to the admin dashboard. They can view all panels but cannot
-- mutate platform settings, ban users, or toggle kill switches.

-- No CHECK constraint exists on account_tier (it's VARCHAR(20)),
-- so no ALTER needed. Just document the valid values:
-- guest, registered, unverified, anonymous, verified, pro, teams, enterprise, admin, tester

COMMENT ON COLUMN users.account_tier IS
  'Valid: guest, registered, unverified, anonymous, verified, pro, teams, enterprise, admin, tester';
