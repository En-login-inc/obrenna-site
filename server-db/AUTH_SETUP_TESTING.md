# Auth System Setup & Testing Guide

This guide walks through setting up and testing the Obrenna centralized auth system with Postgres backend.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ and npm
- PostgreSQL client tools (`psql`, optional but helpful)

## Local Setup

### Step 1: Initialize Postgres Database

```bash
# From project root
docker-compose -f docker-compose.auth.yml up -d
```

Wait for the container to be healthy (healthcheck should pass):

```bash
docker-compose -f docker-compose.auth.yml logs postgres-auth
# Look for: "database system is ready to accept connections"
```

### Step 2: Load Schema & Sample Data

Navigate to the site directory and run the bootstrap script:

```bash
cd obrenna-site
npm run setup:auth-db
```

You should see output like:
```
✓ Connected to auth database
✓ Schema tables created (8 tables)
✓ Sample plans seeded (starter, pro)
✓ Database ready for testing
```

### Step 3: Verify Schema

List tables to confirm:

```bash
psql -h localhost -U obrenna -d obrenna-server-db -c "\dt"
```

Expected output:
```
                  List of relations
 Schema |          Name          | Type  | Owner
--------+------------------------+-------+-------
 public | auth_sessions          | table | obrenna
 public | billing_events         | table | obrenna
 public | desktop_auth_devices   | table | obrenna
 public | organization_memberships | table | obrenna
 public | organizations          | table | obrenna
 public | plans                  | table | obrenna
 public | subscriptions          | table | obrenna
 public | users                  | table | obrenna
```

### Step 4: Start the Development Server

```bash
cd obrenna-site
npm install --legacy-peer-deps  # if not already done
npm run dev
```

Server starts on `http://localhost:4321`

## Testing Auth Flow

### Test 1: Web Sign-Up

1. Navigate to `http://localhost:4321/sign-up`
2. Fill in:
   - Name: `Test User`
   - Email: `test@example.com`
   - Password: `TestPassword123!`
3. Click Sign Up
4. Should redirect to `/onboarding/create-organization`

Verify in database:

```bash
psql -h localhost -U obrenna -d obrenna-server-db -c "SELECT id, email, full_name, status FROM users WHERE email = 'test@example.com';"
```

### Test 2: Web Sign-In

1. Navigate to `http://localhost:4321/sign-in`
2. Enter the credentials from Test 1
3. Click Sign In
4. Should redirect to `/onboarding/create-organization`

### Test 3: Sign-In with Desktop Callback

Test the deep-linking flow by sending a sign-in request with a desktop callback:

```bash
curl -X POST http://localhost:4321/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "desktop_callback": "obrenna://auth?action=auth-callback"
  }' \
  -i
```

The response should be a redirect (302):

```
HTTP/1.1 302 Found
Location: obrenna://auth?action=auth-callback&token=<uuid>&expires_at=<iso8601>&user_id=<uuid>&email=test@example.com&billing_status=trialing&Set-Cookie: ...
```

Extract the token from the URL and parse the parameters:

```bash
# Extract from the curl response above
TOKEN="<uuid-from-token-param>"
EXPIRES_AT="<iso8601-from-expires_at-param>"

# Verify token in database
psql -h localhost -U obrenna -d obrenna-server-db -c "SELECT id, user_id, expires_at, status FROM auth_sessions WHERE session_token = '$TOKEN';"
```

### Test 4: Get Current User

Using the session from Test 3, you can test the `/api/auth/me` endpoint:

```bash
curl http://localhost:4321/api/auth/me \
  -H "Cookie: obrenna_auth=session:$TOKEN"
```

Response:

```json
{
  "ok": true,
  "user": {
    "id": "...",
    "email": "test@example.com",
    "full_name": "Test User",
    "status": "active"
  }
}
```

### Test 5: Refresh Token

Before the session expires, refresh it:

```bash
curl -X POST http://localhost:4321/api/auth/refresh \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "ok": true,
  "session": {
    "id": "...",
    "expires_at": "2026-10-30T..."
  }
}
```

The new `expires_at` should be 30 days from now.

### Test 6: Sign-Out

```bash
curl -X POST http://localhost:4321/api/auth/sign-out \
  -H "Authorization: Bearer $TOKEN"
```

Verify the session is revoked:

```bash
psql -h localhost -U obrenna -d obrenna-server-db -c "SELECT status FROM auth_sessions WHERE session_token = '$TOKEN';"
```

Should show `revoked`.

## Database Structure

### Users Table

Stores user identity.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,  -- PBKDF2-SHA256 format
  status VARCHAR(50) DEFAULT 'active',  -- active, suspended, deleted
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Organizations Table

Groups users for billing and permission management.

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Organization Memberships Table

Links users to organizations with roles.

```sql
CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',  -- owner, admin, member
  status VARCHAR(50) DEFAULT 'active',
  invited_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, organization_id)
);
```

### Auth Sessions Table

Tracks active sessions with expiry.

```sql
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'active',  -- active, revoked
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Subscriptions & Plans Tables

Track billing status (if Stripe integration added later).

```sql
CREATE TABLE plans (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  price_cents BIGINT NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  interval VARCHAR(50) DEFAULT 'month',
  features JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id BIGINT REFERENCES plans(id),
  status VARCHAR(50) DEFAULT 'trialing',  -- trialing, active, past_due, canceled
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  provider VARCHAR(50),  -- 'stripe', 'local'
  provider_customer_id VARCHAR(255),
  provider_subscription_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Troubleshooting

### Postgres Connection Failed

```bash
# Check if container is running
docker ps | grep postgres-auth

# Check logs
docker logs obrenna-postgres-auth

# Restart container
docker-compose -f docker-compose.auth.yml restart postgres-auth
```

### Schema Tables Not Created

```bash
# Check if bootstrap script ran
cd obrenna-site
npm run setup:auth-db

# Or manually load schema
psql -h localhost -U obrenna -d obrenna-server-db < ../auth-schema-postgres.sql
```

### Sign-In Says "Invalid Credentials"

1. Verify user exists in database:
   ```bash
   psql -h localhost -U obrenna -d obrenna-server-db -c "SELECT email FROM users WHERE email = 'test@example.com';"
   ```

2. If not found, sign up first via web UI at `http://localhost:4321/sign-up`

3. Check password is correct (passwords are case-sensitive)

### Session Token Not Working

1. Verify session is active:
   ```bash
   psql -h localhost -U obrenna -d obrenna-server-db -c "SELECT status, expires_at FROM auth_sessions WHERE session_token = 'YOUR_TOKEN';"
   ```

2. If `status = 'revoked'`, you need to sign in again

3. If `expires_at` is in the past, token has expired

## Desktop App Integration

Once the auth system is working, integrate into the Tauri desktop app:

1. Copy `backend/desktop_auth.py` → Desktop app's auth module (translated to TypeScript/Rust)
2. Implement deep-link handler for `obrenna://` scheme
3. Use `DesktopAuthClient` to manage login/callback/refresh flow
4. See [DESKTOP_AUTH_INTEGRATION.md](./DESKTOP_AUTH_INTEGRATION.md) for details

## Next Steps

- [ ] Add Stripe webhook integration for real billing status
- [ ] Implement session revocation by admin
- [ ] Add device management (list/revoke logged-in devices)
- [ ] Set up email verification flow
- [ ] Add password reset flow
- [ ] Implement MFA
