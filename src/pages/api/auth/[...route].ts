import type { APIRoute } from 'astro';
import { authConfig } from '../../../lib/auth-config';
import { buildError, getBearerToken, getCookieValue } from '../../../lib/auth-helpers';
import { withAuthDb } from '../../../lib/auth-db';

type AuthRouteHandler = (input: { request: Request; url: URL; route: string }) => Promise<Response>;

const routeMap: Record<string, AuthRouteHandler> = {
  'sign-up': handleSignUp,
  'sign-in': handleSignIn,
  'desktop-callback': handleDesktopCallback,
  'desktop-session': handleDesktopSession,
  'sign-out': handleSignOut,
  me: handleMe,
  organizations: handleOrganizations,
  'billing/portal': handleBillingPortal,
  'billing/sync-status': handleBillingSyncStatus,
  refresh: handleRefresh,
};

function getRoute(params: Record<string, unknown> | undefined) {
  const routeParam = params?.route;
  if (Array.isArray(routeParam)) {
    return routeParam.join('/');
  }
  return typeof routeParam === 'string' ? routeParam : '';
}

export const GET: APIRoute = async ({ params, request }) => {
  const route = getRoute(params as Record<string, unknown> | undefined);
  const handler = routeMap[route];

  if (!handler) {
    return buildError('Route not found', 404);
  }

  return handler({ request, route, url: new URL(request.url) });
};

export const POST: APIRoute = async ({ params, request }) => {
  const route = getRoute(params as Record<string, unknown> | undefined);
  const handler = routeMap[route];

  if (!handler) {
    return buildError('Route not found', 404);
  }

  return handler({ request, route, url: new URL(request.url) });
};

async function handleSignUp({ request, url }: { request: Request; url: URL; route: string }) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim();
  const desktopCallback = url.searchParams.get('desktop_callback');

  if (!email || !password || !name) {
    return buildError('name, email, and password are required', 400);
  }

  const passwordHash = await hashPassword(password);

  return withAuthDb(async (client) => {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount) {
      return buildError('Account already exists', 409);
    }

    const userResult = await client.query(
      `INSERT INTO users (id, email, full_name, password_hash, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW(), NOW())
       RETURNING id, email, full_name, status, created_at, updated_at`,
      [email, name, passwordHash],
    );

    const user = userResult.rows[0];
    const sessionToken = crypto.randomUUID().toString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const sessionResult = await client.query(
      `INSERT INTO auth_sessions (id, user_id, session_token, expires_at, status, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW())
       RETURNING id`,
      [user.id, sessionToken, expiresAt],
    );

    // If desktop callback, redirect there instead of JSON response
    if (desktopCallback) {
      const cbUrl = new URL(desktopCallback);
      cbUrl.searchParams.set('token', sessionToken);
      cbUrl.searchParams.set('expires_at', expiresAt.toISOString());
      cbUrl.searchParams.set('user_id', user.id);
      cbUrl.searchParams.set('email', user.email);
      cbUrl.searchParams.set('billing_status', 'trialing');

      return redirectWithSessionCookie(cbUrl.toString(), sessionToken);
    }

    const response = Response.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          status: user.status,
        },
        session: {
          id: sessionResult.rows[0].id,
          token: sessionToken,
          expires_at: expiresAt.toISOString(),
        },
      },
      { status: 201 },
    );

    response.headers.append('Set-Cookie', `${authConfig.cookieName}=session:${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  });
}

async function handleSignIn({ request, url }: { request: Request; url: URL; route: string }) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const desktopCallback = url.searchParams.get('desktop_callback');

  if (!email || !password) {
    return buildError('email and password are required', 400);
  }

  return withAuthDb(async (client) => {
    const result = await client.query(
      'SELECT id, email, full_name, password_hash, status FROM users WHERE email = $1 LIMIT 1',
      [email],
    );

    const user = result.rows[0];
    if (!user) {
      return buildError('Invalid credentials', 401);
    }

    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return buildError('Invalid credentials', 401);
    }

    const sessionToken = crypto.randomUUID().toString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const sessionResult = await client.query(
      `INSERT INTO auth_sessions (id, user_id, session_token, expires_at, status, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'active', NOW())
       RETURNING id`,
      [user.id, sessionToken, expiresAt],
    );

    // Look up billing status
    const orgResult = await client.query(
      `SELECT o.id, o.name, om.role, s.status as billing_status
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'
       LIMIT 1`,
      [user.id],
    );

    const org = orgResult.rows[0];
    const billingStatus = org?.billing_status || 'trialing';
    const orgId = org?.id || '';
    const orgName = org?.name || '';

    // If desktop callback, redirect there
    if (desktopCallback) {
      const cbUrl = new URL(desktopCallback);
      cbUrl.searchParams.set('token', sessionToken);
      cbUrl.searchParams.set('expires_at', expiresAt.toISOString());
      cbUrl.searchParams.set('user_id', user.id);
      cbUrl.searchParams.set('email', user.email);
      cbUrl.searchParams.set('org_id', orgId);
      cbUrl.searchParams.set('org_name', orgName);
      cbUrl.searchParams.set('billing_status', billingStatus);

      return redirectWithSessionCookie(cbUrl.toString(), sessionToken);
    }

    const response = Response.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        status: user.status,
      },
      session: {
        id: sessionResult.rows[0].id,
        token: sessionToken,
        expires_at: expiresAt.toISOString(),
        billing_status: billingStatus,
      },
      organization: orgId ? { id: orgId, name: orgName, role: org.role, billingStatus } : undefined,
    });

    response.headers.append('Set-Cookie', `${authConfig.cookieName}=session:${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  });
}

async function handleDesktopCallback({ request, url }: { request: Request; url: URL; route: string }) {
  const desktopCallback = url.searchParams.get('desktop_callback');
  if (!desktopCallback || !desktopCallback.startsWith('obrenna://auth')) {
    return buildError('A valid desktop callback is required', 400);
  }

  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const sessionToken = cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
  if (!sessionToken) return buildError('Not authenticated', 401);

  return withAuthDb(async (client) => {
    const result = await client.query(
      `SELECT s.expires_at, u.id, u.email
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionToken],
    );
    const session = result.rows[0];
    if (!session) return buildError('Session expired or invalid', 401);

    const orgResult = await client.query(
      `SELECT o.id, o.name, om.role, s.status as billing_status
       FROM organization_memberships om
       JOIN organizations o ON om.organization_id = o.id
       LEFT JOIN subscriptions s ON s.organization_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'
       LIMIT 1`,
      [session.id],
    );
    const org = orgResult.rows[0];
    const callbackUrl = new URL(desktopCallback);
    callbackUrl.searchParams.set('token', sessionToken);
    callbackUrl.searchParams.set('expires_at', new Date(session.expires_at).toISOString());
    callbackUrl.searchParams.set('user_id', session.id);
    callbackUrl.searchParams.set('email', session.email);
    callbackUrl.searchParams.set('org_id', org?.id ?? '');
    callbackUrl.searchParams.set('org_name', org?.name ?? '');
    callbackUrl.searchParams.set('billing_status', org?.billing_status ?? 'trialing');
    return redirectWithSessionCookie(callbackUrl.toString(), sessionToken);
  });
}

async function handleDesktopSession({ request, url }: { request: Request; url: URL; route: string }) {
  const desktopToken = url.searchParams.get('token');
  const returnTo = url.searchParams.get('returnTo') || '/portal/admin';
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return buildError('A relative return path is required', 400);
  }

  return withAuthDb(async (client) => {
    // When a desktop token is provided, use ONLY that token and ignore any browser cookie.
    // This ensures the desktop app's authenticated user is the one accessing the admin portal,
    // not a different user who may be logged into the browser.
    let sessionToken: string | null = null;

    if (desktopToken) {
      // Desktop token provided: validate only the desktop token
      const result = await client.query(
        `SELECT session_token
         FROM auth_sessions
         WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
         LIMIT 1`,
        [desktopToken],
      );
      sessionToken = result.rows[0]?.session_token ?? null;
    } else {
      // No desktop token: fall back to browser cookie (backward compatibility)
      const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
      const browserToken = cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
      if (browserToken) {
        const result = await client.query(
          `SELECT session_token
           FROM auth_sessions
           WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
           LIMIT 1`,
          [browserToken],
        );
        sessionToken = result.rows[0]?.session_token ?? null;
      }
    }

    if (!sessionToken) return buildError('Session expired or invalid', 401);

    return redirectWithSessionCookie(new URL(returnTo, url.origin).toString(), sessionToken);
  });
}

function redirectWithSessionCookie(location: string, sessionToken: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Set-Cookie': `${authConfig.cookieName}=session:${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    },
  });
}

async function handleSignOut({ request }: { request: Request; url: URL; route: string }) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const bearer = getBearerToken(request.headers.get('authorization'));
  const sessionToken = bearer || (cookie?.startsWith('session:') ? cookie.replace('session:', '') : null);

  // A browser logout only removes the browser's cookie. The desktop app uses
  // the same session token as a bearer credential, so revoking a cookie-only
  // session would also log the desktop app out.
  if (bearer && sessionToken) {
    await withAuthDb(async (client) => {
      await client.query('UPDATE auth_sessions SET status = $1, revoked_at = NOW() WHERE session_token = $2', ['revoked', sessionToken]);
    });
  }

  const response = Response.json({ ok: true });
  response.headers.append('Set-Cookie', `${authConfig.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}

async function handleMe({ request }: { request: Request; url: URL; route: string }) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const bearer = getBearerToken(request.headers.get('authorization'));
  const sessionToken = bearer || (cookie?.startsWith('session:') ? cookie.replace('session:', '') : null);
  if (!sessionToken) {
    return buildError('Not authenticated', 401);
  }

  return withAuthDb(async (client) => {
    const session = await client.query(
      `SELECT s.user_id, s.expires_at, s.status
       FROM auth_sessions s
      WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
          [sessionToken],
    );

    if (!session.rowCount) {
      return buildError('Session expired or invalid', 401);
    }

    const user = await client.query(
      `SELECT id, email, full_name, status, created_at, updated_at
       FROM users WHERE id = $1`,
      [session.rows[0].user_id],
    );

    return Response.json({ ok: true, user: user.rows[0] });
  });
}

async function handleOrganizations({ request }: { request: Request; url: URL; route: string }) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  if (!cookie?.startsWith('session:')) return buildError('Not authenticated', 401);

  const sessionToken = cookie.replace('session:', '');

  return withAuthDb(async (client) => {
    const sessionCheck = await client.query(
      `SELECT user_id FROM auth_sessions WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()`,
      [sessionToken],
    );

    if (!sessionCheck.rowCount) {
      return buildError('Session expired or invalid', 401);
    }

    const userId = sessionCheck.rows[0].user_id;
    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name ?? '').trim();
      const slug = String(body.identifier ?? '').trim().toLowerCase();
      const region = String(body.region ?? '').trim();
      const orgType = String(body.orgType ?? '').trim();

      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return buildError('A name and valid organization identifier are required', 400);
      }

      try {
        await client.query('BEGIN');
        const organizationResult = await client.query(
          `INSERT INTO organizations (id, name, slug, status, metadata, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'active', $3::jsonb, NOW(), NOW())
           RETURNING id, name, slug, status`,
          [name, slug, JSON.stringify({ region, orgType })],
        );
        const organization = organizationResult.rows[0];

        await client.query(
          `INSERT INTO organization_memberships
             (id, user_id, organization_id, role, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'owner', 'active', NOW(), NOW())`,
          [userId, organization.id],
        );
        await client.query('COMMIT');

        return Response.json({ ok: true, organization }, { status: 201 });
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505') {
          return buildError('Organization identifier is already in use', 409);
        }
        throw error;
      }
    }

    const orgs = await client.query(
      `SELECT o.id, o.name, o.slug, o.status
       FROM organizations o
       INNER JOIN organization_memberships om ON om.organization_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active'`,
      [userId],
    );

    return Response.json({ ok: true, organizations: orgs.rows });
  });
}

async function handleBillingPortal() {
  return Response.json({ ok: true, message: 'Billing portal integration placeholder', portalUrl: null });
}

async function handleBillingSyncStatus() {
  return Response.json({ ok: true, sync: { enabled: authConfig.allowBillingOnlySync, status: 'ready' } });
}

async function handleRefresh({ request }: { request: Request; url: URL; route: string }) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  if (!cookie?.startsWith('session:')) {
    return buildError('Not authenticated', 401);
  }

  const sessionToken = cookie.replace('session:', '');
  return withAuthDb(async (client) => {
    const result = await client.query(
      `UPDATE auth_sessions
       SET expires_at = NOW() + INTERVAL '30 days', updated_at = NOW()
      WHERE session_token = $1 AND status = 'active' AND expires_at > NOW()
       RETURNING id, expires_at`,
          [sessionToken],
    );

    if (!result.rowCount) {
      return buildError('Session expired or invalid', 401);
    }

    const response = Response.json({ ok: true, session: result.rows[0] });
    response.headers.append('Set-Cookie', `${authConfig.cookieName}=session:${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  });
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 120000,
    },
    key,
    256,
  );

  const hash = Array.from(new Uint8Array(derived))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return `${Array.from(salt)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}:${hash}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [saltHex, actualHash] = storedHash.split(':');
  if (!saltHex || !actualHash) {
    return false;
  }

  const salt = Uint8Array.from(Buffer.from(saltHex, 'hex'));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 120000,
    },
    key,
    256,
  );

  const candidate = Array.from(new Uint8Array(derived))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return candidate === actualHash;
}
