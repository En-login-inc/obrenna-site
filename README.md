# Obrenna Site

Marketing site plus the centralized auth/billing API for Obrenna, built with
[Astro](https://astro.build) and React islands. The site runs in server mode via
`@astrojs/node` so the `/api/auth/*` endpoints can talk to Postgres.

## Prerequisites

- Node.js 18+
- Docker Desktop (for the local auth database)

## Install

```bash
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required: `@astrojs/node@8` declares a peer dependency on
Astro 4 while this project runs Astro 5. The adapter works correctly regardless.

## 1. Set up the server database

The auth/billing Postgres instance lives entirely in [`server-db/`](./server-db):

| File | Purpose |
| --- | --- |
| `docker-compose.auth.yml` | Postgres 16 container (`obrenna-server-db` on port 5432) |
| `auth-schema-postgres.sql` | Tables, indexes, and seed plans |
| `scripts/setup-auth-db.ps1` | Bootstrap script (Windows) |
| `scripts/setup-auth-db.sh` | Bootstrap script (macOS / Linux) |

Run the bootstrap for your platform:

```bash
npm run setup:auth-db       # Windows (PowerShell)
npm run setup:auth-db:sh    # macOS / Linux
```

The script starts the container, waits for Postgres to accept connections,
applies the schema, and prints the resulting table list. It is idempotent — re-run
it any time the schema changes.

Expected output ends with:

```
Auth database ready: postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db
```

### Schema overview

| Table | Contents |
| --- | --- |
| `users` | Identity and password hashes (PBKDF2-SHA256) |
| `organizations` | Tenant records |
| `organization_memberships` | User ↔ organization roles |
| `plans` | Subscription tiers (seeded with `starter` and `pro`) |
| `subscriptions` | Billing state per organization |
| `billing_events` | Provider webhook audit log |
| `auth_sessions` | Active sessions and expiry |
| `desktop_auth_devices` | Registered desktop clients |

Application data (chat history, artifacts) is **never** stored here — that stays in
the desktop app's local SQLite database.

### Useful database commands

```bash
# Open a psql shell
docker compose -f server-db/docker-compose.auth.yml exec postgres-auth \
  psql -U obrenna -d obrenna-server-db

# Stop the database (data is preserved)
docker compose -f server-db/docker-compose.auth.yml down

# Destroy the database and start clean
docker compose -f server-db/docker-compose.auth.yml down -v
npm run setup:auth-db
```

## 2. Configure environment variables

Copy the sample file and adjust as needed:

```bash
cp .env.example .env.local
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DB_URL` | `postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db` | Postgres connection string |
| `AUTH_SESSION_TTL_DAYS` | `30` | Session lifetime |
| `ALLOW_BILLING_ONLY_SYNC` | `true` | Restricts desktop sync to billing/identity data |
| `SITE_API_BASE_URL` | `http://localhost:4321` | Base URL used by the desktop client |
| `APP_ENV` | `development` | Environment marker |

The defaults work out of the box against the Dockerized database, so `.env.local`
is optional for local development.

## 3. Run the site

```bash
npm run dev
```

The site is served at http://localhost:4321.

Other scripts:

```bash
npm run build      # type-check, then production build
npm run preview    # serve the production build
npm run typecheck  # astro check only
```

## Verifying the auth API

With the database running and the dev server up:

```bash
curl -X POST http://localhost:4321/api/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User","password":"SecurePassword123!"}'
```

Available endpoints under `/api/auth/`:

| Endpoint | Method | Description |
| --- | --- | --- |
| `sign-up` | POST | Create a user and session |
| `sign-in` | POST | Authenticate and issue a session |
| `sign-out` | POST | Revoke the current session |
| `me` | GET | Current user from the session cookie |
| `refresh` | POST | Extend a session (used by the desktop app) |
| `organizations` | GET | Organizations for the current user |
| `billing/portal` | POST | Billing portal handoff |
| `billing/sync-status` | GET | Current billing status |

## Project layout

```
obrenna-site/
├── server-db/            # Postgres compose file, schema, bootstrap scripts
├── src/
│   ├── components/       # Astro components and React islands
│   ├── layouts/
│   ├── lib/              # auth-config, auth-db, auth-helpers, API clients
│   ├── pages/
│   │   └── api/auth/     # Auth endpoints (extractable into a standalone service)
│   └── styles/
└── astro.config.mjs
```

The auth API is deliberately self-contained: everything it needs lives in
`src/pages/api/auth/`, `src/lib/auth-*.ts`, and `server-db/`. Removing those
directories leaves the rest of the site fully functional as a static build.

## Further reading

- [server-db/DESKTOP_AUTH_INTEGRATION.md](./server-db/DESKTOP_AUTH_INTEGRATION.md) — desktop deep-link auth flow
- [server-db/AUTH_SETUP_TESTING.md](./server-db/AUTH_SETUP_TESTING.md) — end-to-end test procedures

## Troubleshooting

**`npm install` fails with `ERESOLVE`** — use `npm install --legacy-peer-deps`.

**Bootstrap script reports `docker not found`** — start Docker Desktop and confirm
`docker compose version` works.

**API returns a connection error** — verify the container is running with
`docker compose -f server-db/docker-compose.auth.yml ps`, then re-run
`npm run setup:auth-db`.

**Port 5432 already in use** — stop the conflicting Postgres instance, or change the
host port in `server-db/docker-compose.auth.yml` and update `AUTH_DB_URL` to match.
