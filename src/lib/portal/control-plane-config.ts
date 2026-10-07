import { SignJWT, importPKCS8 } from 'jose';

/** Server-only control-plane configuration. Never imported by browser code. */
export function controlPlaneConfig() {
  return {
    baseUrl: (process.env.CONTROL_PLANE_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    issuer: process.env.CONTROL_PLANE_ASSERTION_ISSUER ?? 'obrenna-site',
    keyId: process.env.CONTROL_PLANE_ASSERTION_KEY_ID ?? '',
    privateKeyPem: process.env.CONTROL_PLANE_ASSERTION_PRIVATE_KEY?.replace(/\\n/g, '\n') ?? '',
    requestTimeoutMs: Number(process.env.CONTROL_PLANE_TIMEOUT_MS ?? 10_000),
  };
}

export type ControlPlaneSession = {
  siteUserId: string;
  organizationId: string;
  role: string;
  sessionId: string;
};

const ASSERTION_AUDIENCE = 'obrenna-portal';
const ASSERTION_LIFETIME_SECONDS = 120;

/** Fails closed in production when required signing material is missing. */
export function controlPlaneConfigured(): boolean {
  const config = controlPlaneConfig();
  if (config.keyId && config.privateKeyPem) return true;
  return process.env.APP_ENV !== 'production';
}

async function signingMaterial(): Promise<{ key: CryptoKey; kid: string; issuer: string }> {
  const config = controlPlaneConfig();
  if (!config.keyId || !config.privateKeyPem) {
    throw new Error('Control-plane assertion signing is not configured');
  }
  const key = await importPKCS8(config.privateKeyPem, 'RS256');
  return { key, kid: config.keyId, issuer: config.issuer };
}

/** Mint the short-lived signed assertion binding site user/org/role claims. */
export async function signPortalAssertion(session: ControlPlaneSession): Promise<string> {
  const material = await signingMaterial();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ org: session.organizationId, role: session.role, ver: 'v1' })
    .setProtectedHeader({ alg: 'RS256', kid: material.kid, typ: 'JWT' })
    .setIssuer(material.issuer)
    .setAudience(ASSERTION_AUDIENCE)
    .setSubject(session.siteUserId)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + ASSERTION_LIFETIME_SECONDS)
    .sign(material.key);
}