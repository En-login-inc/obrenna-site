import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify, type LocalJWKSet, type RemoteJWKSet } from 'jose';
import type { PoolClient } from 'pg';
import { oidcConfig, type OidcConfig } from './auth-config.ts';

export type OidcDiscovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

export type OidcClaims = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
};

export type OidcRequestPayload = {
  nonce: string;
  verifier: string;
  redirectUri: string;
  returnTo: string | null;
  desktop: { callback: string; codeChallenge: string; state: string } | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function generateOidcState(): string {
  return base64url(randomBytes(32));
}

export function generateOidcNonce(): string {
  return base64url(randomBytes(16));
}

export function generatePkceVerifier(): string {
  return base64url(randomBytes(32));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function discoverOidc(issuer: string, fetchImpl: FetchLike = fetch): Promise<OidcDiscovery> {
  const response = await fetchImpl(`${issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
  const document = (await response.json()) as Record<string, unknown>;
  if (document.issuer !== issuer) throw new Error('OIDC discovery issuer mismatch');
  const authorizationEndpoint = String(document.authorization_endpoint ?? '');
  const tokenEndpoint = String(document.token_endpoint ?? '');
  const jwksUri = String(document.jwks_uri ?? '');
  for (const endpoint of [authorizationEndpoint, tokenEndpoint, jwksUri]) {
    if (!endpoint.startsWith('https://')) throw new Error('OIDC endpoints must use HTTPS');
  }
  return { authorizationEndpoint, tokenEndpoint, jwksUri };
}

export function remoteJwks(jwksUri: string, fetchImpl: FetchLike = fetch): RemoteJWKSet {
  return createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: 8000,
    [customFetch]: fetchImpl as never,
  });
}

export async function verifyOidcIdToken(
  token: string,
  config: Pick<OidcConfig, 'issuer' | 'clientId'>,
  nonce: string,
  jwks: LocalJWKSet | RemoteJWKSet,
): Promise<OidcClaims> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ['RS256'],
    clockTolerance: 30,
  });
  if (!payload.sub) throw new Error('OIDC id_token has no subject');
  if (payload.nonce !== nonce) throw new Error('OIDC nonce mismatch');
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  const nameClaim = typeof payload.name === 'string' ? payload.name
    : typeof payload.preferred_username === 'string' ? payload.preferred_username
    : null;
  return {
    sub: String(payload.sub),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 255) : null,
    emailVerified,
    fullName: nameClaim ? nameClaim.trim().slice(0, 255) : null,
  };
}

export function buildOidcAuthorizationUrl(
  config: OidcConfig,
  discovery: OidcDiscovery,
  input: { state: string; nonce: string; codeChallenge: string; redirectUri: string },
): string {
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeOidcCode(
  config: OidcConfig,
  discovery: OidcDiscovery,
  input: { code: string; redirectUri: string; codeVerifier: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const response = await fetchImpl(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`OIDC token exchange failed (${response.status})`);
  const document = (await response.json()) as Record<string, unknown>;
  if (typeof document.id_token !== 'string' || !document.id_token) {
    throw new Error('OIDC token response has no id_token');
  }
  return document.id_token;
}

export async function storeOidcRequest(client: PoolClient, state: string, payload: OidcRequestPayload): Promise<void> {
  await client.query('DELETE FROM oidc_auth_requests WHERE expires_at <= NOW()');
  await client.query(
    `INSERT INTO oidc_auth_requests (state, payload, expires_at)
     VALUES ($1, $2::jsonb, NOW() + INTERVAL '5 minutes')`,
    [state, JSON.stringify(payload)],
  );
}

export async function consumeOidcRequest(client: PoolClient, state: string): Promise<OidcRequestPayload | null> {
  const result = await client.query(
    'DELETE FROM oidc_auth_requests WHERE state = $1 AND expires_at > NOW() RETURNING payload',
    [state],
  );
  if (!result.rowCount) return null;
  return result.rows[0].payload as OidcRequestPayload;
}

/**
 * Resolve the local user for a verified IdP identity. Links to an existing
 * password account only when the IdP asserts a verified email; otherwise
 * provisions a new account. Runs inside the caller's transaction.
 */
export async function provisionOidcUser(
  client: PoolClient,
  issuer: string,
  claims: OidcClaims,
): Promise<{ id: string; email: string; full_name: string }> {
  const identity = await client.query(
    `SELECT u.id, u.email, u.full_name
       FROM user_identities i
       JOIN users u ON u.id = i.user_id AND u.status = 'active'
      WHERE i.issuer = $1 AND i.subject = $2`,
    [issuer, claims.sub],
  );
  if (identity.rowCount) return identity.rows[0];

  if (claims.email && claims.emailVerified) {
    const existing = await client.query(
      "SELECT id, email, full_name FROM users WHERE email = $1 AND status = 'active'",
      [claims.email],
    );
    if (existing.rowCount) {
      await client.query(
        `INSERT INTO user_identities (user_id, issuer, subject, email, email_verified)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (issuer, subject) DO NOTHING`,
        [existing.rows[0].id, issuer, claims.sub, claims.email],
      );
      return existing.rows[0];
    }
  }

  const email = claims.email ?? `oidc-${createHash('sha256').update(`${issuer}:${claims.sub}`).digest('hex').slice(0, 20)}@oidc.invalid`;
  const fullName = claims.fullName || (claims.email ? claims.email.split('@')[0] : 'Obrenna user');
  const unusablePasswordHash = `oidc$${randomUUID().replace(/-/g, '')}`;
  const created = await client.query(
    `INSERT INTO users (email, full_name, password_hash, status, email_verified_at)
     VALUES ($1, $2, $3, 'active', $4)
     RETURNING id, email, full_name`,
    [email, fullName.slice(0, 255), unusablePasswordHash, claims.email && claims.emailVerified ? new Date() : null],
  );
  await client.query(
    `INSERT INTO user_identities (user_id, issuer, subject, email, email_verified)
     VALUES ($1, $2, $3, $4, $5)`,
    [created.rows[0].id, issuer, claims.sub, claims.email, claims.emailVerified],
  );
  return created.rows[0];
}

export function oidcEnabled(): boolean {
  try {
    return oidcConfig() !== null;
  } catch {
    return false;
  }
}