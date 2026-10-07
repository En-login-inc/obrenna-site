export interface OrganizationAccess {
  organization_id: string;
  user_id: string;
  role: string;
}

interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface OrganizationMemberDb {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(message: string, status: number) {
  return Response.json({ ok: false, error: message }, { status });
}

export async function handleOrganizationMembers(
  client: OrganizationMemberDb,
  access: OrganizationAccess,
  method: string,
  body: Record<string, unknown>,
) {
  if (method === 'GET') {
    if (!['owner', 'admin'].includes(access.role)) {
      return error('Organization administrator access is required', 403);
    }
    const result = await client.query(
      `SELECT om.id AS membership_id, u.id AS user_id, u.email, u.full_name,
              om.role, om.status, om.created_at,
              COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_devices
         FROM organization_memberships om
         JOIN users u ON u.id = om.user_id
         LEFT JOIN desktop_auth_devices d
                ON d.organization_id = om.organization_id AND d.user_id = om.user_id
        WHERE om.organization_id = $1
        GROUP BY om.id, u.id
        ORDER BY om.created_at, u.email`,
      [access.organization_id],
    );
    return Response.json({ ok: true, members: result.rows });
  }
  if (method !== 'POST') return error('GET or POST is required', 405);
  if (!['owner', 'admin'].includes(access.role)) {
    return error('Organization administrator access is required', 403);
  }

  const membershipId = String(body.membership_id ?? '');
  const status = String(body.status ?? '');
  if (!uuidPattern.test(membershipId) || !['active', 'suspended'].includes(status)) {
    return error('A valid membership_id and active or suspended status are required', 400);
  }

  await client.query('BEGIN');
  try {
    const membership = await client.query<{ id: string; user_id: string; role: string }>(
      `SELECT id, user_id, role FROM organization_memberships
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [membershipId, access.organization_id],
    );
    const target = membership.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return error('Organization membership not found', 404);
    }
    if (target.role === 'owner') {
      await client.query('ROLLBACK');
      return error('Owner membership cannot be suspended or reactivated through this endpoint', 409);
    }
    if (status === 'suspended' && target.user_id === access.user_id) {
      await client.query('ROLLBACK');
      return error('Administrators cannot suspend their own membership', 409);
    }

    await client.query(
      `UPDATE organization_memberships SET status = $1, updated_at = NOW()
        WHERE id = $2 AND organization_id = $3`,
      [status, membershipId, access.organization_id],
    );
    if (status === 'suspended') {
      await client.query(
        `UPDATE desktop_auth_devices SET status = 'suspended', updated_at = NOW()
          WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
        [access.organization_id, target.user_id],
      );
    }
    await client.query(
      `UPDATE organizations SET policy_revision = policy_revision + 1, updated_at = NOW()
        WHERE id = $1`,
      [access.organization_id],
    );
    await client.query('COMMIT');
    return Response.json({
      ok: true,
      membership_id: membershipId,
      status,
      device_reenrollment_required: status === 'active',
    });
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  }
}
