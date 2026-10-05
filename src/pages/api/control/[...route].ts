import type { APIRoute } from 'astro';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildError } from '../../../lib/auth-helpers';
import { withAuthDb } from '../../../lib/auth-db';
import { getPortalAccount } from '../../../lib/portal-account';

type RouteInput = { request: Request; route: string };
type Handler = (input: RouteInput) => Promise<Response>;

function getRoute(params: Record<string, unknown> | undefined) {
  const value = params?.route;
  return Array.isArray(value) ? value.join('/') : typeof value === 'string' ? value : '';
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function pairingSecret() {
  const secret = process.env.INFERENCE_PAIRING_JWT_SECRET
    || import.meta.env.INFERENCE_PAIRING_JWT_SECRET
    || process.env.MACHINE_PAIRING_SECRET
    || import.meta.env.MACHINE_PAIRING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('INFERENCE_PAIRING_JWT_SECRET must contain at least 32 bytes');
  }
  return secret;
}

function encodeBase64Url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function signJwt(claims: Record<string, string | number>) {
  const unsigned = `${encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encodeBase64Url(JSON.stringify(claims))}`;
  const signature = createHmac('sha256', pairingSecret()).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyJwt(token: string, audience: string) {
  if (token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', pairingSecret()).update(unsigned).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Record<string, unknown>;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'HS256' || claims.iss !== 'obrenna-site' || claims.aud !== audience
        || typeof claims.sub !== 'string' || typeof claims.jti !== 'string'
        || typeof claims.iat !== 'number' || claims.iat > now + 30
        || typeof claims.exp !== 'number' || claims.exp <= now
        || claims.exp <= claims.iat || claims.exp - claims.iat > 60 * 60) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

function parseClientActivity(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const activity: { tokenHash: string; lastSeenAt: string }[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || !('token_hash' in item) || !('last_seen_at' in item)) {
      return null;
    }
    if (typeof item.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.token_hash)
        || typeof item.last_seen_at !== 'string') {
      return null;
    }
    const timestamp = Date.parse(item.last_seen_at);
    if (!Number.isFinite(timestamp)) return null;
    activity.push({ tokenHash: item.token_hash, lastSeenAt: new Date(timestamp).toISOString() });
  }
  return activity;
}

function errorResponse(error: unknown) {
  console.error('Control-plane API request failed', error);
  return buildError('The control-plane request failed', 500);
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function withAdmin(request: Request, action: (account: NonNullable<Awaited<ReturnType<typeof getPortalAccount>>>) => Promise<Response>) {
  const account = await getPortalAccount(request);
  if (!account) return buildError('Sign in required', 401);
  if (!['owner', 'admin'].includes(account.organization.role.toLowerCase())) {
    return buildError('Organization administrator access required', 403);
  }
  return action(account);
}

function validateGuardrails(body: Record<string, unknown>) {
  const models = body.allowed_models;
  const terms = body.blocked_terms;
  const rpm = body.requests_per_minute;
  const inputLimit = body.max_input_chars;
  const outputLimit = body.max_output_chars;
  if (!Array.isArray(models) || models.length > 100 || models.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)) {
    return 'allowed_models must be an array of at most 100 model names';
  }
  if (!Array.isArray(terms) || terms.length > 100 || terms.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)) {
    return 'blocked_terms must be an array of at most 100 terms, each at most 200 characters';
  }
  if (!Number.isInteger(rpm) || Number(rpm) < 1 || Number(rpm) > 600) return 'requests_per_minute must be between 1 and 600';
  if (!Number.isInteger(inputLimit) || Number(inputLimit) < 1 || Number(inputLimit) > 1_000_000) return 'max_input_chars must be between 1 and 1000000';
  if (!Number.isInteger(outputLimit) || Number(outputLimit) < 1 || Number(outputLimit) > 1_000_000) return 'max_output_chars must be between 1 and 1000000';
  if (typeof body.detect_sensitive_data !== 'boolean') return 'detect_sensitive_data must be a boolean';
  return null;
}

async function fetchPrivateServerAsset(path: string, accept = 'application/vnd.github+json') {
  const token = process.env.OBRENNA_SERVER_GITHUB_TOKEN || import.meta.env.OBRENNA_SERVER_GITHUB_TOKEN;
  if (!token) throw new Error('OBRENNA_SERVER_GITHUB_TOKEN is not configured');
  const repository = process.env.OBRENNA_SERVER_GITHUB_REPOSITORY
    || import.meta.env.OBRENNA_SERVER_GITHUB_REPOSITORY
    || 'En-login-inc/Obrenna-Server';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('OBRENNA_SERVER_GITHUB_REPOSITORY must be owner/repository');
  }
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Obrenna-Site-Private-Installer',
    },
    redirect: 'manual',
  });
  if (response.status === 302) {
    const location = response.headers.get('location');
    if (!location) throw new Error('GitHub returned an unexpected private archive redirect');
    const redirectUrl = new URL(location);
    if (redirectUrl.protocol !== 'https:' || redirectUrl.hostname !== 'codeload.github.com') {
      throw new Error('GitHub returned an unexpected private archive redirect');
    }
    const archive = await fetch(location);
    if (!archive.ok || !archive.body) throw new Error(`Private repository archive download failed (${archive.status})`);
    return archive;
  }
  if (!response.ok) throw new Error(`Private repository download failed (${response.status})`);
  return response;
}

function privateServerRef() {
  return process.env.OBRENNA_SERVER_GITHUB_REF
    || import.meta.env.OBRENNA_SERVER_GITHUB_REF
    || 'main';
}

async function authorizeInstallDownload(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const claims = token ? verifyJwt(token, 'obrenna-server-install') : null;
  const organizationId = claims?.sub;
  const installJti = claims?.jti;
  if (typeof organizationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(organizationId)
      || typeof installJti !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(installJti)) {
    return buildError('A valid server install token is required', 401);
  }
  const result = await withAuthDb((client) => client.query(
    `SELECT 1 FROM inference_install_tokens
     WHERE jti_hash = $1 AND organization_id = $2 AND expires_at > NOW()`,
    [digest(installJti), organizationId],
  ));
  return result.rowCount ? null : buildError('The server install token is invalid or expired', 410);
}

async function readGuardrails(organizationId: string) {
  return withAuthDb(async (client) => {
    await client.query(
      `INSERT INTO inference_guardrails (organization_id)
       VALUES ($1)
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId],
    );
    const result = await client.query(
      `SELECT revision, allowed_models, requests_per_minute, max_input_chars,
              max_output_chars, blocked_terms, detect_sensitive_data, updated_at
       FROM inference_guardrails WHERE organization_id = $1`,
      [organizationId],
    );
    return Response.json(result.rows[0]);
  });
}

const handlers: Record<string, Partial<Record<'GET' | 'POST' | 'PATCH', Handler>>> = {
  'hosts/install-source': {
    GET: async ({ request }) => {
      try {
        const authorizationError = await authorizeInstallDownload(request);
        if (authorizationError) return authorizationError;
        const format = new URL(request.url).searchParams.get('format');
        if (format === 'windows-script' || format === 'macos-script' || format === 'linux-script') {
          const platform = format.slice(0, format.indexOf('-'));
          const asset = await fetchPrivateServerAsset(
            `contents/scripts/install-${platform === 'windows' ? 'ps1' : `${platform}.sh`}?ref=${encodeURIComponent(privateServerRef())}`,
          );
          const body = await asset.json() as { type?: unknown; encoding?: unknown; content?: unknown };
          if (body.type !== 'file' || body.encoding !== 'base64' || typeof body.content !== 'string') {
            throw new Error('GitHub returned an invalid installer source file');
          }
          return new Response(Buffer.from(body.content, 'base64'), {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        if (format === 'source-zip' || format === 'source-tar-gz') {
          const archiveType = format === 'source-zip' ? 'zipball' : 'tarball';
          const archive = await fetchPrivateServerAsset(
            `${archiveType}/${encodeURIComponent(privateServerRef())}`,
            'application/vnd.github+json',
          );
          if (!archive.body) throw new Error('GitHub returned an empty private repository archive');
          return new Response(archive.body, {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Disposition': `attachment; filename="obrenna-server.${format === 'source-zip' ? 'zip' : 'tar.gz'}"`,
              'Content-Type': format === 'source-zip' ? 'application/zip' : 'application/gzip',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        return buildError('A supported installer source format is required', 400);
      } catch (error) {
        if (error instanceof Error && error.message.includes('INFERENCE_PAIRING_JWT_SECRET')) {
          console.error(error.message);
          return buildError('Server pairing is not configured. Contact the Obrenna site administrator.', 503);
        }
        if (error instanceof Error && error.message.includes('OBRENNA_SERVER_GITHUB_TOKEN')) {
          console.error(error.message);
          return buildError('The Obrenna site is missing its private-repository download credential (OBRENNA_SERVER_GITHUB_TOKEN).', 503);
        }
        console.error('Private Obrenna-Server download failed', error);
        return buildError('Could not download the private Obrenna-Server installer source', 502);
      }
    },
  },
  'install-sessions': {
    POST: async ({ request }) => withAdmin(request, async (account) => {
      const jti = newToken();
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + 15 * 60;
      try {
        const token = signJwt({
          iss: 'obrenna-site',
          aud: 'obrenna-server-install',
          sub: account.organization.id,
          jti,
          iat: issuedAt,
          exp: expiresAt,
        });
        await withAuthDb((client) => client.query(
          `INSERT INTO inference_install_tokens (jti_hash, organization_id, created_by, expires_at)
           VALUES ($1, $2, $3, TO_TIMESTAMP($4))`,
          [digest(jti), account.organization.id, account.user.id, expiresAt],
        ));
        return Response.json({ token, expires_at: new Date(expiresAt * 1000).toISOString() }, {
          status: 201,
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('INFERENCE_PAIRING_JWT_SECRET')) {
          console.error(error.message);
          return buildError('Server pairing is not configured. Contact the Obrenna site administrator.', 503);
        }
        return errorResponse(error);
      }
    }),
  },
  guardrails: {
    GET: async ({ request }) => withAdmin(request, (account) => readGuardrails(account.organization.id)),
    PATCH: async ({ request }) => withAdmin(request, async (account) => {
      const body = await readJson(request);
      if (!body) return buildError('A JSON request body is required', 400);
      const validationError = validateGuardrails(body);
      if (validationError) return buildError(validationError, 422);
      try {
        return await withAuthDb(async (client) => {
          const result = await client.query(
            `INSERT INTO inference_guardrails
               (organization_id, revision, allowed_models, requests_per_minute, max_input_chars,
                max_output_chars, blocked_terms, detect_sensitive_data, updated_at)
             VALUES ($1, 1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, NOW())
             ON CONFLICT (organization_id) DO UPDATE SET
               revision = inference_guardrails.revision + 1,
               allowed_models = EXCLUDED.allowed_models,
               requests_per_minute = EXCLUDED.requests_per_minute,
               max_input_chars = EXCLUDED.max_input_chars,
               max_output_chars = EXCLUDED.max_output_chars,
               blocked_terms = EXCLUDED.blocked_terms,
               detect_sensitive_data = EXCLUDED.detect_sensitive_data,
               updated_at = NOW()
             RETURNING revision, allowed_models, requests_per_minute, max_input_chars,
                       max_output_chars, blocked_terms, detect_sensitive_data, updated_at`,
            [
              account.organization.id,
              JSON.stringify(body.allowed_models),
              body.requests_per_minute,
              body.max_input_chars,
              body.max_output_chars,
              JSON.stringify(body.blocked_terms),
              body.detect_sensitive_data,
            ],
          );
          return Response.json(result.rows[0]);
        });
      } catch (error) {
        return errorResponse(error);
      }
    }),
  },
  hosts: {
    GET: async ({ request }) => withAdmin(request, async (account) => {
      try {
        const hosts = await withAuthDb((client) => client.query(
          `SELECT id, display_name, last_seen_at, revoked_at, created_at, available_models, paired_at
           FROM inference_hosts WHERE organization_id = $1 ORDER BY created_at DESC`,
          [account.organization.id],
        ));
        return Response.json(hosts.rows);
      } catch (error) {
        return errorResponse(error);
      }
    }),
    POST: async ({ request }) => withAdmin(request, async (account) => {
      const body = await readJson(request);
      const displayName = typeof body?.display_name === 'string' ? body.display_name.trim().slice(0, 120) : '';
      if (!displayName) return buildError('display_name is required', 422);
      const token = newToken();
      try {
        const result = await withAuthDb((client) => client.query(
          `INSERT INTO inference_hosts (organization_id, display_name, token_hash, paired_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, display_name, created_at`,
          [account.organization.id, displayName, digest(token)],
        ));
        return Response.json({ ...result.rows[0], token }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }),
  },
  'hosts/bootstrap': {
    POST: async ({ request }) => {
      const bootstrapToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      let claims: Record<string, unknown> | null;
      try {
        claims = bootstrapToken ? verifyJwt(bootstrapToken, 'obrenna-server-install') : null;
      } catch (error) {
        if (error instanceof Error && error.message.includes('INFERENCE_PAIRING_JWT_SECRET')) {
          console.error(error.message);
          return buildError('Server pairing is not configured. Contact the Obrenna site administrator.', 503);
        }
        throw error;
      }
      const body = await readJson(request);
      const displayName = typeof body?.display_name === 'string' ? body.display_name.trim().slice(0, 120) : '';
      const hostTokenHash = typeof body?.host_token_hash === 'string' ? body.host_token_hash : '';
      const organizationId = claims?.sub;
      const installJti = claims?.jti;
      if (typeof organizationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(organizationId)
          || typeof installJti !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(installJti)) {
        return buildError('The install token is invalid or expired', 401);
      }
      if (!displayName || !/^[a-f0-9]{64}$/.test(hostTokenHash)) {
        return buildError('A host name and valid host credential hash are required', 422);
      }
      try {
        return await withAuthDb(async (client) => {
          await client.query('BEGIN');
          try {
            const installResult = await client.query(
              `SELECT organization_id, expires_at, used_at, host_id, pairing_jti, pairing_expires_at
               FROM inference_install_tokens
               WHERE jti_hash = $1 AND organization_id = $2
               FOR UPDATE`,
              [digest(installJti), organizationId],
            );
            const install = installResult.rows[0];
            if (!install || new Date(install.expires_at).getTime() <= Date.now()) {
              await client.query('ROLLBACK');
              return buildError('The install token is invalid, expired, or already used', 410);
            }

            let hostId = install.host_id as string | null;
            let pairingJti = install.pairing_jti as string | null;
            let pairingExpiresAt = install.pairing_expires_at as Date | null;
            if (install.used_at) {
              if (!hostId) {
                await client.query('ROLLBACK');
                return buildError('The install token has already been used', 410);
              }
              const hostResult = await client.query(
                `SELECT token_hash, paired_at, revoked_at FROM inference_hosts
                 WHERE id = $1 AND organization_id = $2`,
                [hostId, organizationId],
              );
              const existingHost = hostResult.rows[0];
              if (!existingHost || existingHost.token_hash.trim() !== hostTokenHash || existingHost.revoked_at) {
                await client.query('ROLLBACK');
                return buildError('This install token is already assigned to another host', 409);
              }
              if (existingHost.paired_at) {
                await client.query('COMMIT');
                return Response.json({ host_id: hostId, status: 'paired', pairing_url: null }, {
                  headers: { 'Cache-Control': 'no-store' },
                });
              }
            } else {
              pairingJti = newToken();
              pairingExpiresAt = new Date(Date.now() + 30 * 60_000);
              const hostResult = await client.query(
                `INSERT INTO inference_hosts
                   (organization_id, display_name, token_hash, pairing_expires_at)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id`,
                [organizationId, displayName, hostTokenHash, pairingExpiresAt],
              );
              hostId = hostResult.rows[0].id;
              await client.query(
                `UPDATE inference_install_tokens
                 SET used_at = NOW(), host_id = $2, pairing_jti = $3, pairing_expires_at = $4
                 WHERE jti_hash = $1`,
                [digest(installJti), hostId, pairingJti, pairingExpiresAt],
              );
            }
            if (!hostId || !pairingJti || !pairingExpiresAt) {
              await client.query('ROLLBACK');
              return buildError('Could not create the host approval link', 500);
            }
            const pairingToken = signJwt({
              iss: 'obrenna-site',
              aud: 'obrenna-server-pair',
              sub: hostId,
              org: organizationId,
              jti: pairingJti,
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(new Date(pairingExpiresAt).getTime() / 1000),
            });
            await client.query(
              `UPDATE inference_hosts SET pairing_token_hash = $2 WHERE id = $1`,
              [hostId, digest(pairingToken)],
            );
            await client.query('COMMIT');
            const pairingUrl = new URL('/portal/admin/machines', new URL(request.url).origin);
            pairingUrl.searchParams.set('pair', pairingToken);
            return Response.json({
              host_id: hostId,
              status: 'pending_approval',
              pairing_url: pairingUrl.toString(),
              pairing_expires_at: new Date(pairingExpiresAt).toISOString(),
            }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('INFERENCE_PAIRING_JWT_SECRET')) {
          console.error(error.message);
          return buildError('Server pairing is not configured. Contact the Obrenna site administrator.', 503);
        }
        return errorResponse(error);
      }
    },
  },
  'hosts/pair': {
    POST: async ({ request }) => {
      const body = await readJson(request);
      const pairingToken = typeof body?.pairing_token === 'string' ? body.pairing_token : '';
      let claims: Record<string, unknown> | null;
      try {
        claims = pairingToken ? verifyJwt(pairingToken, 'obrenna-server-pair') : null;
      } catch (error) {
        if (error instanceof Error && error.message.includes('INFERENCE_PAIRING_JWT_SECRET')) {
          console.error(error.message);
          return buildError('Server pairing is not configured. Contact the Obrenna site administrator.', 503);
        }
        throw error;
      }
      const hostId = claims?.sub;
      const organizationId = claims?.org;
      if (typeof hostId !== 'string' || typeof organizationId !== 'string') {
        return buildError('The host approval link is invalid or expired', 401);
      }
      return withAdmin(request, async (account) => {
        if (account.organization.id !== organizationId) return buildError('This host belongs to another organization', 403);
        try {
          return await withAuthDb(async (client) => {
            const result = await client.query(
              `UPDATE inference_hosts
               SET paired_at = NOW(), pairing_token_hash = NULL, pairing_expires_at = NULL
               WHERE id = $1 AND organization_id = $2 AND pairing_token_hash = $3
                 AND paired_at IS NULL AND revoked_at IS NULL
                 AND pairing_expires_at > NOW()
               RETURNING id, display_name`,
              [hostId, account.organization.id, digest(pairingToken)],
            );
            if (!result.rowCount) return buildError('This host approval link has expired or was already used', 410);
            return Response.json({ ok: true, host: result.rows[0] }, {
              headers: { 'Cache-Control': 'no-store' },
            });
          });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  },
  'enrollment-codes': {
    POST: async ({ request }) => withAdmin(request, async (account) => {
      const code = newToken();
      try {
        await withAuthDb((client) => client.query(
          `INSERT INTO inference_enrollment_codes (organization_id, code_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
          [account.organization.id, digest(code)],
        ));
        return Response.json({ code, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }, { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }),
  },
  machines: {
    GET: async ({ request }) => withAdmin(request, async (account) => {
      try {
        const result = await withAuthDb((client) => client.query(
          `SELECT id, display_name, hostname, os, 'client' AS kind,
                  CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                       WHEN last_seen_at > NOW() - INTERVAL '2 minutes' THEN 'online'
                       ELSE 'offline' END AS status,
                  last_seen_at, created_at
           FROM inference_clients WHERE organization_id = $1
           UNION ALL
           SELECT id, display_name, display_name AS hostname, 'Ollama host' AS os, 'host' AS kind,
                  CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                       WHEN paired_at IS NULL THEN 'pending'
                       WHEN last_seen_at > NOW() - INTERVAL '2 minutes' THEN 'online'
                       ELSE 'offline' END AS status,
                  last_seen_at, created_at
           FROM inference_hosts WHERE organization_id = $1
           ORDER BY created_at DESC`,
          [account.organization.id],
        ));
        return Response.json(result.rows);
      } catch (error) {
        return errorResponse(error);
      }
    }),
    POST: async ({ request }) => withAdmin(request, async (account) => {
      const id = new URL(request.url).searchParams.get('revoke');
      if (!id) return buildError('A machine ID is required', 400);
      try {
        return await withAuthDb(async (client) => {
          const clientResult = await client.query(
            `UPDATE inference_clients SET revoked_at = NOW()
             WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING id`,
            [id, account.organization.id],
          );
          if (clientResult.rowCount) return Response.json({ ok: true });
          const hostResult = await client.query(
            `UPDATE inference_hosts SET revoked_at = NOW()
             WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL RETURNING id`,
            [id, account.organization.id],
          );
          if (!hostResult.rowCount) return buildError('Machine not found or already revoked', 404);
          await client.query(
            'UPDATE inference_clients SET revoked_at = NOW() WHERE host_id = $1 AND revoked_at IS NULL',
            [id],
          );
          return Response.json({ ok: true });
        });
      } catch (error) {
        return errorResponse(error);
      }
    }),
  },
  'host/sync': {
    POST: async ({ request }) => {
      const hostToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!hostToken) return buildError('Host bearer credential required', 401);
      const body = await readJson(request);
      const clientActivity = parseClientActivity(body?.client_activity);
      if (!body || !clientActivity) return buildError('client_activity must contain at most 1000 valid client activity records', 400);
      const availableModels = body.available_models;
      if (availableModels !== null && (!Array.isArray(availableModels) || availableModels.length > 500 || availableModels.some((item) => typeof item !== 'string' || item.length > 200))) {
        return buildError('available_models must be an array of at most 500 model names', 400);
      }
      try {
        return await withAuthDb(async (client) => {
          const hostResult = await client.query(
            `SELECT id, organization_id, paired_at, revoked_at
             FROM inference_hosts WHERE token_hash = $1`,
            [digest(hostToken)],
          );
          const host = hostResult.rows[0];
          if (!host || host.revoked_at) return buildError('Host credential is invalid or revoked', 401);
          if (!host.paired_at) return buildError('Host is waiting for account approval', 409);
          const heartbeatResult = await client.query(
            `UPDATE inference_hosts
             SET last_seen_at = NOW(), available_models = COALESCE($2::jsonb, available_models)
             WHERE id = $1 AND revoked_at IS NULL AND paired_at IS NOT NULL`,
            [host.id, availableModels === null ? null : JSON.stringify(availableModels)],
          );
          if (!heartbeatResult.rowCount) return buildError('Host credential is invalid or revoked', 401);
          for (const activity of clientActivity) {
            await client.query(
              `UPDATE inference_clients SET last_seen_at = LEAST($1::timestamptz, NOW())
               WHERE token_hash = $2 AND host_id = $3 AND revoked_at IS NULL`,
              [activity.lastSeenAt, activity.tokenHash, host.id],
            );
          }
          await client.query(
            `INSERT INTO inference_guardrails (organization_id)
             VALUES ($1) ON CONFLICT (organization_id) DO NOTHING`,
            [host.organization_id],
          );
          const [policyResult, clientsResult] = await Promise.all([
            client.query(
              `SELECT revision, allowed_models, requests_per_minute, max_input_chars,
                      max_output_chars, blocked_terms, detect_sensitive_data
               FROM inference_guardrails WHERE organization_id = $1`,
              [host.organization_id],
            ),
            client.query(
              `SELECT token_hash FROM inference_clients
               WHERE host_id = $1 AND revoked_at IS NULL`,
              [host.id],
            ),
          ]);
          return Response.json({
            host_id: host.id,
            policy: policyResult.rows[0],
            client_token_hashes: clientsResult.rows.map((row) => row.token_hash),
          });
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  },
  'clients/redeem': {
    POST: async ({ request }) => {
      const hostToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!hostToken) return buildError('Host bearer credential required', 401);
      const body = await readJson(request);
      const code = typeof body?.code === 'string' ? body.code : '';
      const displayName = typeof body?.display_name === 'string' ? body.display_name.trim().slice(0, 120) : '';
      const hostname = typeof body?.hostname === 'string' ? body.hostname.trim().slice(0, 255) : '';
      const os = typeof body?.os === 'string' ? body.os.trim().slice(0, 120) : '';
      if (!code || !displayName || !hostname || !os) return buildError('Enrollment code and machine details are required', 422);
      try {
        return await withAuthDb(async (client) => {
          await client.query('BEGIN');
          try {
            const hostResult = await client.query(
              `SELECT id, organization_id FROM inference_hosts
               WHERE token_hash = $1 AND revoked_at IS NULL AND paired_at IS NOT NULL FOR UPDATE`,
              [digest(hostToken)],
            );
            const host = hostResult.rows[0];
            if (!host) {
              await client.query('ROLLBACK');
              return buildError('Host credential is invalid or revoked', 401);
            }
            const codeResult = await client.query(
              `UPDATE inference_enrollment_codes SET used_at = NOW()
               WHERE code_hash = $1 AND organization_id = $2
                 AND used_at IS NULL AND expires_at > NOW()
               RETURNING id`,
              [digest(code), host.organization_id],
            );
            if (!codeResult.rowCount) {
              await client.query('ROLLBACK');
              return buildError('Enrollment code is invalid, expired, or already used', 410);
            }
            const token = newToken();
            const clientResult = await client.query(
              `INSERT INTO inference_clients
                 (organization_id, host_id, display_name, hostname, os, token_hash)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, display_name`,
              [host.organization_id, host.id, displayName, hostname, os, digest(token)],
            );
            await client.query('COMMIT');
            return Response.json({ machine_id: clientResult.rows[0].id, display_name: clientResult.rows[0].display_name, token }, { status: 201 });
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  },
};

async function dispatch(method: 'GET' | 'POST' | 'PATCH', params: Record<string, unknown> | undefined, request: Request) {
  const route = getRoute(params);
  const handler = handlers[route]?.[method];
  if (!handler) return buildError('Route not found', 404);
  return handler({ request, route });
}

export const GET: APIRoute = ({ params, request }) => dispatch('GET', params as Record<string, unknown>, request);
export const POST: APIRoute = ({ params, request }) => dispatch('POST', params as Record<string, unknown>, request);
export const PATCH: APIRoute = ({ params, request }) => dispatch('PATCH', params as Record<string, unknown>, request);
