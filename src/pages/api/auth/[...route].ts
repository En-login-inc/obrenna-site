import type { APIRoute } from 'astro';
import { createHash, randomBytes } from 'node:crypto';
import { authConfig } from '../../../lib/auth-config';
import { buildError, getBearerToken, getCookieValue } from '../../../lib/auth-helpers';
import { withAuthDb } from '../../../lib/auth-db';
import { billingSyncStatus, unavailableBillingPortal } from '../../../lib/billing-status';
import { signInferenceGrant, verifyInferenceGrant } from '../../../lib/inference-grants';
import { checkInferenceGrantStatus } from '../../../lib/inference-grant-status';
import { handleOrganizationMembers as handleOrganizationMembersRequest } from '../../../lib/organization-members';

type AuthRouteHandler = (input: { request: Request; url: URL; route: string }) => Promise<Response>;

const routeMap: Record<string, AuthRouteHandler> = {
  'sign-up': handleSignUp,
  'sign-in': handleSignIn,
  'desktop-callback': handleDesktopCallback,
  'desktop-authorize': handleDesktopAuthorize,
  'desktop-exchange': handleDesktopExchange,
  'desktop-session': handleDesktopSession,
  'sign-out': handleSignOut,
  me: handleMe,
  organizations: handleOrganizations,
  'billing/portal': handleBillingPortal,
  'billing/sync-status': handleBillingSyncStatus,
  refresh: handleRefresh,
  'inference-grant': handleInferenceGrant,
  'inference-grant-status': handleInferenceGrantStatus,
  'inference-machines': handleInferenceMachines,
  'inference-machines/revoke': handleRevokeInferenceMachine,
  'inference-model-access': handleInferenceModelAccess,
  'organization-members': handleOrganizationMembersRoute,
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

    // Any direct desktop callback receives only a short-lived authorization code.
    if (desktopCallback) {
      const cbUrl = await issueDesktopAuthorizationCode(client, sessionResult.rows[0].id,
        desktopCallback, String(body.code_challenge ?? ''), String(body.state ?? ''));
      return redirectWithSessionCookie(cbUrl, sessionToken);
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
    if (user.status !== 'active') return buildError('This account is inactive', 403);

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
       WHERE om.user_id = $1 AND om.status = 'active' AND o.status = 'active'
       LIMIT 1`,
      [user.id],
    );

    const org = orgResult.rows[0];
    const billingStatus = org?.billing_status || 'trialing';
    const orgId = org?.id || '';
    const orgName = org?.name || '';

    // Any direct desktop callback receives only a short-lived authorization code.
    if (desktopCallback) {
      const cbUrl = await issueDesktopAuthorizationCode(client, sessionResult.rows[0].id,
        desktopCallback, String(body.code_challenge ?? ''), String(body.state ?? ''));
      return redirectWithSessionCookie(cbUrl, sessionToken);
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
  if (desktopCallback !== 'obrenna://auth') {
    return buildError('A valid desktop callback is required', 400);
  }

  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const sessionToken = cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
  if (!sessionToken) return buildError('Not authenticated', 401);

  return withAuthDb(async (client) => {
    const result = await client.query(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionToken],
    );
    const session = result.rows[0];
    if (!session) return buildError('Session expired or invalid', 401);

    try {
      const callbackUrl = await issueDesktopAuthorizationCode(
        client, session.session_id, desktopCallback,
        url.searchParams.get('code_challenge') ?? '', url.searchParams.get('state') ?? '',
      );
      return redirectWithSessionCookie(callbackUrl, sessionToken);
    } catch (error) {
      return buildError(error instanceof Error ? error.message : 'Invalid desktop authorization request', 400);
    }
  });
}

async function issueDesktopAuthorizationCode(
  client: import('pg').PoolClient,
  sessionId: string,
  callback: string,
  challenge: string,
  state: string,
) {
  if (callback !== 'obrenna://auth') throw new Error('Invalid desktop callback');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('An S256 PKCE challenge is required');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) throw new Error('A valid state value is required');
  const code = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(code).digest('hex');
  await client.query('DELETE FROM desktop_authorization_codes WHERE expires_at <= NOW() OR consumed_at IS NOT NULL');
  await client.query(
    `INSERT INTO desktop_authorization_codes (code_hash, session_id, code_challenge, state, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 minutes')`,
    [hash, sessionId, challenge, state],
  );
  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', state);
  return callbackUrl.toString();
}

async function handleDesktopAuthorize({ request }: { request: Request; url: URL; route: string }) {
  if (request.method !== 'POST') return buildError('POST is required', 405);
  const body = await request.json().catch(() => ({}));
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const token = cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
  if (!token) return buildError('Not authenticated', 401);
  return withAuthDb(async (client) => {
    const session = await client.query(
      `SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()`, [token],
    );
    if (!session.rowCount) return buildError('Session expired or invalid', 401);
    try {
      const callbackUrl = await issueDesktopAuthorizationCode(
        client, session.rows[0].id, String(body.desktop_callback ?? ''),
        String(body.code_challenge ?? ''), String(body.state ?? ''),
      );
      return Response.json({ ok: true, callback_url: callbackUrl }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return buildError(error instanceof Error ? error.message : 'Invalid desktop authorization request', 400);
    }
  });
}

async function handleDesktopExchange({ request }: { request: Request; url: URL; route: string }) {
  if (request.method !== 'POST') return buildError('POST is required', 405);
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? '');
  const state = String(body.state ?? '');
  const verifier = String(body.code_verifier ?? '');
  const deviceKey = String(body.device_key ?? '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceKey)) {
    return buildError('Invalid desktop authorization response', 400);
  }
  const hash = createHash('sha256').update(code).digest('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return withAuthDb(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE desktop_authorization_codes c SET consumed_at = NOW()
         FROM auth_sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
         WHERE c.code_hash = $1 AND c.state = $2 AND c.code_challenge = $3
           AND c.session_id = s.id AND c.consumed_at IS NULL AND c.expires_at > NOW()
           AND s.status = 'active' AND s.expires_at > NOW()
         RETURNING s.id AS session_id, s.session_token, s.expires_at, u.id AS user_id, u.email, u.full_name`,
        [hash, state, challenge],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return buildError('Authorization code is invalid, expired, or already used', 401);
      }
      const row = result.rows[0];
      const organizations = await client.query(
        `SELECT o.id, o.name FROM organization_memberships om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.user_id = $1 AND om.status = 'active' AND o.status = 'active'
         ORDER BY om.created_at, o.id`, [row.user_id],
      );
      const devices: Array<{ organization_id: string; organization_name: string; device_id: string }> = [];
      for (const organization of organizations.rows) {
        const enrolled = await client.query(
          `INSERT INTO desktop_auth_devices (organization_id, user_id, device_name, device_key, status, last_seen_at)
           VALUES ($1, $2, 'Obrenna Desktop', $3, 'active', NOW())
           ON CONFLICT (user_id, organization_id, device_key)
           DO UPDATE SET status = 'active', last_seen_at = NOW(), updated_at = NOW()
             WHERE desktop_auth_devices.status IN ('active', 'suspended')
           RETURNING id AS device_id`,
          [organization.id, row.user_id, deviceKey],
        );
        if (enrolled.rowCount) {
          devices.push({
            organization_id: organization.id,
            organization_name: organization.name,
            device_id: enrolled.rows[0].device_id,
          });
        }
      }
      if (organizations.rowCount && !devices.length) {
          await client.query('ROLLBACK');
          return buildError('This desktop device was revoked. Ask an organization administrator to re-enroll it.', 403);
      }
      await client.query('COMMIT');
      return Response.json({
        ok: true,
        session: { id: row.session_id, token: row.session_token, expires_at: row.expires_at },
        user: { id: row.user_id, email: row.email, full_name: row.full_name },
        device_id: devices[0]?.device_id ?? null,
        devices,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function handleDesktopSession({ request, url }: { request: Request; url: URL; route: string }) {
  const returnTo = url.searchParams.get('returnTo') || '/portal/admin';
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return buildError('A relative return path is required', 400);
  }

  return withAuthDb(async (client) => {
    const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
    const browserToken = cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
    let sessionToken: string | null = null;
    if (browserToken) {
      const result = await client.query(
        `SELECT s.session_token FROM auth_sessions s
         JOIN users u ON u.id = s.user_id AND u.status = 'active'
         WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
         LIMIT 1`, [browserToken],
      );
      sessionToken = result.rows[0]?.session_token ?? null;
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
       FROM auth_sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
      WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
          [sessionToken],
    );

    if (!session.rowCount) {
      return buildError('Session expired or invalid', 401);
    }

    const user = await client.query(
      `SELECT id, email, full_name, status, created_at, updated_at
       FROM users WHERE id = $1 AND status = 'active'`,
      [session.rows[0].user_id],
    );
    if (!user.rowCount) return buildError('Account is inactive', 401);

    return Response.json({ ok: true, user: user.rows[0] });
  });
}

async function handleOrganizations({ request }: { request: Request; url: URL; route: string }) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  if (!cookie?.startsWith('session:')) return buildError('Not authenticated', 401);

  const sessionToken = cookie.replace('session:', '');

  return withAuthDb(async (client) => {
    const sessionCheck = await client.query(
      `SELECT s.user_id FROM auth_sessions s JOIN users u ON u.id = s.user_id AND u.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()`,
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
       WHERE om.user_id = $1 AND om.status = 'active' AND o.status = 'active'`,
      [userId],
    );

    return Response.json({ ok: true, organizations: orgs.rows });
  });
}

async function handleBillingPortal() {
  return unavailableBillingPortal();
}

async function handleBillingSyncStatus() {
  return billingSyncStatus(authConfig.allowBillingOnlySync);
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
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth_sessions.user_id AND u.status = 'active')
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

async function handleInferenceGrant({ request }: { request: Request; url: URL; route: string }) {
  if (request.method !== 'POST') return buildError('POST is required', 405);
  const bearer = getBearerToken(request.headers.get('authorization'));
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const sessionToken = bearer || (cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null);
  if (!sessionToken) return buildError('Not authenticated', 401);
  const body = await request.json().catch(() => ({}));
  const deviceId = String(body.device_id ?? '');
  const organizationId = body.organization_id ? String(body.organization_id) : null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(deviceId)) return buildError('An enrolled device_id is required', 400);
  if (organizationId && !uuidPattern.test(organizationId)) return buildError('Invalid organization_id', 400);

  return withAuthDb(async (client) => {
    const access = await client.query(
      `SELECT s.user_id, d.organization_id, d.id AS device_id, o.policy_revision
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN organization_memberships om ON om.user_id = s.user_id AND om.status = 'active'
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       JOIN desktop_auth_devices d ON d.user_id = s.user_id AND d.organization_id = o.id AND d.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
         AND d.id = $2 AND ($3::uuid IS NULL OR o.id = $3::uuid)
       ORDER BY om.updated_at DESC LIMIT 1`,
      [sessionToken, deviceId, organizationId],
    );
    if (!access.rowCount) return buildError('No active organization membership or enrolled device', 403);
    const row = access.rows[0];
    const models = await client.query(
      `SELECT im.id AS machine_id, ma.model_id FROM organization_model_access ma
       JOIN organization_inference_machines im ON im.id = ma.machine_id
          AND im.organization_id = ma.organization_id AND im.status = 'active'
       WHERE ma.organization_id = $1 AND ma.status = 'active'
       ORDER BY im.id, ma.model_id`,
      [row.organization_id],
    );
    if (!models.rowCount) return buildError('No inference machine/model pairs are assigned to this organization', 403);
    try {
      const grant = await signInferenceGrant({
        subject: row.user_id,
        organizationId: row.organization_id,
        deviceId: row.device_id,
        assignments: models.rows.map((item) => ({ machineId: item.machine_id, modelId: item.model_id })),
        policyRevision: Number(row.policy_revision),
      });
      await client.query('UPDATE desktop_auth_devices SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1', [row.device_id]);
      return Response.json({ ok: true, grant: grant.token, expires_at: grant.expiresAt }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch {
      return buildError('Inference grant signing is not configured', 503);
    }
  });
}

async function activeOrganizationAccess(client: import('pg').PoolClient, request: Request, organizationId: string | null) {
  const bearer = getBearerToken(request.headers.get('authorization'));
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const token = bearer || (cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null);
  if (!token) return null;
  const result = await client.query(
    `SELECT s.user_id, o.id AS organization_id, om.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN organization_memberships om ON om.user_id = s.user_id AND om.status = 'active'
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
      WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
        AND ($2::uuid IS NULL OR o.id = $2::uuid)
      ORDER BY om.created_at LIMIT 1`,
    [token, organizationId],
  );
  return result.rows[0] ?? null;
}

async function handleOrganizationMembersRoute({ request, url }: { request: Request; url: URL; route: string }) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const requestedOrganization = request.method === 'POST' ? body.organization_id : url.searchParams.get('organization_id');
  const organizationId = requestedOrganization ? String(requestedOrganization) : null;
  if (!organizationId) return buildError('organization_id is required', 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    return buildError('Invalid organization_id', 400);
  }
  return withAuthDb(async (client) => {
    const access = await activeOrganizationAccess(client, request, organizationId);
    if (!access) return buildError('An active organization session is required', 403);
    return handleOrganizationMembersRequest(client, access, request.method, body);
  });
}

async function handleInferenceGrantStatus({ request }: { request: Request; url: URL; route: string }) {
  if (request.method !== 'POST') return buildError('POST is required', 405);
  const body = await request.json().catch(() => ({}));
  const token = typeof body.grant === 'string' ? body.grant : '';
  if (!token || token.length > 16_384) return buildError('A valid grant is required', 400);
  let claims;
  try {
    claims = await verifyInferenceGrant(token);
  } catch {
    return buildError('Invalid organization grant', 401);
  }
  return withAuthDb((client) => checkInferenceGrantStatus(client, {
    sub: String(claims.sub),
    org: String(claims.org),
    device: String(claims.device),
    policy_rev: Number(claims.policy_rev),
    assignments: claims.assignments as Array<{ machine_id: string; model_id: string }>,
  }));
}

async function handleInferenceMachines({ request, url }: { request: Request; url: URL; route: string }) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const requestedOrg = request.method === 'POST' ? body.organization_id : url.searchParams.get('organization_id');
  const organizationId = requestedOrg ? String(requestedOrg) : null;
  if (!organizationId) return buildError('organization_id is required', 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) return buildError('Invalid organization_id', 400);
  return withAuthDb(async (client) => {
    const access = await activeOrganizationAccess(client, request, organizationId);
    if (!access) return buildError('An active organization session is required', 403);
    if (!['owner', 'admin'].includes(access.role)) return buildError('Organization administrator access is required', 403);
    if (request.method === 'GET') {
      const result = await client.query(
        `SELECT im.id, im.name, im.status, im.created_at,
          COALESCE(array_agg(ma.model_id) FILTER (WHERE ma.status = 'active'), '{}') AS models
         FROM organization_inference_machines im
         LEFT JOIN organization_model_access ma ON ma.machine_id = im.id AND ma.organization_id = im.organization_id
         WHERE im.organization_id = $1
         GROUP BY im.id ORDER BY im.created_at`, [access.organization_id],
      );
      return Response.json({ ok: true, machines: result.rows });
    }
    if (request.method !== 'POST') return buildError('GET or POST is required', 405);
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 255) return buildError('A machine name of at most 255 characters is required', 400);
    await client.query('BEGIN');
    try {
      const created = await client.query(
        `INSERT INTO organization_inference_machines (organization_id, name)
         VALUES ($1, $2) RETURNING id, name, status, created_at`, [access.organization_id, name],
      );
      await client.query('UPDATE organizations SET policy_revision = policy_revision + 1, updated_at = NOW() WHERE id = $1', [access.organization_id]);
      await client.query('COMMIT');
      return Response.json({ ok: true, machine: created.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function handleRevokeInferenceMachine({ request }: { request: Request; url: URL; route: string }) {
  if (request.method !== 'POST') return buildError('POST is required', 405);
  const body = await request.json().catch(() => ({}));
  const machineId = String(body.machine_id ?? '');
  const organizationId = body.organization_id ? String(body.organization_id) : null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(machineId)) return buildError('Invalid machine_id', 400);
  if (!organizationId || !uuidPattern.test(organizationId)) return buildError('A valid organization_id is required', 400);
  return withAuthDb(async (client) => {
    const access = await activeOrganizationAccess(client, request, organizationId);
    if (!access) return buildError('An active organization session is required', 403);
    if (!['owner', 'admin'].includes(access.role)) return buildError('Organization administrator access is required', 403);
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE organization_inference_machines SET status = 'revoked', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status = 'active' RETURNING id`,
        [machineId, access.organization_id],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return buildError('Active inference machine not found', 404);
      }
      await client.query(
        `UPDATE organization_model_access SET status = 'revoked', updated_at = NOW()
         WHERE machine_id = $1 AND organization_id = $2`, [machineId, access.organization_id],
      );
      await client.query('UPDATE organizations SET policy_revision = policy_revision + 1, updated_at = NOW() WHERE id = $1', [access.organization_id]);
      await client.query('COMMIT');
      return Response.json({ ok: true, machine_id: machineId, status: 'revoked' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function handleInferenceModelAccess({ request, url }: { request: Request; url: URL; route: string }) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const organizationId = (request.method === 'POST' ? body.organization_id : url.searchParams.get('organization_id')) ?? null;
  if (typeof organizationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    return buildError('A valid organization_id is required', 400);
  }
  return withAuthDb(async (client) => {
    const access = await activeOrganizationAccess(client, request, organizationId);
    if (!access) return buildError('An active organization session is required', 403);
    if (request.method === 'GET') {
      const result = await client.query(
        `SELECT ma.machine_id, im.name AS machine_name, ma.model_id, ma.status
         FROM organization_model_access ma JOIN organization_inference_machines im ON im.id = ma.machine_id
         WHERE ma.organization_id = $1 ORDER BY im.name, ma.model_id`, [access.organization_id],
      );
      return Response.json({ ok: true, assignments: result.rows });
    }
    if (request.method !== 'POST') return buildError('GET or POST is required', 405);
    if (!['owner', 'admin'].includes(access.role)) return buildError('Organization administrator access is required', 403);
    const machineId = String(body.machine_id ?? '');
    const modelId = String(body.model_id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(machineId) || !modelId || modelId.length > 200) {
      return buildError('A valid machine_id and model_id are required', 400);
    }
    await client.query('BEGIN');
    try {
      const assigned = await client.query(
        `INSERT INTO organization_model_access (organization_id, machine_id, model_id, status)
         SELECT $1, im.id, $3, 'active' FROM organization_inference_machines im
         WHERE im.id = $2 AND im.organization_id = $1 AND im.status = 'active'
         ON CONFLICT (organization_id, machine_id, model_id)
         DO UPDATE SET status = 'active', updated_at = NOW()
         RETURNING machine_id, model_id, status`, [access.organization_id, machineId, modelId],
      );
      if (!assigned.rowCount) {
        await client.query('ROLLBACK');
        return buildError('Active inference machine not found', 404);
      }
      await client.query('UPDATE organizations SET policy_revision = policy_revision + 1, updated_at = NOW() WHERE id = $1', [access.organization_id]);
      await client.query('COMMIT');
      return Response.json({ ok: true, assignment: assigned.rows[0] }, { status: 201 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
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
