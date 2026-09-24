-- Additive: profile picture URL on existing users table.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(2048);
