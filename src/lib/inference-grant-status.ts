export interface GrantStatusClaims {
  sub: string;
  org: string;
  device: string;
  policy_rev: number;
  assignments: Array<{ machine_id: string; model_id: string }>;
}

interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
}

export interface GrantStatusDb {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export async function checkInferenceGrantStatus(client: GrantStatusDb, claims: GrantStatusClaims) {
  const result = await client.query<{
    user_status: string;
    organization_status: string;
    membership_status: string;
    device_status: string;
    policy_revision: number | string;
    assignments: Array<{ machine_id: string; model_id: string }>;
  }>(
    `SELECT u.status AS user_status, o.status AS organization_status,
            om.status AS membership_status, d.status AS device_status,
            o.policy_revision,
            COALESCE(json_agg(json_build_object('machine_id', ma.machine_id,
                                               'model_id', ma.model_id))
                     FILTER (WHERE ma.machine_id IS NOT NULL), '[]'::json) AS assignments
       FROM users u
       JOIN organization_memberships om ON om.user_id = u.id AND om.organization_id = $2
       JOIN organizations o ON o.id = om.organization_id
       JOIN desktop_auth_devices d ON d.user_id = u.id AND d.organization_id = o.id AND d.id = $3
       LEFT JOIN organization_inference_machines im
              ON im.organization_id = o.id AND im.status = 'active'
       LEFT JOIN organization_model_access ma
              ON ma.organization_id = o.id AND ma.machine_id = im.id AND ma.status = 'active'
      WHERE u.id = $1
      GROUP BY u.status, o.status, om.status, d.status, o.policy_revision`,
    [claims.sub, claims.org, claims.device],
  );
  const row = result.rows[0];
  const active = Boolean(row)
    && row.user_status === 'active'
    && row.organization_status === 'active'
    && row.membership_status === 'active'
    && row.device_status === 'active'
    && Number(row.policy_revision) === claims.policy_rev
    && JSON.stringify(sortAssignments(row.assignments)) === JSON.stringify(sortAssignments(claims.assignments));

  return active
    ? Response.json({ ok: true, status: 'active' }, { headers: { 'Cache-Control': 'no-store' } })
    : Response.json({ ok: false, status: 'revoked' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
}

function sortAssignments(assignments: Array<{ machine_id: string; model_id: string }>) {
  return [...assignments].sort((left, right) =>
    `${left.machine_id}:${left.model_id}`.localeCompare(`${right.machine_id}:${right.model_id}`),
  );
}
