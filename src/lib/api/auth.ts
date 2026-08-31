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

/**
 * Determine the post-auth redirect URL.
 * If called from desktop app (via ?desktop_callback=...), return to the desktop.
 * Otherwise, redirect to org creation or portal depending on org enrollment.
 */
function getRedirectAfterAuth(hasOrganization = false): string {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const desktopCallback = params.get('desktop_callback');
  const returnTo = params.get('returnTo');

  if (desktopCallback) {
    return desktopCallback;
  }

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

    return { ok: true, redirectTo: getRedirectAfterAuth(Boolean(data.organization)) };
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

    return { ok: true, redirectTo: getRedirectAfterAuth() };
  } catch (error) {
    return { ok: false, redirectTo: '', error: String(error) };
  }
}

export async function startSsoSignIn(): Promise<AuthResult> {
  // Placeholder for SAML/OIDC flow
  return { ok: false, redirectTo: '', error: 'SSO not yet implemented' };
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
