---
name: prm393-backend
description: Implement, debug, and review backend features in this PRM393 NestJS and Prisma repository, including REST endpoints, DTOs, JWT authorization, PostgreSQL models, and backend tests. Use for backend code changes, not unrelated documentation or frontend work.
---

# PRM393 backend development

Read root `AGENTS.md` first. Treat current source and package versions as authoritative when this guide becomes stale.

## Locate the change

- Inspect `package.json`, the affected module, adjacent DTOs/tests, and `prisma/schema.prisma` before editing.
- Current stack: NestJS 12 with Express, TypeScript strict mode with NodeNext, Prisma/client 6.4.1 with PostgreSQL, Passport/JWT, bcrypt, class-validator, Swagger, Jest and oxlint.
- Keep features under `src/<feature>/` with modules, controllers, services and `dto/`. Register providers/imports through Nest dependency injection. Reuse `src/prisma/prisma.service.ts`; do not create per-request Prisma clients or introduce TypeORM.
- Keep HTTP parsing and Swagger metadata in controllers, business rules in services, and database access through the injected Prisma service. Add abstractions only when the feature needs them.

## Implement API behavior

- Use class DTOs with class-validator decorators. Global ValidationPipe has `whitelist`, `forbidNonWhitelisted` and `transform` enabled. Explicitly validate/convert query parameters and bound pagination inputs.
- Import runtime DTO classes as values so decorator metadata is preserved; use type-only imports for interfaces such as Express Request.
- Match existing status codes, response DTOs, naming, and exception conventions. Keep Swagger request/response metadata aligned; protected endpoints use `@ApiBearerAuth('JWT-auth')`. Docs are at `/api/docs`; do not assume a global `/api` route prefix.
- Select or map public response fields explicitly. Never return database objects containing passwordHash or tokenHash.

## Preserve authorization

- `AtGuard` is registered globally in `src/app.module.ts`. Ordinary endpoints require access JWTs. Use `@Public()` only for intentionally exempt endpoints.
- Refresh uses `@Public()` to bypass the access guard and `@UseGuards(RtGuard)` to validate the refresh token. Do not remove that second guard.
- `RolesGuard` is not global. Role-restricted routes need both `@Roles(...)` and an applied RolesGuard. Check resource ownership separately from roles.
- Reuse current-user decorators, JWT strategies and HashingService. Do not accept privileged role/ownership fields directly from public DTOs.
- Keep password and refresh-token hashes out of logs and responses. Preserve expiry, revocation, inactive-user checks and session semantics. For changes to rotation, verify concurrent reuse is rejected and related writes are atomic; existing code is not proof of race safety.
- Read configuration by variable name; document new names in `.env.example` with placeholders. Do not copy real secrets into code, tests or documentation.

## Change persistence

Read [Prisma 6.4.1 guidance](references/prisma-6.md) when changing queries, transactions, schema or migrations. This project uses Prisma 6; current upstream Prisma skills may assume Prisma 7 and must not drive an unsolicited upgrade.

- Preserve schema conventions: UUID identifiers, mapped snake_case database names, timezone-aware timestamps, relations and explicit indexes as needed by queries.
- Use Prisma types and parameterized operations. Bound list queries; avoid N+1 queries. Use transactions for dependent writes that must succeed together.
- Translate known Prisma failures into appropriate Nest exceptions, including unique conflicts; do not swallow unexpected failures.
- For schema changes, run local `npx --no-install prisma format`, `npx --no-install prisma validate`, and `npx --no-install prisma generate` as applicable. Validation needs a DATABASE_URL value; do not invent a successful database connection.
- Create/review migrations for intended schema changes against an authorized development database. Do not run reset, destructive db push, or production migrations as a routine verification step. Report missing database access precisely.

## Verify the result

- Run `npm run lint` and `npm run build` for TypeScript changes; run relevant Jest tests with `npm test -- --runInBand <test-path>`.
- Add behavioral tests when changing business rules, auth or validation. Override PrismaService in unit tests; use an isolated test database for database integration tests.
- For HTTP tests, reproduce production ValidationPipe and guard configuration. Cover relevant success, invalid input, unauthenticated/forbidden, not-found and conflict cases, without adding irrelevant tests.
- Run `npm run test:e2e -- --runInBand` when the change affects HTTP integration and required test services/configuration are available. Report setup failures separately from regressions.
- Inspect the final diff. Summarize behavior changed, checks actually run, and remaining limitations. Do not edit generated `dist/`, node_modules or tsbuildinfo manually.
