import { authConfig } from './auth-config';
import { withAuthDb } from './auth-db';
import { getCookieValue } from './auth-helpers';

export interface PortalAccount {
  user: {
    id: string;
    email: string;
    fullName: string;
    initials: string;
  };
  organization: {
    id: string;
    name: string;
    initials: string;
    role: string;
  };
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  initials: string;
}

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatRole(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

function getSessionToken(request: Request) {
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  return cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null;
}

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const sessionToken = getSessionToken(request);
  if (!sessionToken) return null;

  return withAuthDb(async (client) => {
    const result = await client.query(
      `SELECT u.id, u.email, u.full_name
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionToken],
    );

    const user = result.rows[0];
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      initials: getInitials(user.full_name) || getInitials(user.email),
    };
  });
}

export async function getPortalAccount(request: Request): Promise<PortalAccount | null> {
  const sessionToken = getSessionToken(request);
  if (!sessionToken) return null;

  return withAuthDb(async (client) => {
    const result = await client.query(
      `SELECT u.id AS user_id, u.email, u.full_name,
              o.id AS organization_id, o.name AS organization_name, om.role
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organization_memberships om ON om.user_id = u.id AND om.status = 'active'
       JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [sessionToken],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      user: {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        initials: getInitials(row.full_name) || getInitials(row.email),
      },
      organization: {
        id: row.organization_id,
        name: row.organization_name,
        initials: getInitials(row.organization_name),
        role: formatRole(row.role),
      },
    };
  });
}