# Obrenna Site

Marketing site plus the centralized identity and organization-policy API for Obrenna, built with
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
| `migrations/` | Ordered PostgreSQL upgrades tracked by checksum |

Run the bootstrap for your platform:

```bash
npm run setup:auth-db       # Windows (PowerShell)
npm run setup:auth-db:sh    # macOS / Linux
```

The scripts start the container, wait for Postgres, apply the idempotent base schema,
and apply pending ordered migrations. Migration name and SHA-256 checksum are stored in
`schema_migrations`; editing an applied migration causes a hard error. Add a new numbered
migration for future changes. Run upgrades against a disposable copy and verify backup
recovery before production deployment.

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
| `inference_guardrails` | Per-organization Ollama request policy and revision |
| `inference_hosts` | Registered model hosts and outbound heartbeat |
| `inference_clients` | Individually enrolled, revocable Obrenna computers |
| `inference_enrollment_codes` | Hashed, single-use 15-minute enrollment codes |
| `organization_inference_machines` | Organization-owned inference machine identities |
| `organization_model_access` | Explicit machine/model authorization assignments |
| `desktop_authorization_codes` | Short-lived, single-use PKCE desktop handoff codes |
| `schema_migrations` | Applied migration names and checksums |

Application data (chat history, artifacts) is **never** stored here — that stays in
the desktop app's local SQLite database.

### Ollama host and inference guardrails

Set `INFERENCE_PAIRING_JWT_SECRET` (or the existing `MACHINE_PAIRING_SECRET`)
in the site environment to a unique, cryptographically random value of at
least 32 bytes before using managed host installation. For example, generate
one with `openssl rand -base64 48`. Do not reuse an example value or commit a
real secret. The site uses this secret to sign short-lived, one-use installer
and host-pairing JWTs.

For platform installs, configure `OBRENNA_SERVER_GITHUB_TOKEN` in the **site
server's** environment with a GitHub fine-grained personal access token that
has access only to the private `Obrenna-Server` repository and **Contents:
Read-only** permission. Also set `OBRENNA_SERVER_GITHUB_REPOSITORY` and
`OBRENNA_SERVER_GITHUB_REF` if the repository or install branch differs from
the defaults. Keep this credential on the server; never put it in `.env` files
committed to source, browser code, or generated commands. The site uses each
short-lived install JWT to authorize downloads of the installer and source
archive through a private GitHub proxy. Local-checkout development installs do
not require this GitHub credential.

For local development, add the token to the untracked `obrenna-site/.env.local`
file and restart `npm run dev`. If the install command's first
`Invoke-WebRequest` returns HTTP 503, verify that this setting is present in
the running site's environment; the API returns 503 when the private-repository
credential is missing.

Organization owners/admins can create a platform-specific install command from
**Portal → Machines**. The command installs the server runtime and Ollama,
starts Ollama and Obrenna-Server, then opens or prints a short-lived approval
link. After an owner/admin signs in and approves the host, it is linked to the
organization and receives policy on its next outbound sync. No inbound internet
connection to the LAN is needed. The installer does not pull a model; choose
one that suits the host, then allow its exact model ID in **Portal → LLM
guardrails**.

The installer command expires after 15 minutes and can bootstrap one host. The
approval link is single-use and expires after 30 minutes. Ongoing host sync
uses a separate random host credential stored locally on the host, not the
pairing JWT. Do not share the generated command or approval link.

Generate a one-time client code and redeem it in the Obrenna desktop app under
**Settings → Engine → Remote → Connect to an Obrenna model host**. Each client
gets its own revocable credential. Use **Portal → LLM guardrails** to allow exact
Ollama model IDs, cap per-client request rate and text size, reject configured
literal terms, and enable common sensitive-data pattern checks. Policies fail
closed until a model is explicitly allowed. Apply schema updates by re-running
`npm run setup:auth-db`.

See [the Obrenna-Server README](../Obrenna-Server/README.md) for host setup and
the limits of the built-in sensitive-data checks.

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
| `INFERENCE_PAIRING_JWT_SECRET` or `MACHINE_PAIRING_SECRET` | required for managed host installation | Random secret of at least 32 bytes used to sign one-time server installation and pairing JWTs |
| `OBRENNA_SERVER_GITHUB_TOKEN` | required for platform installs | Server-side fine-grained GitHub token with read-only Contents access to the private Obrenna-Server repository |
| `OBRENNA_SERVER_GITHUB_REPOSITORY` | `En-login-inc/Obrenna-Server` | Private repository used for authenticated installer and source downloads |
| `OBRENNA_SERVER_GITHUB_REF` | `main` | Branch, tag, or commit ref to install |
| `APP_ENV` | `development` | Environment marker |
| `SITE_PUBLIC_ORIGIN` | `http://localhost:4321` | Canonical signed-grant issuer; production requires HTTPS |
| `INFERENCE_GRANT_KEY_ID` | — | Signing key identifier (`kid`) |
| `INFERENCE_GRANT_PRIVATE_KEY` | — | RS256 grant-signing key; configure through a secret manager |
| `CONTROL_PLANE_URL` | `http://localhost:8000` | FastAPI control-plane base URL (portal fleet data) |
| `CONTROL_PLANE_ASSERTION_KEY_ID` | — | Portal assertion key identifier (`kid`) |
| `CONTROL_PLANE_ASSERTION_PRIVATE_KEY` | — | RS256 portal assertion key; the control plane holds the matching public key |
| `CONTROL_PLANE_TIMEOUT_MS` | `10000` | Control-plane request timeout |

The defaults work out of the box against the Dockerized database, so `.env.local`
is optional for local development. After changing `.env.local`, restart the
Astro dev server so server routes pick up the updated environment.
The local database default works with Docker Compose. Desktop inference-grant issuance also
requires a development signing key; never use a development key in production.

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
npm run test:auth  # website authorization contract tests
npm run migrate:auth-db # apply pending migrations to AUTH_DB_URL
```

## Control-plane portal integration

The organization/employee portals render live operational data (machines, MCP
servers, models, policies, audit) from the GrebGlob FastAPI control plane. The
browser only ever talks to same-origin `/api/portal/*` Astro routes; the Astro
server validates the website session, resolves the active organization and
role from the site database, and forwards the request with a short-lived
RS256 assertion (`sub` = site user, `org` = organization, `role` = role,
`exp` ≤ 120s). The signing key never leaves the site server.

Production requires `CONTROL_PLANE_ASSERTION_*` to be configured; portal
requests fail closed (503) when the signing material is missing or when the
control plane has no trusted key (env var `OBRENNA_PORTAL_SIGNING_PUBLIC_KEY`
or `OBRENNA_PORTAL_SIGNING_PUBLIC_KEY_PATH` on the FastAPI side). Portal
mutations that the control plane does not implement yet stay disabled with a
clear message.

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
| `desktop-authorize` | POST | Start a PKCE-bound desktop authorization handoff |
| `desktop-callback` | GET | Issue a single-use code to the registered native callback |
| `desktop-exchange` | POST | Exchange the code and verifier for desktop credentials |
| `inference-grant` | POST | Issue an organization and device scoped signed grant |
| `inference-grant-status` | POST | Check current policy and revocation status using the signed grant in the request body |

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
