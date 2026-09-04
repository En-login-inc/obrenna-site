# Desktop ↔ Site Auth Integration

This document describes how the Obrenna desktop app integrates with the Obrenna site's centralized auth system.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Desktop App (Tauri)                       │
│  - Local SQLite database (chat history, artifacts)          │
│  - Uses site auth for identity validation                   │
│  - Stores billing-based auth expiry                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ deep-link: obrenna://auth?action=...
                       ↓
┌─────────────────────────────────────────────────────────────┐
│            Obrenna Site (Astro on Node adapter)             │
│  - Centralized auth endpoints: /api/auth/*                  │
│  - Postgres database for identity + billing                 │
│  - Redirects back to desktop with session token             │
└──────────────────────┬──────────────────────────────────────┘
                       │ redirect: obrenna://auth?token=xxx&expires_at=...
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                   Desktop App                               │
│  - Stores token locally with expiry                         │
│  - Checks expiry before making app API calls                │
│  - Refreshes token or prompts re-auth if expired            │
└─────────────────────────────────────────────────────────────┘
```

## Flow 1: Desktop User Signs In

### Step 1: Desktop app opens login URL

```javascript
// In Tauri app startup or login handler
import { getLoginUrl, handleAuthCallback, signOut } from '../../Obrenna/frontend/src/lib/siteAuth';

const auth = new DesktopAuthClient('obrenna://');
const loginUrl = auth.getLoginUrl(false); // false = sign in, true = sign up
// loginUrl = "https://obrenna.app/sign-in?desktop_callback=obrenna://&action=auth-callback"

window.open(loginUrl, '_blank'); // or use webview
```

### Step 2: User submits credentials on site

- Form calls `POST /api/auth/sign-in` with email + password
- Site verifies credentials against Postgres
- Site looks up user's organization and billing status
- Site redirects to `obrenna://auth?token=xxx&expires_at=...&billing_status=active`

### Step 3: Deep-link handler in desktop app

```javascript
// In Tauri app, handle deep-link
import { invoke } from '@tauri-apps/api/tauri';

function handleDeepLink(url: string) {
  const params = new URL(url).searchParams;
  
  auth.handleAuthCallback({
    token: params.get('token'),
    expires_at: params.get('expires_at'),
    user_id: params.get('user_id'),
    email: params.get('email'),
    org_id: params.get('org_id'),
    org_name: params.get('org_name'),
    billing_status: params.get('billing_status'),
  });
  
  // Now authenticated, can proceed with app
  window.location.href = 'app-home-screen';
}
```

### Step 4: Desktop app stores and uses token

```javascript
// Before making any app API calls:
const token = auth.getStoredToken();

if (!token || !auth.isAuthenticated()) {
  // Prompt re-auth
  window.open(auth.getLoginUrl());
} else {
  // Use token for app API calls
  const response = await fetch('http://localhost:8000/api/artifacts', {
    headers: {
      'Authorization': `Bearer ${token.sessionToken}`,
    },
  });
}
```

## Flow 2: Token Expiry & Billing

### Automatic Refresh (30 sec before expiry)

```javascript
// Desktop app should periodically check if token needs refresh
setInterval(() => {
  const timeUntilExpiry = auth.getTimeUntilExpiry();
  
  if (timeUntilExpiry && timeUntilExpiry < 30 * 1000) {
    // Refresh before it expires
    const refreshed = await auth.refreshToken();
    if (!refreshed) {
      // Token refresh failed, force re-auth
      window.open(auth.getLoginUrl());
    }
  }
}, 10000); // Check every 10 seconds
```

### Billing Status Gating

The token's `billingStatus` field determines how often the user must re-authenticate:

| Status | Re-auth Required | Use Case |
|--------|-----------------|----------|
| `active` | After 30 days | Paying subscription |
| `trialing` | After 7 days | Free trial period |
| `past_due` | After 1 day | Billing issue needs attention |
| `canceled` | Immediately | Subscription ended |

```javascript
// Check if user needs to re-auth based on billing
const nextAuthTime = auth.getNextRequiredAuthTime();

if (nextAuthTime && Date.now() > nextAuthTime.getTime()) {
  // Force re-auth
  auth.clearStoredToken();
  window.open(auth.getLoginUrl());
}
```

## API Endpoints

### Sign In / Sign Up

- **Endpoint**: `POST /api/auth/sign-in` or `POST /api/auth/sign-up`
- **Query Params**: `?desktop_callback=obrenna://auth`
- **Request Body**:
  ```json
  {
    "email": "user@company.com",
    "password": "...",
    "name": "John Doe" // only for sign-up
  }
  ```
- **Desktop Response**: Redirects to `obrenna://auth?token=xxx&expires_at=...&billing_status=active`
- **Web Response**: JSON with user, session, and organization info

### Refresh Token

- **Endpoint**: `POST /api/auth/refresh`
- **Header**: `Authorization: Bearer <sessionToken>`
- **Response**:
  ```json
  {
    "ok": true,
    "session": {
      "id": "...",
      "expires_at": "2026-09-30T..."
    }
  }
  ```

### Get Current User

- **Endpoint**: `GET /api/auth/me`
- **Cookie-based**: Automatically from `obrenna_auth` cookie
- **Response**:
  ```json
  {
    "ok": true,
    "user": {
      "id": "...",
      "email": "...",
      "full_name": "...",
      "status": "active"
    }
  }
  ```

## Integration Checklist for Desktop App

- [x] `siteAuth` client + `SiteAuthContext` wired into the Tauri app (Obrenna/frontend/src/lib/siteAuth.ts, Obrenna/frontend/src/context/SiteAuthContext.tsx)
- [ ] Implement deep-link handler for `obrenna://` scheme
- [ ] Initialize auth client on app startup: `initDesktopAuth('obrenna://')`
- [ ] Store token in persistent storage (Tauri `appDir`)
- [ ] Check token validity before app API calls
- [ ] Implement periodic refresh check (every 10s)
- [ ] Show "Sign in required" UI if token is missing or expired
- [ ] Pass `Authorization` header on all app API calls
- [ ] Handle billing status transitions (e.g., show message if past_due)
- [ ] Add "Sign out" button that calls `auth.clearStoredToken()` and `POST /api/auth/sign-out`

## Local Setup

### Start Postgres

```bash
cd obrenna-site
npm run setup:auth-db          # Windows
npm run setup:auth-db:sh       # macOS / Linux
```

This starts the container defined in `server-db/docker-compose.auth.yml` and applies
`server-db/auth-schema-postgres.sql`. It is safe to re-run.

### Environment Variables

```bash
# .env.local in obrenna-site
AUTH_DB_URL=postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db
AUTH_SESSION_TTL_DAYS=30
ALLOW_BILLING_ONLY_SYNC=true
```

### Test Auth Flow

```bash
# Terminal 1: Start the site with the Node adapter
cd obrenna-site
npm run dev

# Terminal 2: Test endpoints
curl -X POST http://localhost:4321/api/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "name": "Test User",
    "password": "SecurePassword123!"
  }'
```

## Security Notes

- All session tokens are stored in HttpOnly cookies on the site
- Desktop app tokens are stored in local Tauri storage (not accessible to web)
- Token refresh requires valid existing session
- Billing status is re-checked on every login/refresh
- Expired sessions are immediately revoked on logout
- CORS is scoped to allow desktop (obrenna://) and site (obrenna.app) only

## Future Enhancements

- [ ] Device registration & management (list all logged-in devices)
- [ ] Push-based billing status updates (webhook → active app)
- [ ] SSO / SAML support
- [ ] Multi-factor authentication
- [ ] Rate limiting on auth endpoints
- [ ] Session revocation by admin
