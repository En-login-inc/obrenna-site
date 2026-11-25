import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, importPKCS8, SignJWT } from 'jose';
import { oidcConfig } from '../src/lib/auth-config.ts';
import {
  buildOidcAuthorizationUrl,
  consumeOidcRequest,
  generatePkceVerifier,
  pkceChallenge,
  provisionOidcUser,
  storeOidcRequest,
  verifyOidcIdToken,
  type OidcClaims,
} from '../src/lib/oidc.ts';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicJwk = await exportJWK(pair.publicKey);
const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, kid: 'idp-key-1', alg: 'RS256', use: 'sig' }] });
const issuer = 'https://idp.example.test';
const clientId = 'obrenna-site';
const config = { issuer, clientId, clientSecret: 'secret', scopes: 'openid profile email' };

async function idToken(claims: Record<string, unknown>, overrides: { issuer?: string; audience?: string; expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'idp-key-1' })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? clientId)
    .setSubject(String(claims.sub ?? 'idp-user-1'))
    .setIssuedAt(now)
    .setExpirationTime(overrides.expired ? now - 600 : now + 600)
    .sign(await importPKCS8(privatePem, 'RS256'));
}

test('id_token verification accepts a correctly signed token with matching nonce', async () => {
  const token = await idToken({ sub: 'idp-user-1', nonce: 'nonce-abc', email: 'User@Company.com', email_verified: true, name: 'Test User' });
  const claims = await verifyOidcIdToken(token, config, 'nonce-abc', jwks);
  assert.equal(claims.sub, 'idp-user-1');
  assert.equal(claims.email, 'user@company.com');
  assert.equal(claims.emailVerified, true);
  assert.equal(claims.fullName, 'Test User');
});

test('id_token verification rejects wrong audience, issuer, nonce, expiry, and tampering', async () => {
  const base = { sub: 'idp-user-1', nonce: 'nonce-abc' };
  await assert.rejects(async () => verifyOidcIdToken(await idToken(base, { audience: 'other-app' }), config, 'nonce-abc', jwks));
  await assert.rejects(async () => verifyOidcIdToken(await idToken(base, { issuer: 'https://evil.example.test' }), config, 'nonce-abc', jwks));
  const wrongNonceToken = await idToken(base);
  await assert.rejects(() => verifyOidcIdToken(wrongNonceToken, config, 'different-nonce', jwks));
  await assert.rejects(async () => verifyOidcIdToken(await idToken(base, { expired: true }), config, 'nonce-abc', jwks));
  const token = await idToken(base);
  const parts = token.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  await assert.rejects(() => verifyOidcIdToken(parts.join('.'), config, 'nonce-abc', jwks));
});

test('authorization URL carries PKCE, state, nonce, and configured scopes', async () => {
  const url = new URL(buildOidcAuthorizationUrl(config, {
    authorizationEndpoint: 'https://idp.example.test/authorize',
    tokenEndpoint: 'https://idp.example.test/token',
    jwksUri: 'https://idp.example.test/jwks',
  }, { state: 'state-1', nonce: 'nonce-1', codeChallenge: 'challenge-1', redirectUri: 'https://site.test/api/auth/oidc/callback' }));
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), clientId);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://site.test/api/auth/oidc/callback');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('nonce'), 'nonce-1');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('PKCE challenge matches the RFC 7636 S256 vector', async () => {
  const challenge = await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.match(generatePkceVerifier(), /^[A-Za-z0-9_-]{43}$/);
});

type FakeRow = Record<string, unknown>;

function fakeClient() {
  const state = {
    users: [] as FakeRow[],
    identities: [] as FakeRow[],
    requests: new Map<string, { payload: unknown; expired: boolean }>(),
  };
  const client = {
    state,
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes('FROM user_identities i')) {
        const [iss, sub] = params as string[];
        const identity = state.identities.find((i) => i.issuer === iss && i.subject === sub);
        const user = identity ? state.users.find((u) => u.id === identity.user_id && u.status === 'active') : undefined;
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }
      if (sql.includes('FROM users WHERE email')) {
        const user = state.users.find((u) => u.email === params[0] && u.status === 'active');
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }
      if (sql.includes('INSERT INTO users')) {
        const [email, fullName, passwordHash] = params as string[];
        const user = { id: randomUUID(), email, full_name: fullName, password_hash: passwordHash, status: 'active' };
        state.users.push(user);
        return { rowCount: 1, rows: [user] };
      }
      if (sql.includes('INSERT INTO user_identities')) {
        const [userId, iss, sub, email, verified] = params as [string, string, string, string | null, boolean];
        if (!state.identities.some((i) => i.issuer === iss && i.subject === sub)) {
          state.identities.push({ user_id: userId, issuer: iss, subject: sub, email, email_verified: verified });
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM oidc_auth_requests WHERE expires_at')) {
        for (const [key, value] of state.requests) if (value.expired) state.requests.delete(key);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO oidc_auth_requests')) {
        state.requests.set(params[0] as string, { payload: JSON.parse(params[1] as string), expired: false });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM oidc_auth_requests WHERE state')) {
        const entry = state.requests.get(params[0] as string);
        if (!entry || entry.expired) return { rowCount: 0, rows: [] };
        state.requests.delete(params[0] as string);
        return { rowCount: 1, rows: [{ payload: entry.payload }] };
      }
      throw new Error(`fake client: unhandled SQL: ${sql.slice(0, 80)}`);
    },
  };
  return client as unknown as import('pg').PoolClient & { state: typeof state };
}

const claims: OidcClaims = { sub: 'idp-user-1', email: 'user@company.com', emailVerified: true, fullName: 'Test User' };

test('provisioning creates a user with an unusable password hash and an identity', async () => {
  const client = fakeClient();
  const user = await provisionOidcUser(client, issuer, { ...claims, email: null, emailVerified: false, fullName: null });
  assert.ok(user.id);
  assert.match(user.email, /^oidc-[a-f0-9]{20}@oidc\.invalid$/);
  const stored = client.state.users[0];
  assert.match(String(stored.password_hash), /^oidc\$[a-f0-9]{32}$/);
  assert.equal(String(stored.password_hash).includes(':'), false);
  assert.equal(client.state.identities.length, 1);
});

test('provisioning links a verified email to an existing password account', async () => {
  const client = fakeClient();
  client.state.users.push({ id: 'existing-user', email: 'user@company.com', full_name: 'Existing', password_hash: 'salt:hash', status: 'active' });
  const user = await provisionOidcUser(client, issuer, claims);
  assert.equal(user.id, 'existing-user');
  assert.equal(client.state.users.length, 1);
  assert.equal(client.state.identities[0].user_id, 'existing-user');
});

test('provisioning never links an unverified email', async () => {
  const client = fakeClient();
  client.state.users.push({ id: 'existing-user', email: 'user@company.com', full_name: 'Existing', password_hash: 'salt:hash', status: 'active' });
  const user = await provisionOidcUser(client, issuer, { ...claims, emailVerified: false });
  assert.notEqual(user.id, 'existing-user');
  assert.equal(client.state.users.length, 2);
});

test('provisioning returns the same user for a returning identity', async () => {
  const client = fakeClient();
  const first = await provisionOidcUser(client, issuer, claims);
  const second = await provisionOidcUser(client, issuer, claims);
  assert.equal(second.id, first.id);
  assert.equal(client.state.users.length, 1);
});

test('OIDC authorization requests are single-use and expire', async () => {
  const client = fakeClient();
  const payload = { nonce: 'n', verifier: 'v', redirectUri: 'https://site.test/cb', returnTo: null, desktop: null };
  await storeOidcRequest(client, 'state-1', payload);
  const first = await consumeOidcRequest(client, 'state-1');
  assert.deepEqual(first, payload);
  const second = await consumeOidcRequest(client, 'state-1');
  assert.equal(second, null);
  await storeOidcRequest(client, 'state-2', payload);
  client.state.requests.get('state-2')!.expired = true;
  assert.equal(await consumeOidcRequest(client, 'state-2'), null);
});

test('OIDC configuration is absent unless issuer and client id are set', () => {
  const saved = { issuer: process.env.OIDC_ISSUER, clientId: process.env.OIDC_CLIENT_ID, env: process.env.APP_ENV };
  try {
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    assert.equal(oidcConfig(), null);
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_CLIENT_ID = clientId;
    process.env.APP_ENV = 'development';
    const configured = oidcConfig();
    assert.equal(configured?.issuer, issuer);
    assert.equal(configured?.clientId, clientId);
    assert.equal(configured?.scopes, 'openid profile email');
  } finally {
    for (const [key, value] of [['OIDC_ISSUER', saved.issuer], ['OIDC_CLIENT_ID', saved.clientId], ['APP_ENV', saved.env]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});