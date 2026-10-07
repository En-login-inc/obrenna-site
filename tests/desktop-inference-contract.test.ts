import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = process.env.OBRENNA_SHARED_CONTRACT
  ?? [resolve(siteRoot, 'GrebGlob/shared/desktop-inference-auth-contract.json'),
      resolve(siteRoot, '../GrebGlob/shared/desktop-inference-auth-contract.json')]
    .find(existsSync);

test('versioned desktop inference auth contract stays aligned across website, desktop, and gateway', {
  skip: !sharedPath && process.env.CI !== 'true',
}, () => {
  assert.ok(sharedPath, 'CI must provide OBRENNA_SHARED_CONTRACT from the desktop repository');
  const contract = JSON.parse(readFileSync(sharedPath, 'utf8'));
  assert.equal(contract.contract_id, 'obrenna.desktop-inference-auth');
  assert.equal(contract.version, 1);
  assert.equal(contract.inference_audience, 'obrenna-inference');
  assert.equal(contract.max_grant_lifetime_seconds, 86_400);

  const authRoutes = readFileSync(resolve(siteRoot, 'src/pages/api/auth/[...route].ts'), 'utf8');
  const jwksRoute = resolve(siteRoot, 'src/pages/.well-known/jwks.json.ts');
  assert.ok(existsSync(jwksRoute), 'website must publish the contract JWKS route');
  const jwksSource = readFileSync(jwksRoute, 'utf8');
  const desktopRoot = resolve(siteRoot, 'GrebGlob');
  const localDesktopRoot = resolve(siteRoot, '../GrebGlob');
  const root = existsSync(resolve(desktopRoot, 'src-tauri/src/site_auth.rs')) ? desktopRoot : localDesktopRoot;
  const desktopAuth = readFileSync(resolve(root, 'src-tauri/src/site_auth.rs'), 'utf8');
  const websiteClients = [
    readFileSync(resolve(siteRoot, 'src/lib/api/auth.ts'), 'utf8'),
    readFileSync(resolve(siteRoot, 'src/lib/api/machines.ts'), 'utf8'),
  ].join('\n');
  const grantSigner = readFileSync(resolve(siteRoot, 'src/lib/inference-grants.ts'), 'utf8');
  const gateway = readFileSync(resolve(root, 'inference_gateway/app.py'), 'utf8');

  for (const endpoint of contract.endpoints) {
    if (endpoint.path.startsWith('/api/auth/')) {
      const routeName = endpoint.path.slice('/api/auth/'.length);
      assert.ok(authRoutes.includes(`'${routeName}':`) || authRoutes.includes(`"${routeName}":`),
        `website route map must serve ${endpoint.method} ${endpoint.path}`);
      assert.ok(authRoutes.includes(`export const ${endpoint.method}: APIRoute`),
        `website API route must export ${endpoint.method} for ${endpoint.path}`);
      if (endpoint.name === 'inference_grant_status') {
        const handlerStart = authRoutes.indexOf('async function handleInferenceGrantStatus');
        const handlerEnd = authRoutes.indexOf('\nasync function ', handlerStart + 1);
        assert.ok(handlerStart >= 0 && handlerEnd > handlerStart,
          'website must have a dedicated inference grant status handler');
        const handler = authRoutes.slice(handlerStart, handlerEnd);
        assert.ok(handler.includes(`request.method !== '${endpoint.method}'`),
          `website grant status handler must enforce ${endpoint.method}`);
      }
    } else if (endpoint.path === '/.well-known/jwks.json') {
      assert.ok(jwksSource.includes(`export const ${endpoint.method}: APIRoute`),
        `JWKS route must export ${endpoint.method}`);
    }
    for (const field of [...endpoint.request_required, ...endpoint.response_required]) {
      assert.ok(`${authRoutes}\n${jwksSource}\n${websiteClients}\n${desktopAuth}`.includes(field),
        `${endpoint.path} field ${field} must remain represented by an implementation`);
    }
  }

  for (const path of ['/api/auth/desktop-exchange', '/api/auth/inference-grant', '/api/auth/inference-grant-status']) {
    assert.ok(desktopAuth.includes(path), `desktop client must use ${path}`);
  }
  assert.ok(websiteClients.includes('/api/auth/desktop-authorize'));
  assert.ok(websiteClients.includes('/api/auth/inference-machines/revoke'));

  for (const claim of contract.grant_claims) {
    assert.ok(grantSigner.includes(claim) || gateway.includes(claim),
      `website signer or gateway verifier must consume grant claim ${claim}`);
  }
  assert.ok(grantSigner.includes('obrenna-inference'));
  assert.ok(gateway.includes('86400'), 'gateway must enforce the contract 24-hour grant maximum');
});
