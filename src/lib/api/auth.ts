export interface SignInPayload {
  email: string;
  password: string;
}

export interface SignUpPayload {
  fullName: string;
  email: string;
  password: string;
}

export interface AuthResult {
  ok: boolean;
  redirectTo: string;
}

// TODO(backend): Replace with a real session-based auth call (e.g. POST /api/auth/sign-in)
// that verifies credentials against the control-plane identity store, sets an HttpOnly
// session cookie, and returns the organization the user should land in. Currently this
// always "succeeds" and routes to the admin portal so the mock flow is walkable end to end.
export async function signIn(_payload: SignInPayload): Promise<AuthResult> {
  return { ok: true, redirectTo: "/portal/admin" };
}

// TODO(backend): Replace with a real account-creation call (e.g. POST /api/auth/sign-up)
// that validates the work email domain, enforces the password policy shown in the UI,
// creates the identity record, and either routes to org creation (no invite) or org join
// (pending invite) depending on the account's invitation state.
export async function signUp(_payload: SignUpPayload): Promise<AuthResult> {
  return { ok: true, redirectTo: "/onboarding/create-organization" };
}

// TODO(backend): Replace with a real SSO redirect (e.g. GET /api/auth/sso/start) that
// kicks off the organization's configured SAML/OIDC flow instead of navigating directly.
export async function startSsoSignIn(): Promise<AuthResult> {
  return { ok: true, redirectTo: "/portal/admin" };
}
