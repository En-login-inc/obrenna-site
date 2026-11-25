export const authConfig = {
  appName: 'Obrenna',
  cookieName: 'obrenna_auth',
  sessionTtlDays: Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30),
  authDbUrl: process.env.AUTH_DB_URL ?? 'postgresql://obrenna:obrenna@localhost:5432/obrenna-server-db',
  localDbUrl: process.env.LOCAL_DB_URL ?? 'sqlite:///./data/obrenna_local.db',
  allowBillingOnlySync: process.env.ALLOW_BILLING_ONLY_SYNC === 'true',
};

export const authEnvSchema = {
  APP_ENV: process.env.APP_ENV ?? 'development',
  AUTH_DB_URL: authConfig.authDbUrl,
  LOCAL_DB_URL: authConfig.localDbUrl,
  SITE_API_BASE_URL: process.env.SITE_API_BASE_URL ?? 'http://localhost:4321',
};

export type AuthSessionClaims = {
  sub: string;
  orgId?: string;
  role?: string;
  exp: number;
  iat: number;
};

export function getAuthSessionTtlMs() {
  return authConfig.sessionTtlDays * 24 * 60 * 60 * 1000;
}

export const authRuntime = {
  isLocalMode: authEnvSchema.APP_ENV !== 'production',
};

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
};

export function oidcConfig(): OidcConfig | null {
  const issuer = process.env.OIDC_ISSUER?.trim().replace(/\/$/, '');
  const clientId = process.env.OIDC_CLIENT_ID?.trim();
  if (!issuer || !clientId) return null;
  if (new URL(issuer).protocol !== 'https:' && process.env.APP_ENV === 'production') {
    throw new Error('OIDC_ISSUER must use HTTPS in production');
  }
  return {
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    scopes: process.env.OIDC_SCOPES?.trim() || 'openid profile email',
  };
}
