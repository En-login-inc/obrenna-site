import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { SignJWT, importPKCS8 } from 'jose';

const original = {
  appEnv: process.env.APP_ENV,
  issuer: process.env.CONTROL_PLANE_ASSERTION_ISSUER,
  kid: process.env.CONTROL_PLANE_ASSERTION_KEY_ID,
  key: process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY,
  controlPlaneUrl: process.env.CONTROL_PLANE_URL,
};

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

before(() => {
  process.env.APP_ENV = 'development';
  process.env.CONTROL_PLANE_ASSERTION_ISSUER = 'obrenna-site';
  process.env.CONTROL_PLANE_ASSERTION_KEY_ID = 'portal-key-1';
  process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY = PRIVATE_PEM;
  process.env.CONTROL_PLANE_URL = 'https://control-plane.example.test';
});

after(() => {
  for (const [key, value] of [
    ['APP_ENV', original.appEnv],
    ['CONTROL_PLANE_ASSERTION_ISSUER', original.issuer],
    ['CONTROL_PLANE_ASSERTION_KEY_ID', original.kid],
    ['CONTROL_PLANE_ASSERTION_PRIVATE_KEY', original.key],
    ['CONTROL_PLANE_URL', original.controlPlaneUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const { signPortalAssertion, controlPlaneConfig, controlPlaneConfigured } = await import('../src/lib/portal/control-plane-config.ts');
const { PortalApiError, controlPlaneRequest } = await import('../src/lib/portal/control-plane-client.ts');

test('portal assertion is RS256-signed with site identity, org, role, and short expiry', async () => {
  const token = await signPortalAssertion({
    siteUserId: 'user-1',
    organizationId: 'org-1',
    role: 'admin',
    sessionId: 'session-1',
  });
  const { createPublicKey } = await import('node:crypto');
  const { jwtVerify, importSPKI } = await import('jose');
  const spki = createPublicKey(PRIVATE_PEM).export({ type: 'spki', format: 'pem' }).toString();
  const publicKey = await importSPKI(spki, 'RS256');
  const verified = await jwtVerify(token, publicKey, {
    issuer: 'obrenna-site',
    audience: 'obrenna-portal',
  });
  assert.equal(verified.payload.sub, 'user-1');
  assert.equal(verified.payload.org, 'org-1');
  assert.equal(verified.payload.role, 'admin');
  assert.equal(verified.payload.ver, 'v1');
  assert.ok(Number(verified.payload.exp) - Number(verified.payload.iat) <= 120);
});

test('assertion signing fails closed without key material', async () => {
  delete process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY;
  process.env.APP_ENV = 'production';
  assert.equal(controlPlaneConfigured(), false);
  await assert.rejects(() => signPortalAssertion({
    siteUserId: 'u', organizationId: 'o', role: 'admin', sessionId: 's',
  }), /not configured/);
  process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY = PRIVATE_PEM;
  process.env.APP_ENV = 'development';
});

test('control-plane requests attach the signed assertion and map provider errors', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    const auth = init?.headers?.Authorization ?? '';
    if (!auth.startsWith('Bearer ')) throw new Error('assertion must be attached');
    if (calls.length === 1) {
      return new Response(JSON.stringify({ detail: 'Not a member of this organization' }), { status: 403 });
    }
    return new Response(JSON.stringify({ ok: true, tiles: {} }), { status: 200 });
  });

  try {
    const session = { siteUserId: 'u1', organizationId: 'o1', role: 'admin', sessionId: 's1' };
    await assert.rejects(
      () => controlPlaneRequest(session, '/api/portal/o1/portal/overview'),
      (error) => error instanceof PortalApiError
        && error.kind === 'forbidden'
        && error.message === 'You do not have permission to perform this action'
        && !error.message.includes('Not a member'),
    );
    const ok = await controlPlaneRequest(session, '/api/portal/o1/portal/overview');
    assert.equal(ok.data.ok, true);
    assert.ok(calls[0].url.startsWith('https://control-plane.example.test/'));
    assert.ok(calls[0].init.headers.Authorization.startsWith('Bearer '));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('control-plane requests fail closed when signing configuration is absent', async () => {
  delete process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY;
  try {
    await assert.rejects(
      () => controlPlaneRequest(
        { siteUserId: 'u', organizationId: 'o', role: 'admin', sessionId: 's' },
        '/api/portal/o/portal/overview',
      ),
      /not configured/,
    );
  } finally {
    process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY = PRIVATE_PEM;
  }
});

test('control-plane timeout remains active while the response body is being read', async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.CONTROL_PLANE_TIMEOUT_MS;
  process.env.CONTROL_PLANE_TIMEOUT_MS = '25';
  globalThis.fetch = (async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    },
  }))) as typeof fetch;

  try {
    await assert.rejects(
      () => controlPlaneRequest(
        { siteUserId: 'u', organizationId: 'o', role: 'admin', sessionId: 's' },
        '/api/portal/o/portal/overview',
      ),
      (error) => error instanceof PortalApiError && error.kind === 'unavailable',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.CONTROL_PLANE_TIMEOUT_MS;
    else process.env.CONTROL_PLANE_TIMEOUT_MS = originalTimeout;
  }
});

test('control-plane URL is normalized and timeout is configurable', () => {
  assert.equal(controlPlaneConfig().baseUrl, 'https://control-plane.example.test');
});
