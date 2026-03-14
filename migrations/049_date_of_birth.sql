-- 049: Add date_of_birth column to users (COPPA compliance).
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
