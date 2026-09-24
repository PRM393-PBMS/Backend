import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.$queryRawUnsafe(
  `SELECT c.relname, c.relkind
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname ILIKE '%role%'
   ORDER BY 1`,
);
console.log(JSON.stringify(rows));
const cols = await p.$queryRawUnsafe(
  `SELECT table_name, column_name, data_type
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('users','roles','roles_old')
   ORDER BY table_name, ordinal_position`,
);
console.log(JSON.stringify(cols));
await p.$disconnect();
