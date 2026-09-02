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
  /** True when redirectTo is a desktop-app deep link (e.g. `obrenna://auth?...`). */
  isDesktopRedirect?: boolean;
  error?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  status: string;
}

export interface AuthSession {
  id: string;
  expires_at: string;
}

interface AuthResponseData {
  user: { id: string; email: string; full_name: string; status: string };
  session: { id: string; token: string; expires_at: string; billing_status?: string };
  organization?: { id: string; name: string; role: string; billingStatus: string };
}

function getDesktopCallback(): string | null {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return params.get('desktop_callback');
}

/**
 * Build the `obrenna://auth?token=...` deep-link URL the desktop app expects,
 * using the session token from the just-completed sign-in/sign-up response
 * (the raw token never leaves the server otherwise -- it's stored HttpOnly).
 */
function buildDesktopCallbackUrl(desktopCallback: string, data: AuthResponseData): string {
  const url = new URL(desktopCallback);
  url.searchParams.set('token', data.session.token);
  url.searchParams.set('expires_at', data.session.expires_at);
  url.searchParams.set('user_id', data.user.id);
  url.searchParams.set('email', data.user.email);
  url.searchParams.set('org_id', data.organization?.id ?? '');
  url.searchParams.set('org_name', data.organization?.name ?? '');
  url.searchParams.set('billing_status', data.organization?.billingStatus ?? data.session.billing_status ?? 'trialing');
  return url.toString();
}

/**
 * Determine the post-auth redirect URL for the normal web flow.
 * (Desktop-callback redirects are handled separately via buildDesktopCallbackUrl.)
 */
function getRedirectAfterAuth(hasOrganization = false): string {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const returnTo = params.get('returnTo');

  if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
    return returnTo;
  }

  return hasOrganization ? '/portal/admin' : '/onboarding/create-organization';
}

export async function signIn(payload: SignInPayload): Promise<AuthResult> {
  try {
    const response = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      return { ok: false, redirectTo: '', error: error.error || 'Sign in failed' };
    }

    const data = await response.json();
    if (!data.ok) {
      return { ok: false, redirectTo: '', error: data.error || 'Sign in failed' };
    }

    // Store user context for the UI
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('auth_user', JSON.stringify(data.user));
      sessionStorage.setItem('auth_session', JSON.stringify(data.session));
    }

    const desktopCallback = getDesktopCallback();
    const redirectTo = desktopCallback
      ? buildDesktopCallbackUrl(desktopCallback, data)
      : getRedirectAfterAuth(Boolean(data.organization));

    return { ok: true, redirectTo, isDesktopRedirect: Boolean(desktopCallback) };
  } catch (error) {
    return { ok: false, redirectTo: '', error: String(error) };
  }
}

export async function signUp(payload: SignUpPayload): Promise<AuthResult> {
  try {
    const response = await fetch('/api/auth/sign-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email: payload.email,
        name: payload.fullName,
        password: payload.password,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      return { ok: false, redirectTo: '', error: error.error || 'Sign up failed' };
    }

    const data = await response.json();
    if (!data.ok) {
      return { ok: false, redirectTo: '', error: data.error || 'Sign up failed' };
    }

    // Store user context for the UI
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('auth_user', JSON.stringify(data.user));
      sessionStorage.setItem('auth_session', JSON.stringify(data.session));
    }

    const desktopCallback = getDesktopCallback();
    const redirectTo = desktopCallback
      ? buildDesktopCallbackUrl(desktopCallback, data)
      : getRedirectAfterAuth();

    return { ok: true, redirectTo, isDesktopRedirect: Boolean(desktopCallback) };
  } catch (error) {
    return { ok: false, redirectTo: '', error: String(error) };
  }
}

export async function startSsoSignIn(): Promise<AuthResult> {
  // Placeholder for SAML/OIDC flow
  return { ok: false, redirectTo: '', error: 'SSO not yet implemented' };
}

/**
 * Navigate to the post-auth destination. The desktop handoff leaves the
 * browser window available for the user to close manually.
 */
export function completeAuthRedirect(result: AuthResult): void {
  if (typeof window === 'undefined' || !result.ok) return;
  window.location.href = result.redirectTo;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.ok ? data.user : null;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<boolean> {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
    });

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('auth_user');
      sessionStorage.removeItem('auth_session');
    }

    return true;
  } catch {
    return false;
  }
}
