/**
 * End-to-end integration: real site assertion -> real FastAPI portal route.
 *
 * Skipped automatically when the backend venv is unavailable; exercises the
 * RS256 assertion contract across both codebases (site signs with jose,
 * FastAPI verifies with PyJWT).
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = resolve(
  process.env.OBRENNA_BACKEND_ROOT || resolve(siteRoot, '..', 'GrebGlob', 'backend'),
);

const backendPython = process.env.OBRENNA_BACKEND_PYTHON
  || (existsSync(join(backendRoot, '.venv', 'Scripts', 'python.exe'))
    ? join(backendRoot, '.venv', 'Scripts', 'python.exe')
    : existsSync(join(backendRoot, '.venv', 'bin', 'python'))
      ? join(backendRoot, '.venv', 'bin', 'python')
      : 'python');
const hasBackend = existsSync(join(backendRoot, 'main.py'))
  && (Boolean(process.env.OBRENNA_BACKEND_PYTHON)
    || existsSync(join(backendRoot, '.venv', 'Scripts', 'python.exe'))
    || existsSync(join(backendRoot, '.venv', 'bin', 'python')));
if (process.env.OBRENNA_REQUIRE_BACKEND_INTEGRATION === '1' && !hasBackend) {
  throw new Error('OBRENNA_REQUIRE_BACKEND_INTEGRATION is set, but the desktop backend checkout or Python runtime is missing');
}

const testFn = hasBackend ? test : test.skip;

const require = createRequire(import.meta.url);

let serverProcess: ReturnType<typeof spawn> | null = null;
let baseUrl = '';
let privateKeyPem = '';

before(async () => {
  if (!hasBackend) return;
  const jose = require('jose');
  const { generateKeyPairSync } = require('node:crypto');
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const port = 8731;
  baseUrl = `http://127.0.0.1:${port}`;
  const script = `import uvicorn, main; uvicorn.run(main.app, host='127.0.0.1', port=${port}, log_level='warning')`;
  serverProcess = spawn(backendPython, ['-c', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      OBRENNA_APP_KIND: 'combined',
      OBRENNA_ALLOW_COMBINED_APP: '1',
      OBRENNA_TELEMETRY: 'off',
      OBRENNA_PORTAL_SIGNING_PUBLIC_KEY: publicPem,
    },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && serverProcess.exitCode === null) {
    try {
      const response = await fetch(`${baseUrl}/openapi.json`);
      if (response.ok) { ready = true; break; }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!ready) throw new Error('control plane did not become ready');
});

after(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

testFn('control plane rejects a bogus bearer token', async () => {
  const response = await fetch(`${baseUrl}/api/portal/org-x/portal/overview`, {
    headers: { Authorization: 'Bearer not-a-real-assertion' },
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(String(body.detail), /assertion/i);
});

testFn('site-signed assertion reaches authorization on the real service', async () => {
  const { SignJWT, importPKCS8 } = require('jose');
  const key = await importPKCS8(privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ org: 'o', role: 'admin', ver: 'v1' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer('obrenna-site')
    .setAudience('obrenna-portal')
    .setSubject('site-user-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 120)
    .sign(key);

  const response = await fetch(`${baseUrl}/api/portal/o/portal/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // 403 means the RS256 signature verified and issuer/audience/version checks
  // passed; the request stopped at identity binding (unknown site user), which
  // is exactly where an unprovisioned identity should stop.
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.detail, 'Website identity is unknown or inactive');
});
