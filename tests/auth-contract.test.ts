import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, test } from 'node:test';
import { exportJWK, importJWK, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { publicGrantJwks, signInferenceGrant, verifyInferenceGrant } from '../src/lib/inference-grants.ts';
import { checkInferenceGrantStatus } from '../src/lib/inference-grant-status.ts';
import { billingSyncStatus, unavailableBillingPortal } from '../src/lib/billing-status.ts';
import { unavailableMutation } from '../src/lib/api/mutation-result.ts';
import { handleOrganizationMembers } from '../src/lib/organization-members.ts';

const original = {
  appEnv: process.env.APP_ENV,
  origin: process.env.SITE_PUBLIC_ORIGIN,
  kid: process.env.INFERENCE_GRANT_KEY_ID,
  key: process.env.INFERENCE_GRANT_PRIVATE_KEY,
  previousKeys: process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS,
};
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.APP_ENV = 'development';
process.env.SITE_PUBLIC_ORIGIN = 'https://auth.example.test';
process.env.INFERENCE_GRANT_KEY_ID = 'test-key-1';
process.env.INFERENCE_GRANT_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

after(() => {
  for (const [key, value] of [
    ['APP_ENV', original.appEnv],
    ['SITE_PUBLIC_ORIGIN', original.origin],
    ['INFERENCE_GRANT_KEY_ID', original.kid],
    ['INFERENCE_GRANT_PRIVATE_KEY', original.key],
    ['INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS', original.previousKeys],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('published JWKS and status verification retain old public keys during grant rotation', async () => {
  const oldKid = process.env.INFERENCE_GRANT_KEY_ID!;
  const oldPrivatePem = process.env.INFERENCE_GRANT_PRIVATE_KEY!;
  const previousKeys = process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS;
  const oldPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nextPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const oldPrivate = oldPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const oldJwk = await exportJWK(oldPair.publicKey);
  const nextPrivate = nextPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  try {
    const now = Math.floor(Date.now() / 1000);
    const oldToken = await new SignJWT({
      org: 'org-1', device: 'device-1', machines: ['machine-1'], models: ['model-1'],
      assignments: [{ machine_id: 'machine-1', model_id: 'model-1' }], policy_rev: 7,
    })
      .setProtectedHeader({ alg: 'RS256', kid: oldKid, typ: 'JWT' })
      .setIssuer('https://auth.example.test')
      .setAudience('obrenna-inference')
      .setSubject('user-1')
      .setJti('rotation-test-grant')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await importPKCS8(oldPrivate, 'RS256'));

    process.env.INFERENCE_GRANT_KEY_ID = 'test-key-2';
    process.env.INFERENCE_GRANT_PRIVATE_KEY = nextPrivate;
    process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS = JSON.stringify([{ ...oldJwk, kid: oldKid }]);

    const claims = await verifyInferenceGrant(oldToken);
    assert.equal(claims.sub, 'user-1');
    const jwks = await publicGrantJwks();
    assert.deepEqual(jwks.keys.map((key) => key.kid), ['test-key-2', oldKid]);
    assert.ok(jwks.keys.every((key) => !('d' in key)), 'published keys must be public-only');
  } finally {
    process.env.INFERENCE_GRANT_KEY_ID = oldKid;
    process.env.INFERENCE_GRANT_PRIVATE_KEY = oldPrivatePem;
    if (previousKeys === undefined) delete process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS;
    else process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS = previousKeys;
  }
});

test('website grant is RS256 signed, key-discoverable, and expires within 24 hours', async () => {
  const now = Math.floor(Date.now() / 1000);
  const grant = await signInferenceGrant({
    subject: 'user-1',
    organizationId: 'org-1',
    deviceId: 'device-1',
    assignments: [{ machineId: 'machine-1', modelId: 'model-1' }],
    policyRevision: 7,
  });
  const jwks = await publicGrantJwks();
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, 'test-key-1');
  assert.equal('d' in jwks.keys[0], false, 'JWKS must not expose private key material');

  const publicKey = await importJWK(jwks.keys[0], 'RS256');
  const { payload, protectedHeader } = await jwtVerify(grant.token, publicKey, {
    issuer: 'https://auth.example.test',
    audience: 'obrenna-inference',
  });
  assert.equal(protectedHeader.alg, 'RS256');
  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.org, 'org-1');
  assert.equal(payload.device, 'device-1');
  assert.deepEqual(payload.machines, ['machine-1']);
  assert.deepEqual(payload.models, ['model-1']);
  assert.deepEqual(payload.assignments, [{ machine_id: 'machine-1', model_id: 'model-1' }]);
  assert.equal(payload.policy_rev, 7);
  assert.ok(Number(payload.exp) - now <= 86400);
  assert.ok(Number(payload.exp) > now);
  const checked = await verifyInferenceGrant(grant.token);
  assert.equal(checked.jti, payload.jti);
  assert.equal(checked.device, 'device-1');
  const parts = grant.token.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  await assert.rejects(() => verifyInferenceGrant(parts.join('.')));
});

test('grant signing fails closed when deployment key configuration is absent', async () => {
  delete process.env.INFERENCE_GRANT_PRIVATE_KEY;
  await assert.rejects(() => publicGrantJwks(), /must be configured/);
  process.env.INFERENCE_GRANT_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
});

test('unconfigured billing controls never report success or readiness', async () => {
  const portal = unavailableBillingPortal();
  assert.equal(portal.status, 501);
  assert.equal((await portal.json()).ok, false);

  const status = billingSyncStatus(false);
  const body = await status.json();
  assert.equal(body.ok, true);
  assert.equal(body.sync.status, 'unavailable');
});

test('unimplemented organization mutations explicitly fail without claiming changes', () => {
  const result = unavailableMutation('Machine enrollment');
  assert.deepEqual(result, {
    ok: false,
    unavailable: true,
    message: 'Machine enrollment is unavailable until the organization control-plane API is configured. No changes were made.',
  });
});

test('member reads are scoped to the authenticated organization', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ membership_id: 'member-1', status: 'active' }] };
    },
  };
  const response = await handleOrganizationMembers(
    client,
    { organization_id: 'org-1', user_id: 'admin-1', role: 'admin' },
    'GET',
    {},
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].values, ['org-1']);
  assert.match(calls[0].sql, /om\.organization_id = \$1/);
});

test('suspending a member suspends organization devices and advances policy atomically', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, user_id, role FROM organization_memberships')) {
        return { rows: [{ id: 'member-1', user_id: 'user-2', role: 'member' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const response = await handleOrganizationMembers(
    client,
    { organization_id: 'org-1', user_id: 'admin-1', role: 'admin' },
    'POST',
    { membership_id: '11111111-1111-4111-8111-111111111111', status: 'suspended' },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'suspended');
  assert.ok(calls.some((call) => call.sql.includes("desktop_auth_devices SET status = 'suspended'")));
  assert.ok(calls.some((call) => call.sql.includes('policy_revision = policy_revision + 1')));
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('reactivating membership requires desktop exchange before suspended devices return', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes('SELECT id, user_id, role FROM organization_memberships')) {
        return { rows: [{ id: 'member-1', user_id: 'user-2', role: 'member' }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const response = await handleOrganizationMembers(
    client,
    { organization_id: 'org-1', user_id: 'admin-1', role: 'admin' },
    'POST',
    { membership_id: '11111111-1111-4111-8111-111111111111', status: 'active' },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.device_reenrollment_required, true);
  assert.ok(calls.some((call) => call.sql.includes('UPDATE organization_memberships SET status = $1')));
  assert.ok(calls.some((call) => call.sql.includes('policy_revision = policy_revision + 1')));
  assert.ok(!calls.some((call) => call.sql.includes('UPDATE desktop_auth_devices')));
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('non-admins cannot change memberships and owner access cannot be suspended', async () => {
  const memberResult = await handleOrganizationMembers(
    { async query() { throw new Error('must not query'); } },
    { organization_id: 'org-1', user_id: 'user-1', role: 'member' },
    'POST',
    { membership_id: '11111111-1111-4111-8111-111111111111', status: 'suspended' },
  );
  assert.equal(memberResult.status, 403);

  const queries: string[] = [];
  const ownerResult = await handleOrganizationMembers(
    { async query(sql: string) {
      queries.push(sql);
      if (sql.includes('SELECT id, user_id, role FROM organization_memberships')) {
        return { rows: [{ id: 'owner-membership', user_id: 'owner-1', role: 'owner' }] };
      }
      return { rows: [] };
    } },
    { organization_id: 'org-1', user_id: 'admin-1', role: 'admin' },
    'POST',
    { membership_id: '11111111-1111-4111-8111-111111111111', status: 'suspended' },
  );
  assert.equal(ownerResult.status, 409);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('ordinary members cannot enumerate organization membership', async () => {
  const response = await handleOrganizationMembers(
    { async query() { throw new Error('must not query'); } },
    { organization_id: 'org-1', user_id: 'user-1', role: 'member' },
    'GET',
    {},
  );
  assert.equal(response.status, 403);
});

test('an administrator cannot suspend their own organization membership', async () => {
  const queries: string[] = [];
  const response = await handleOrganizationMembers(
    { async query(sql: string) {
      queries.push(sql);
      if (sql.includes('SELECT id, user_id, role FROM organization_memberships')) {
        return { rows: [{ id: 'self-membership', user_id: 'admin-1', role: 'admin' }] };
      }
      return { rows: [] };
    } },
    { organization_id: 'org-1', user_id: 'admin-1', role: 'admin' },
    'POST',
    { membership_id: '11111111-1111-4111-8111-111111111111', status: 'suspended' },
  );
  assert.equal(response.status, 409);
  assert.equal(queries.at(-1), 'ROLLBACK');
});

test('grant status denies stale policy revisions and inactive identities', async () => {
  const claims = {
    sub: 'user-1', org: 'org-1', device: 'device-1', policy_rev: 7,
    assignments: [{ machine_id: 'machine-1', model_id: 'model-1' }],
  };
  const activeRow = {
    user_status: 'active', organization_status: 'active', membership_status: 'active',
    device_status: 'active', policy_revision: 7, assignments: claims.assignments,
  };
  const active = await checkInferenceGrantStatus(
    { async query(_sql: string, values?: unknown[]) {
      assert.deepEqual(values, ['user-1', 'org-1', 'device-1']);
      return { rows: [activeRow] };
    } },
    claims,
  );
  assert.equal(active.status, 200);
  assert.equal(active.headers.get('cache-control'), 'no-store');

  const stale = await checkInferenceGrantStatus(
    { async query() { return { rows: [{ ...activeRow, policy_revision: 8 }] }; } },
    claims,
  );
  assert.equal(stale.status, 403);
  assert.equal(stale.headers.get('cache-control'), 'no-store');

  const noLongerMember = await checkInferenceGrantStatus(
    { async query() { return { rows: [{ ...activeRow, membership_status: 'suspended' }] }; } },
    claims,
  );
  assert.equal(noLongerMember.status, 403);

  const changedAssignment = await checkInferenceGrantStatus(
    { async query() { return { rows: [{ ...activeRow, assignments: [] }] }; } },
    claims,
  );
  assert.equal(changedAssignment.status, 403);
});
