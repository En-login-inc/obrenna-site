import { authConfig } from '../auth-config';
import { withAuthDb } from '../auth-db';
import { getCookieValue, getBearerToken } from '../auth-helpers';
import { controlPlaneConfigured } from './control-plane-config';
import type { ControlPlaneSession } from './control-plane-config';

const ALLOWED_ROLES = new Set(['owner', 'admin', 'member', 'auditor']);

/**
 * Resolve the canonical website session into a control-plane session:
 * active session, active user, active organization, active membership.
 * Returns null when any link is missing — callers must fail closed.
 */
export async function getControlPlaneSession(request: Request): Promise<ControlPlaneSession | null> {
  if (!controlPlaneConfigured()) return null;
  const bearer = getBearerToken(request.headers.get('authorization'));
  const cookie = getCookieValue(request.headers.get('cookie'), authConfig.cookieName);
  const sessionToken = bearer || (cookie?.startsWith('session:') ? cookie.slice('session:'.length) : null);
  if (!sessionToken) return null;

  return withAuthDb(async (client) => {
    const result = await client.query(
      `SELECT s.id AS session_id, u.id AS user_id, o.id AS organization_id, om.role
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id AND u.status = 'active'
        JOIN organization_memberships om ON om.user_id = u.id AND om.status = 'active'
        JOIN organizations o ON o.id = om.organization_id AND o.status = 'active'
       WHERE s.session_token = $1 AND s.status = 'active' AND s.expires_at > NOW()
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [sessionToken],
    );
    const row = result.rows[0];
    if (!row) return null;
    const role = String(row.role).toLowerCase();
    if (!ALLOWED_ROLES.has(role)) return null;
    return {
      siteUserId: String(row.user_id),
      organizationId: String(row.organization_id),
      role,
      sessionId: String(row.session_id),
    };
  });
}