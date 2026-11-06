import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.SITE_PUBLIC_ORIGIN = 'https://example.test';
process.env.INFERENCE_GRANT_KEY_ID = 'code-mode-test';
process.env.INFERENCE_GRANT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const { signInferenceGrant, verifyInferenceGrant } = await import('../src/lib/inference-grants.ts');

const base = {
  subject: 'user-1',
  organizationId: 'org-1',
  deviceId: 'device-1',
  assignments: [{ machineId: 'machine-1', modelId: 'model-1' }],
  policyRevision: 3,
};

test('a grant carries code_mode true unless the organization turned it off', async () => {
  const defaulted = await verifyInferenceGrant((await signInferenceGrant(base)).token);
  const on = await verifyInferenceGrant((await signInferenceGrant({ ...base, codeMode: true })).token);
  const off = await verifyInferenceGrant((await signInferenceGrant({ ...base, codeMode: false })).token);

  assert.equal(defaulted.code_mode, true);
  assert.equal(on.code_mode, true);
  assert.equal(off.code_mode, false);
});

test('a grant issued before the claim existed is still accepted', async () => {
  // The desktop treats a missing claim as allowed, so the website must not reject old tokens.
  const { SignJWT, importPKCS8 } = await import('jose');
  const now = Math.floor(Date.now() / 1000);
  const legacy = await new SignJWT({
    org: 'org-1', device: 'device-1', machines: ['machine-1'], models: ['model-1'],
    assignments: [{ machine_id: 'machine-1', model_id: 'model-1' }], policy_rev: 1,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'code-mode-test', typ: 'JWT' })
    .setIssuer('https://example.test').setAudience('obrenna-inference').setSubject('user-1')
    .setJti(crypto.randomUUID()).setIssuedAt(now).setExpirationTime(now + 60)
    .sign(await importPKCS8(process.env.INFERENCE_GRANT_PRIVATE_KEY!, 'RS256'));

  assert.equal((await verifyInferenceGrant(legacy)).code_mode, undefined);
});

test('a code_mode claim that is not a boolean is rejected', async () => {
  const { SignJWT, importPKCS8 } = await import('jose');
  const now = Math.floor(Date.now() / 1000);
  const bad = await new SignJWT({
    org: 'org-1', device: 'device-1', assignments: [{ machine_id: 'm', model_id: 'x' }], policy_rev: 1, code_mode: 'no',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'code-mode-test', typ: 'JWT' })
    .setIssuer('https://example.test').setAudience('obrenna-inference').setSubject('user-1')
    .setJti(crypto.randomUUID()).setIssuedAt(now).setExpirationTime(now + 60)
    .sign(await importPKCS8(process.env.INFERENCE_GRANT_PRIVATE_KEY!, 'RS256'));

  await assert.rejects(verifyInferenceGrant(bad), /incomplete or invalid/);
});

test('the setting is stored, issued with the grant, and only administrators can change it', () => {
  const routes = readFileSync(resolve(siteRoot, 'src/pages/api/auth/[...route].ts'), 'utf8');
  const migration = readFileSync(resolve(siteRoot, 'server-db/migrations/002_organization_code_mode.sql'), 'utf8');
  const start = routes.indexOf('async function handleOrganizationCodeMode');
  const handler = routes.slice(start, routes.indexOf('\nasync function ', start + 1));

  assert.match(migration, /code_mode_enabled BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.ok(routes.includes("'organization-code-mode': handleOrganizationCodeMode"));
  assert.ok(routes.includes('o.code_mode_enabled'), 'the grant query must read the setting');
  assert.ok(routes.includes('codeMode: row.code_mode_enabled !== false'), 'the grant must carry the setting');
  assert.ok(handler.includes("['owner', 'admin'].includes(access.role)"), 'changing it needs an administrator');
  assert.ok(handler.includes('policy_revision = policy_revision + 1'), 'a change must invalidate grants already issued');
  assert.ok(handler.indexOf("request.method === 'GET'") < handler.indexOf("['owner', 'admin']"), 'members may read it');
});
