# Repository instructions

This repository is a NestJS backend using Prisma and PostgreSQL. Use npm and preserve the existing package-lock.json workflow. Read package.json for current versions and scripts.

For backend implementation, debugging or review, read and apply `.agents/skills/prm393-backend/SKILL.md`. It contains the repository-specific API, authentication, persistence and verification workflow. Explicit user requests take precedence over these defaults.

- Preserve unrelated working-tree changes. Keep changes within the requested task.
- Follow existing feature modules in `src/`; reuse `src/prisma/` and the auth guards/decorators in `src/auth/`.
- Do not add dependencies, change frameworks, or introduce broad architecture changes unless the task calls for them.
- Never commit secrets or use a production database for tests. Database migrations need the intended environment and scope established first.
- Use oxlint via `npm run lint`, Prettier for formatting, and Jest for tests. Avoid whole-repository formatting for a small change.
- Check code changes with relevant tests, lint and build. Documentation/rules-only changes need structural and link checks, not backend execution.
- Respond in the user's language; keep code identifiers consistent with the repository. Report actual checks and any blockers honestly.

Cursor also loads scoped rules from `.cursor/rules/`. Keep those rules consistent with the backend skill when conventions change.

## Additional skills

- For NestJS implementation/refactoring, read `.agents/skills/nestjs-best-practices/SKILL.md` and only its relevant rule files after the project backend skill. Project conventions and installed versions take precedence over generic examples. TypeORM examples do not authorize adding TypeORM or changing the data layer.
- For Prisma queries, transactions or migrations, read `.agents/skills/prm393-backend/references/prisma-6.md`. Keep compatibility with Prisma 6.4.1; do not apply Prisma 7 setup instructions automatically.
- For an explicit request for security guidance, a security review or secure-by-default coding, use `.agents/skills/security-best-practices/SKILL.md`. Start with its Express backend reference for this NestJS/Express app, translating middleware examples into Nest constructs. It is not a dedicated NestJS security guide; validate framework-specific recommendations. Ordinary feature work does not require a separate security audit.
- Load supporting references on demand. Do not read every installed skill or all reference files for every task.
