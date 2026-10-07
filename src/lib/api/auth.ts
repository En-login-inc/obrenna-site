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

function getDesktopCallback(): string | null {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return params.get('desktop_callback');
}

async function buildDesktopCallbackUrl(): Promise<string> {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const desktopCallback = params.get('desktop_callback');
  const challenge = params.get('code_challenge');
  const state = params.get('state');
  if (desktopCallback !== 'obrenna://auth' || params.get('code_challenge_method') !== 'S256' || !challenge || !state) {
    throw new Error('The desktop sign-in request is missing PKCE authorization parameters');
  }
  const response = await fetch('/api/auth/desktop-authorize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ desktop_callback: desktopCallback, code_challenge: challenge, state }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || typeof data.callback_url !== 'string') {
    throw new Error(data.error || 'Could not start secure desktop sign-in');
  }
  return data.callback_url;
}

export function getDesktopContinuationQuery(desktopCallback: string): string {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const next = new URLSearchParams({ desktop_callback: desktopCallback });
  for (const key of ['state', 'code_challenge', 'code_challenge_method']) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}

export function getDesktopCallbackEndpointUrl(desktopCallback: string): string {
  return `/api/auth/desktop-callback?${getDesktopContinuationQuery(desktopCallback)}`;
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
    }

    const desktopCallback = getDesktopCallback();
    const redirectTo = desktopCallback
      ? await buildDesktopCallbackUrl()
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
    }

    const desktopCallback = getDesktopCallback();
    const redirectTo = desktopCallback
      ? `/onboarding/create-organization?${getDesktopContinuationQuery(desktopCallback)}`
      : getRedirectAfterAuth();

    return { ok: true, redirectTo, isDesktopRedirect: false };
  } catch (error) {
    return { ok: false, redirectTo: '', error: String(error) };
  }
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
