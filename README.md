# PRM393 Parking Management Backend

REST API for a parking management system (PBMS) built for the PRM393 course at FPT University. It handles user accounts and roles, parking catalog data, reservations, check-in/check-out sessions, monthly subscriptions, payments, incidents and reports. A mobile or web client talks to it over HTTP; Swagger UI is included for trying requests.

API base: all business routes live under `/api/*`. Login is `POST /api/Auth/login` (JWT bearer token).

## Key features

- **Auth**: login, OTP by email for registration and password reset, refresh and logout, JWT with role checks.
- **Catalog**: vehicle types, floors, gates, parking slots, price lists, parking plans.
- **Reservations** with a scheduled job that updates their status.
- **Parking sessions**: QR codes and licence-plate recognition from uploaded images.
- **Subscriptions** (monthly plans, renewal, vehicle change) and **wallets**.
- **Payments** through PayOS, including webhook handling.
- **Incidents** and **PDF reports**.

## Tech stack

- Node.js, TypeScript, NestJS 12 (Express)
- Prisma 6 with PostgreSQL (Supabase when hosted)
- Redis (OTP storage), JWT / Passport, bcrypt
- Resend (email), PayOS (payments), Plate Recognizer (plate OCR)
- PDFKit, sharp, qrcode / jsQR
- Swagger (`@nestjs/swagger`), Jest, Oxlint, Prettier
- Docker and Docker Compose

## Project structure

```
src/
├── auth/  users/  roles/            # accounts, profile, roles
├── catalog/  reservations/  parking/
├── subscriptions/  wallets/  payments/
├── incidents/  reports/
├── integrations/                    # PayOS, Plate Recognizer, file storage
├── prisma/  common/
└── main.ts
prisma/        # schema.prisma and migrations
docs/          # deployment and setup notes
test/
Dockerfile  compose.yaml  .env.example
```

## Getting started

Prerequisites: Node.js 22 or newer, npm, and PostgreSQL. Redis is needed for OTP (see `.env.example`).

```bash
npm ci --include=dev
cp .env.example .env          # fill in your own values
npx prisma generate
npx prisma migrate deploy     # only on a new, empty development database
npm run start:dev
```

Then open `http://localhost:3000/api/docs` for Swagger. `GET /health` returns a simple liveness response.

### Run with Docker

```bash
docker compose up -d --build
```

Compose starts the backend and a Redis container and overrides `REDIS_URL`, `PORT`, `NODE_ENV` and `UPLOAD_DIR`. Your `.env` still has to provide the database URL and secrets.

### Environment variables (names only)

- Server: `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `PUBLIC_API_URL`
- Database / cache: `DATABASE_URL`, `REDIS_URL`, `POSTGRES_PASSWORD`
- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- Email (Resend): `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_SENDER_NAME`, `MAIL_REPLY_TO`, `MAIL_BRAND_COLOR`
- PayOS: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL`
- Plate Recognizer: `PLATE_RECOGNIZER_API_KEY`, `PLATE_RECOGNIZER_ENDPOINT`, `PLATE_RECOGNIZER_REGIONS`, `PLATE_RECOGNIZER_MINIMUM_CONFIDENCE`
- Files: `UPLOAD_DIR`

Never commit real keys or database URLs.

### Useful scripts

`npm run start:dev`, `npm run build`, `npm run start:prod`, `npm run lint`, `npm test`, `npm run test:cov`.

## Deployment

Hosted on Render (https://prm393backend.onrender.com) with PostgreSQL on Supabase. Render settings used: build `npm ci --include=dev && npx prisma generate && npm run build`, start `npm run start:prod`, health check path `/health`. The free plan can sleep when idle, so the first request may be slow. See `docs/` for the environment, Resend and health-check notes.

## Credits

PRM393-PBMS team, FPT University.

## License

MIT, see [LICENSE](LICENSE).
