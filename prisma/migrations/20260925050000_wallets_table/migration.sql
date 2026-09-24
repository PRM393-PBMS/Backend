-- Move balance off users onto wallets. Safe if users.wallet_balance was never applied.

CREATE TABLE IF NOT EXISTS "wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" DECIMAL(15, 2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallets_user_id_key" ON "wallets"("user_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallets_user_id_fkey'
    ) THEN
        ALTER TABLE "wallets"
            ADD CONSTRAINT "wallets_user_id_fkey"
            FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill wallets from users.wallet_balance when that column exists.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'wallet_balance'
    ) THEN
        INSERT INTO "wallets" ("id", "user_id", "balance", "created_at", "updated_at")
        SELECT gen_random_uuid(), u."id", u."wallet_balance", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "users" u
        WHERE NOT EXISTS (
            SELECT 1 FROM "wallets" w WHERE w."user_id" = u."id"
        );
    END IF;
END $$;

-- Ensure a wallet exists for ledger rows that still point at users.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'wallet_transactions'
          AND column_name = 'user_id'
    ) THEN
        INSERT INTO "wallets" ("id", "user_id", "balance", "created_at", "updated_at")
        SELECT gen_random_uuid(), wt."user_id", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM (
            SELECT DISTINCT "user_id" FROM "wallet_transactions" WHERE "user_id" IS NOT NULL
        ) wt
        WHERE NOT EXISTS (
            SELECT 1 FROM "wallets" w WHERE w."user_id" = wt."user_id"
        );
    END IF;
END $$;

ALTER TABLE "wallet_transactions" ADD COLUMN IF NOT EXISTS "wallet_id" UUID;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'wallet_transactions'
          AND column_name = 'user_id'
    ) THEN
        UPDATE "wallet_transactions" wt
        SET "wallet_id" = w."id"
        FROM "wallets" w
        WHERE wt."wallet_id" IS NULL
          AND w."user_id" = wt."user_id";
    END IF;
END $$;

DELETE FROM "wallet_transactions" WHERE "wallet_id" IS NULL;

ALTER TABLE "wallet_transactions" ALTER COLUMN "wallet_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_wallet_transactions_wallet_id" ON "wallet_transactions"("wallet_id");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_wallet_id_fkey'
    ) THEN
        ALTER TABLE "wallet_transactions"
            ADD CONSTRAINT "wallet_transactions_wallet_id_fkey"
            FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "wallet_transactions" DROP CONSTRAINT IF EXISTS "wallet_transactions_user_id_fkey";
DROP INDEX IF EXISTS "idx_wallet_transactions_user_id";
ALTER TABLE "wallet_transactions" DROP COLUMN IF EXISTS "user_id";

ALTER TABLE "users" DROP COLUMN IF EXISTS "wallet_balance";
