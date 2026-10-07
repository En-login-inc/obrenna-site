# Website identity and grant setup

The website’s PostgreSQL database is the authority for accounts, organizations, memberships, registered desktop devices, model assignments, and inference-grant policy. The desktop’s local SQLite database remains separate and stores local conversation and artifact state.

## Local development

Requirements: Node.js/npm, Docker Desktop with its Linux container engine, and PostgreSQL client tools if you want to inspect the schema directly.

1. Copy `.env.example` to `.env` and set `AUTH_DB_URL`. Keep credentials local.
2. Start PostgreSQL and apply the base schema plus ordered migrations:

   ```powershell
   npm run setup:auth-db
   ```

   On macOS/Linux, use `npm run setup:auth-db:sh`. The scripts wait for PostgreSQL readiness, apply the base schema, and run ordered migrations through a checksum ledger in `schema_migrations`. An applied migration that is later edited fails closed; add a new migration instead. Validate upgrade behavior against a disposable database before relying on it for production.
3. Start the Astro Node server:

   ```sh
   npm run dev
   ```

4. Run contract tests and the production build:

   ```sh
   npm run test:auth
   npm run build
   ```

## Desktop authorization flow

Authenticate through the normal sign-in form. The desktop starts authorization with an S256 PKCE challenge and random state. The site redirects to `obrenna://auth` with a two-minute, single-use code and the original state; it never returns a long-lived session token in the redirect URL. The desktop validates state and exchanges the code and verifier through its native backend. Store returned credentials in the OS credential vault.

Relevant routes in the Astro auth API include `POST /api/auth/desktop-authorize`, `GET /api/auth/desktop-callback`, `POST /api/auth/desktop-exchange`, `POST /api/auth/inference-grant`, and `GET /api/auth/inference-grant-status`. All require the appropriate active website session or registered desktop identity. Do not test by copying credentials into a browser URL or shell history.

## Inference-grant configuration

Configure these deployment values through a secret manager:

- `SITE_PUBLIC_ORIGIN`: one canonical origin; HTTPS is required in production.
- `INFERENCE_GRANT_KEY_ID`: public key identifier (`kid`).
- `INFERENCE_GRANT_PRIVATE_KEY`: RS256 private key in PEM format.
- `AUTH_DB_URL`: PostgreSQL connection string for identity and authorization state.

The private signing key must never be checked into source control. Public keys are served from `/.well-known/jwks.json`. Grants expire within 24 hours and do not self-extend when the site is unreachable. Revocation or a newer policy revision denies a cached grant when the site can report it.

## Test coverage and deployment gate

`npm run test:auth` verifies signing configuration, key-discoverable RS256 grants, expiration, unconfigured mutations, organization-scoped membership reads and updates, and stale-policy denial. These are contract tests; they do not prove that SQL migrations work against a real PostgreSQL server or that the packaged desktop callback and OS-vault path works end to end.

Before production, apply migrations to a disposable PostgreSQL instance from both an empty schema and a copy of the supported previous schema, then verify a `pg_dump`/`pg_restore` round trip preserves the migrated schema and representative identity, membership, and device rows. CI runs these checks against PostgreSQL 16, matching the local development Compose service; production should use a supported PostgreSQL release and pass the same migration and restore checks before rollout. Separately verify operational rollback and restore procedures against the production backup policy, then run the packaged desktop sign-in, PKCE exchange, grant issuance, policy refresh, and revocation scenarios. Also test expired grants and site outage. Do not treat CI's disposable-database restore check or a successful static build as production backup or deployment certification.

The repeatable schema checks run against actual PostgreSQL databases. Set `MIGRATION_TEST_ADMIN_URL` to a disposable PostgreSQL database URL whose role can create and drop databases, then run `npm run test:auth:migrations:postgres`; `pg_dump` and `pg_restore` must also be installed. The test creates uniquely named fresh-install, pre-migration, and restore-target databases, applies the tracked migration twice, restores a custom-format backup of the upgraded schema, checks schema and retained fixture rows, and drops all three databases. Never point this command at a production database.

After `npm run build`, run `npm run test:auth:desktop-postgres` with the same disposable admin URL to exercise the built website’s PKCE authorization, state validation, one-use code exchange, RS256 grant, JWKS publication, and membership-revocation path over HTTP. This test also creates and drops its own database; it never uses the site’s regular `AUTH_DB_URL`.
