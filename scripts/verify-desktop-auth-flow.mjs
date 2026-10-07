import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import pg from 'pg';
import { importJWK, jwtVerify } from 'jose';
import { applyMigrations } from './migration-runner.mjs';

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error('Set MIGRATION_TEST_ADMIN_URL to a disposable PostgreSQL admin database URL');

const database = `obrenna_auth_flow_${randomUUID().replaceAll('-', '')}`;
const admin = new Client({ connectionString: adminUrl, application_name: 'obrenna-auth-flow-integration-test' });
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const userId = randomUUID();
const organizationId = randomUUID();
const secondOrganizationId = randomUUID();
const machineId = randomUUID();
const secondMachineId = randomUUID();
const sessionId = randomUUID();
const deviceKey = randomUUID();
const sessionToken = randomBytes(32).toString('base64url');
const email = `auth-flow-${randomUUID()}@example.test`;
let adminConnected = false;
let dbClient;
let appServer;
let createdDatabase = false;

function databaseUrl(name) {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function unusedPort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolveClose, rejectClose) => listener.close((error) => error ? rejectClose(error) : resolveClose()));
  return port;
}

async function waitForServer(baseUrl) {
  const expires = Date.now() + 30_000;
  while (Date.now() < expires) {
    if (appServer.exitCode !== null) throw new Error(`Built website server exited with ${appServer.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/.well-known/jwks.json`);
      if (response.status === 200) return;
    } catch {
      // The standalone server may need a short interval to bind its loopback port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error('Built website server did not become ready within 30 seconds');
}

async function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function expectStatus(response, status) {
  if (response.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${response.status}: ${await response.text()}`);
  }
}

try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE "${database}"`);
  createdDatabase = true;
  dbClient = new Client({ connectionString: databaseUrl(database), application_name: 'obrenna-auth-flow-fixture' });
  await dbClient.connect();
  await dbClient.query(await readFile(resolve(root, 'server-db/auth-schema-postgres.sql'), 'utf8'));
  await applyMigrations(dbClient, resolve(root, 'server-db/migrations'));
  await dbClient.query('INSERT INTO users(id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)',
    [userId, email, 'Integration User', 'unused']);
  await dbClient.query('INSERT INTO organizations(id, name, slug) VALUES ($1, $2, $3)',
    [organizationId, 'Integration Organization', `integration-${userId}`]);
  await dbClient.query('INSERT INTO organizations(id, name, slug) VALUES ($1, $2, $3)',
    [secondOrganizationId, 'Second Integration Organization', `second-${userId}`]);
  await dbClient.query('INSERT INTO organization_memberships(user_id, organization_id, role, status) VALUES ($1, $2, $3, $4)',
    [userId, organizationId, 'member', 'active']);
  await dbClient.query('INSERT INTO organization_memberships(user_id, organization_id, role, status) VALUES ($1, $2, $3, $4)',
    [userId, secondOrganizationId, 'member', 'active']);
  await dbClient.query('INSERT INTO auth_sessions(id, user_id, session_token, status, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL \'1 hour\')',
    [sessionId, userId, sessionToken, 'active']);
  await dbClient.query('INSERT INTO organization_inference_machines(id, organization_id, name, status) VALUES ($1, $2, $3, $4)',
    [machineId, organizationId, 'Integration Machine', 'active']);
  await dbClient.query('INSERT INTO organization_inference_machines(id, organization_id, name, status) VALUES ($1, $2, $3, $4)',
    [secondMachineId, secondOrganizationId, 'Second Integration Machine', 'active']);
  await dbClient.query('INSERT INTO organization_model_access(organization_id, machine_id, model_id, status) VALUES ($1, $2, $3, $4)',
    [organizationId, machineId, 'integration-model', 'active']);
  await dbClient.query('INSERT INTO organization_model_access(organization_id, machine_id, model_id, status) VALUES ($1, $2, $3, $4)',
    [secondOrganizationId, secondMachineId, 'second-integration-model', 'active']);

  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    APP_ENV: 'development',
    AUTH_DB_URL: databaseUrl(database),
    SITE_PUBLIC_ORIGIN: baseUrl,
    INFERENCE_GRANT_KEY_ID: 'integration-test-key',
    INFERENCE_GRANT_PRIVATE_KEY: privateKey,
    HOST: '127.0.0.1',
    PORT: String(port),
  };
  delete env.MIGRATION_TEST_ADMIN_URL;
  appServer = spawn(process.execPath, [resolve(root, 'dist/server/entry.mjs')], {
    cwd: root,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForServer(baseUrl);

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  const cookie = `obrenna_auth=session:${sessionToken}`;
  const authorize = await postJson(baseUrl, '/api/auth/desktop-authorize', {
    desktop_callback: 'obrenna://auth',
    code_challenge: challenge,
    state,
  }, { Cookie: cookie });
  await expectStatus(authorize, 200);
  const authorization = await authorize.json();
  const callback = new URL(authorization.callback_url);
  const code = callback.searchParams.get('code');
  assert.ok(code);
  assert.equal(callback.searchParams.get('state'), state);

  const mismatched = await postJson(baseUrl, '/api/auth/desktop-exchange', {
    code, state: randomBytes(32).toString('base64url'), code_verifier: verifier, device_key: deviceKey,
  });
  await expectStatus(mismatched, 401);

  const exchangeBody = { code, state, code_verifier: verifier, device_key: deviceKey };
  const exchanged = await postJson(baseUrl, '/api/auth/desktop-exchange', exchangeBody);
  await expectStatus(exchanged, 200);
  const identity = await exchanged.json();
  assert.equal(identity.session.token, sessionToken);
  assert.equal(identity.user.id, userId);
  assert.ok(identity.device_id);
  assert.equal(identity.devices.length, 2);
  const selectedDevice = identity.devices.find((device) => device.organization_id === secondOrganizationId);
  assert.ok(selectedDevice?.device_id);

  const replay = await postJson(baseUrl, '/api/auth/desktop-exchange', exchangeBody);
  await expectStatus(replay, 401);

  const jwksResponse = await fetch(`${baseUrl}/.well-known/jwks.json`);
  assert.equal(jwksResponse.status, 200);
  const jwks = await jwksResponse.json();
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, 'integration-test-key');
  assert.equal('d' in jwks.keys[0], false);

  const grantResponse = await postJson(baseUrl, '/api/auth/inference-grant', {
    device_id: selectedDevice.device_id,
    organization_id: secondOrganizationId,
  }, { Authorization: `Bearer ${sessionToken}` });
  await expectStatus(grantResponse, 200);
  const grantResult = await grantResponse.json();
  const publicKey = await importJWK(jwks.keys[0], 'RS256');
  const verified = await jwtVerify(grantResult.grant, publicKey, { issuer: baseUrl, audience: 'obrenna-inference' });
  assert.equal(verified.payload.sub, userId);
  assert.equal(verified.payload.org, secondOrganizationId);
  assert.equal(verified.payload.device, selectedDevice.device_id);
  assert.deepEqual(verified.payload.assignments, [{ machine_id: secondMachineId, model_id: 'second-integration-model' }]);

  const activeStatus = await postJson(baseUrl, '/api/auth/inference-grant-status', { grant: grantResult.grant });
  await expectStatus(activeStatus, 200);
  assert.equal((await activeStatus.json()).status, 'active');
  await dbClient.query('UPDATE organization_memberships SET status = $1 WHERE user_id = $2 AND organization_id = $3', ['suspended', userId, secondOrganizationId]);
  const blockedRenewal = await postJson(baseUrl, '/api/auth/inference-grant', {
    device_id: selectedDevice.device_id,
    organization_id: secondOrganizationId,
  }, { Authorization: `Bearer ${sessionToken}` });
  await expectStatus(blockedRenewal, 403);
  const revokedStatus = await postJson(baseUrl, '/api/auth/inference-grant-status', { grant: grantResult.grant });
  await expectStatus(revokedStatus, 403);
  assert.equal((await revokedStatus.json()).status, 'revoked');

  // Membership reactivation explicitly permits a fresh desktop enrollment.
  // A device row suspended with the membership may return; an individually
  // revoked row does not match the exchange endpoint's suspended-only rule.
  await dbClient.query(
    'UPDATE organization_memberships SET status = $1 WHERE user_id = $2 AND organization_id = $3',
    ['active', userId, secondOrganizationId],
  );
  const reauthVerifier = randomBytes(32).toString('base64url');
  const reauthChallenge = createHash('sha256').update(reauthVerifier).digest('base64url');
  const reauthState = randomBytes(32).toString('base64url');
  const reauthorize = await postJson(baseUrl, '/api/auth/desktop-authorize', {
    desktop_callback: 'obrenna://auth', code_challenge: reauthChallenge, state: reauthState,
  }, { Cookie: cookie });
  await expectStatus(reauthorize, 200);
  const reauthCallback = new URL((await reauthorize.json()).callback_url);
  const reenrolled = await postJson(baseUrl, '/api/auth/desktop-exchange', {
    code: reauthCallback.searchParams.get('code'), state: reauthState,
    code_verifier: reauthVerifier, device_key: deviceKey,
  });
  await expectStatus(reenrolled, 200);
  const rejoinedIdentity = await reenrolled.json();
  const rejoinedDevice = rejoinedIdentity.devices.find(
    (device) => device.organization_id === secondOrganizationId,
  );
  assert.equal(rejoinedDevice?.device_id, selectedDevice.device_id);
  const renewedGrant = await postJson(baseUrl, '/api/auth/inference-grant', {
    device_id: rejoinedDevice.device_id, organization_id: secondOrganizationId,
  }, { Authorization: `Bearer ${sessionToken}` });
  await expectStatus(renewedGrant, 200);
  const renewedStatus = await postJson(baseUrl, '/api/auth/inference-grant-status', {
    grant: (await renewedGrant.json()).grant,
  });
  await expectStatus(renewedStatus, 200);
  assert.equal((await renewedStatus.json()).status, 'active');

  // A device explicitly marked revoked while its membership is active must
  // not be reactivated by the suspended-device re-enrollment path.
  await dbClient.query(
    "UPDATE desktop_auth_devices SET status = 'revoked' WHERE id = $1",
    [selectedDevice.device_id],
  );
  const revokedDeviceVerifier = randomBytes(32).toString('base64url');
  const revokedDeviceChallenge = createHash('sha256').update(revokedDeviceVerifier).digest('base64url');
  const revokedDeviceState = randomBytes(32).toString('base64url');
  const revokedDeviceAuthorize = await postJson(baseUrl, '/api/auth/desktop-authorize', {
    desktop_callback: 'obrenna://auth',
    code_challenge: revokedDeviceChallenge,
    state: revokedDeviceState,
  }, { Cookie: cookie });
  await expectStatus(revokedDeviceAuthorize, 200);
  const revokedDeviceCallback = new URL((await revokedDeviceAuthorize.json()).callback_url);
  const afterExplicitDeviceRevocation = await postJson(baseUrl, '/api/auth/desktop-exchange', {
    code: revokedDeviceCallback.searchParams.get('code'),
    state: revokedDeviceState,
    code_verifier: revokedDeviceVerifier,
    device_key: deviceKey,
  });
  await expectStatus(afterExplicitDeviceRevocation, 200);
  const afterRevocationIdentity = await afterExplicitDeviceRevocation.json();
  assert.equal(
    afterRevocationIdentity.devices.some((device) => device.organization_id === secondOrganizationId),
    false,
  );
  const revokedDeviceGrant = await postJson(baseUrl, '/api/auth/inference-grant', {
    device_id: selectedDevice.device_id,
    organization_id: secondOrganizationId,
  }, { Authorization: `Bearer ${sessionToken}` });
  await expectStatus(revokedDeviceGrant, 403);

  console.log('Built website PKCE, one-use exchange, re-enrollment, explicit device revocation, signed grant, JWKS, and grant revocation checks passed.');
} finally {
  if (appServer && appServer.exitCode === null) {
    appServer.kill();
    await Promise.race([once(appServer, 'exit'), new Promise((resolveExit) => setTimeout(resolveExit, 5000))]);
  }
  if (dbClient) await dbClient.end();
  if (adminConnected && createdDatabase) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  }
  if (adminConnected) await admin.end();
}
