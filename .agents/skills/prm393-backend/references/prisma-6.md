# Prisma 6.4.1 in PRM393

Read this reference for database work. Recheck package.json and the generated client if dependencies change. This document is maintained for this repository, not an installed upstream Prisma 7 skill.

## Version boundary

- Keep `prisma` and `@prisma/client` at the project's matching versions unless an upgrade is requested.
- The schema uses `provider = "prisma-client-js"`; import `Prisma` and `PrismaClient` from `@prisma/client` and inject the existing PrismaService in features.
- Keep `url = env("DATABASE_URL")` in the schema datasource. Do not introduce Prisma 7 generator paths, mandatory driver adapters or its configuration layout just because a current example uses them.
- Use installed tools through `npx --no-install prisma ...`; do not use `@latest` for routine work. Generated types are the first compatibility check for query options.

## Queries and public data

Use explicit selects when returning user data. For example, in an injected service:

```typescript
return this.prisma.user.findMany({
  where: { isActive: true },
  select: { id: true, email: true, firstName: true, lastName: true },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  take: limit, // validated and bounded by the request DTO
});
```

Choose pagination appropriate to the API; keep ordering deterministic. Use relation queries/selects or batch queries instead of loops of database calls. Add indexes based on actual filters and ordering. Use tagged `$queryRaw` with bound values when raw SQL is necessary; never interpolate untrusted SQL identifiers or fragments.

## Transactions and concurrent writes

Use nested writes or an interactive transaction for operations that need a generated ID from an earlier write. `$transaction([...])` is suitable when operations can be constructed independently. All writes in an interactive transaction must use its `tx` client, including calls delegated to helpers; pass `Prisma.TransactionClient` where needed.

For refresh rotation, a prior read followed by an unconditional update is insufficient. After verifying the presented token belongs to the session, consume it conditionally inside the same transaction as storing the replacement hash:

```typescript
const consumed = await tx.refreshToken.updateMany({
  where: {
    id: sessionId,
    userId,
    isRevoked: false,
    expiresAt: { gt: new Date() },
  },
  data: { isRevoked: true },
});
if (consumed.count !== 1) {
  throw new ForbiddenException('Refresh session is unavailable');
}
// Store the already prepared replacement token hash through tx here.
// Return the token only after the transaction commits.
```

This is a pattern fragment, not a replacement for signature/hash verification, account-state checks or the surrounding session policy. Test simultaneous use: only one request should consume a given session. Keep expensive hashing and external network calls outside short database transactions where possible. Use bounded retries only for known retryable transaction failures; do not retry arbitrary business failures.

## Errors and migrations

- Catch `Prisma.PrismaClientKnownRequestError` when mapping a known error: P2002 can map to a duplicate conflict, P2025 to not-found where appropriate. Do not expose raw database details or classify every database error as bad input.
- For schema changes: format, validate, generate, then build against generated types. Schema validation needs a syntactically valid DATABASE_URL; it does not establish database connectivity.
- Review migration SQL for data loss, locking, constraints and backfill requirements. `migrate dev --create-only` still connects to a development/shadow database; it is not an offline or universally side-effect-free command.
- Existing databases without migration history may need baselining; do not assume the current schema can be applied as a fresh migration.
- Apply `migrate dev` only to the intended development database. `migrate deploy` belongs to an authorized deployment workflow. Do not run reset or destructive db push as verification.

## Sources and compatibility checks

- Installed source of truth: `package.json`, `prisma/schema.prisma`, `src/prisma/prisma.service.ts`, generated `node_modules/.prisma/client/index.d.ts`.
- Prisma 6.4.1 source: https://github.com/prisma/prisma/tree/6.4.1
- Official skill collection: https://github.com/prisma/skills (current guidance targets later Prisma versions; consult selectively).
- Transactions: https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Prisma 7 migration differences: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
