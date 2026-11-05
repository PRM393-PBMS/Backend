import { Prisma } from '@prisma/client';
export type Db = Prisma.TransactionClient;

/** Transaction-scoped locks include guest plates; values are always bound parameters. */
export async function lockResource(tx: Db, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
