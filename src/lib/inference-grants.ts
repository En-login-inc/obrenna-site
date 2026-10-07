import { createPublicKey, type KeyObject } from 'node:crypto';
import { decodeProtectedHeader, exportJWK, importJWK, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';

const grantAudience = 'obrenna-inference';
const grantLifetimeSeconds = 24 * 60 * 60;

function signingConfiguration() {
  const issuer = process.env.SITE_PUBLIC_ORIGIN?.trim().replace(/\/$/, '');
  const kid = process.env.INFERENCE_GRANT_KEY_ID?.trim();
  const pem = process.env.INFERENCE_GRANT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!issuer || !kid || !pem) {
    throw new Error('SITE_PUBLIC_ORIGIN, INFERENCE_GRANT_KEY_ID, and INFERENCE_GRANT_PRIVATE_KEY must be configured');
  }
  if (new URL(issuer).protocol !== 'https:' && process.env.APP_ENV === 'production') {
    throw new Error('SITE_PUBLIC_ORIGIN must use HTTPS in production');
  }
  return { issuer, kid, pem };
}

type PreviousPublicKey = { kid: string; kty: 'RSA'; n: string; e: string };

function previousPublicKeys(): PreviousPublicKey[] {
  const serialized = process.env.INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS?.trim();
  if (!serialized) return [];
  if (serialized.length > 64 * 1024) throw new Error('Previous inference grant keys exceed the configured size limit');
  let decoded: unknown;
  try {
    decoded = JSON.parse(serialized);
  } catch {
    throw new Error('INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS must be a JSON array of public RSA JWKs');
  }
  if (!Array.isArray(decoded) || decoded.length > 16) {
    throw new Error('INFERENCE_GRANT_PREVIOUS_PUBLIC_KEYS must contain at most 16 public RSA JWKs');
  }
  const seen = new Set<string>();
  return decoded.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Malformed previous inference grant public key');
    const item = value as Record<string, unknown>;
    if (item.kty !== 'RSA' || typeof item.kid !== 'string' || !item.kid.trim() || item.kid.length > 128
        || typeof item.n !== 'string' || !item.n || typeof item.e !== 'string' || !item.e
        || seen.has(item.kid)) {
      throw new Error('Malformed or duplicate previous inference grant public key');
    }
    seen.add(item.kid);
    return { kid: item.kid, kty: 'RSA', n: item.n, e: item.e };
  });
}

async function publicJwk(key: KeyObject | CryptoKey, kid: string) {
  const jwk = await exportJWK(key);
  return { ...jwk, kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] };
}

export async function signInferenceGrant(input: {
  subject: string;
  organizationId: string;
  deviceId: string;
  assignments: Array<{ machineId: string; modelId: string }>;
  policyRevision: number;
}) {
  const config = signingConfiguration();
  const key = await importPKCS8(config.pem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assignments = input.assignments.map((item) => ({ machine_id: item.machineId, model_id: item.modelId }));
  const machines = [...new Set(assignments.map((item) => item.machine_id))];
  const models = [...new Set(assignments.map((item) => item.model_id))];
  const token = await new SignJWT({
    org: input.organizationId,
    device: input.deviceId,
    machines,
    models,
    assignments,
    policy_rev: input.policyRevision,
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.kid, typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(grantAudience)
    .setSubject(input.subject)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + grantLifetimeSeconds)
    .sign(key);

  return { token, expiresAt: new Date((now + grantLifetimeSeconds) * 1000).toISOString() };
}

export async function verifyInferenceGrant(token: string) {
  const config = signingConfiguration();
  const header = decodeProtectedHeader(token);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported inference grant signing key');
  let key: CryptoKey;
  if (header.kid === config.kid) {
    const publicPem = createPublicKey(config.pem).export({ type: 'spki', format: 'pem' }).toString();
    key = await importSPKI(publicPem, 'RS256');
  } else {
    const previous = previousPublicKeys().find((item) => item.kid === header.kid);
    if (!previous) throw new Error('Unknown inference grant signing key');
    key = await importJWK({ kty: previous.kty, n: previous.n, e: previous.e, alg: 'RS256', use: 'sig' }, 'RS256') as CryptoKey;
  }
  const { payload } = await jwtVerify(token, key, {
    issuer: config.issuer,
    audience: grantAudience,
    algorithms: ['RS256'],
  });
  if (!payload.sub || !payload.jti || !payload.org || !payload.device
      || typeof payload.policy_rev !== 'number' || !Number.isSafeInteger(payload.policy_rev)
      || !Array.isArray(payload.assignments) || payload.assignments.length === 0
      || typeof payload.exp !== 'number' || typeof payload.iat !== 'number'
      || payload.exp - payload.iat > grantLifetimeSeconds) {
    throw new Error('Inference grant claims are incomplete or invalid');
  }
  return payload;
}

export async function publicGrantJwks() {
  const config = signingConfiguration();
  const publicKey = createPublicKey(config.pem);
  const active = await publicJwk(publicKey, config.kid);
  const previous = await Promise.all(previousPublicKeys().map(async (item) => {
    const imported = await importJWK({ kty: item.kty, n: item.n, e: item.e, alg: 'RS256', use: 'sig' }, 'RS256');
    const jwk = await publicJwk(imported as CryptoKey, item.kid);
    return jwk;
  }));
  if (previous.some((item) => item.kid === config.kid)) throw new Error('Active inference grant key id duplicates a previous key');
  return {
    keys: [active, ...previous],
  };
}
