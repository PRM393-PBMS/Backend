-- Existing Prisma model uses UUID roles, while a fresh migration chain still
-- creates SMALLINT roles. Preserve every assignment when upgrading that baseline.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roles' AND column_name='id' AND data_type='smallint') THEN
    ALTER TABLE users DROP CONSTRAINT users_role_id_fkey;
    ALTER TABLE users ALTER COLUMN role_id DROP DEFAULT;
    ALTER TABLE roles ALTER COLUMN id TYPE uuid USING md5('pbms:role:' || id::text)::uuid;
    ALTER TABLE users ALTER COLUMN role_id TYPE uuid USING md5('pbms:role:' || role_id::text)::uuid;
    ALTER TABLE users ADD CONSTRAINT users_role_id_fkey FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
COMMIT;
