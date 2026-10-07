import type { APIRoute } from 'astro';
import { PortalApiError, controlPlaneRequest } from '../../../lib/portal/control-plane-client';
import { getControlPlaneSession } from '../../../lib/portal/portal-session';
import type { ControlPlaneSession } from '../../../lib/portal/control-plane-config';

const org = (session: ControlPlaneSession) => session.organizationId;

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function guard(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof PortalApiError) {
      const status = error.kind === 'unavailable' ? 503
        : error.kind === 'unauthorized' ? 401
        : error.kind === 'forbidden' ? 403
        : error.kind === 'not_found' ? 404
        : error.kind === 'validation' ? 400
        : 502;
      return Response.json({ ok: false, error: error.message, kind: error.kind }, { status });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Portal request failed', kind: 'unavailable' },
      { status: 500 },
    );
  }
}

function readBody(request: Request): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({}));
}

function notFound(): Response {
  return jsonResponse({ ok: false, error: 'Portal route not found' }, 404);
}

const PUBLIC_INVITATION_SESSION: ControlPlaneSession = {
  // The invitation token is the capability; identity binding happens inside
  // the control plane when the invitation is resolved against a real user.
  siteUserId: 'invitation-flow',
  organizationId: 'invitation-flow',
  role: 'member',
  sessionId: 'invitation-flow',
};

const PUBLIC_ROUTES: Record<string, (input: { request: Request; url: URL }) => Promise<Response>> = {
  'invitations/public': async ({ url }) => {
    const token = url.searchParams.get('token') ?? '';
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      PUBLIC_INVITATION_SESSION,
      `/api/portal/invitations/${encodeURIComponent(token)}`,
    ).catch(() => ({ data: null }));
    if (!data) return jsonResponse({ ok: false, error: 'Invitation not found or expired' }, 404);
    return jsonResponse({ ok: true, invitation: data });
  },
  'invitations/accept': async ({ url }) => {
    const token = url.searchParams.get('token') ?? '';
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      PUBLIC_INVITATION_SESSION,
      `/api/portal/invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST' },
    );
    return jsonResponse({ ok: true, invitation: data });
  },
  'invitations/decline': async ({ url }) => {
    const token = url.searchParams.get('token') ?? '';
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      PUBLIC_INVITATION_SESSION,
      `/api/portal/invitations/${encodeURIComponent(token)}/decline`,
      { method: 'POST' },
    );
    return jsonResponse({ ok: true, invitation: data });
  },
};

const routes: Record<string, (input: {
  request: Request;
  route: string;
  url: URL;
  session: ControlPlaneSession;
}) => Promise<Response>> = {
  // --- overview ---
  'overview': async ({ session }) => {
    const { data } = await controlPlaneRequest<{ tiles: Record<string, number>; recentActivity: unknown[] }>(
      session, `/api/portal/${org(session)}/portal/overview`,
    );
    return jsonResponse({ ok: true, tiles: data.tiles, recentActivity: data.recentActivity });
  },

  // --- organization settings ---
  'settings': async ({ session }) => {
    const { data } = await controlPlaneRequest<Record<string, unknown>>(session, `/api/portal/${org(session)}/portal/settings`);
    return jsonResponse({ ok: true, organization: data });
  },
  'settings/update': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(session, `/api/portal/${org(session)}/portal/settings`, {
      method: 'PATCH', body: { display_name: body.display_name, prompt_telemetry_enabled: body.prompt_telemetry_enabled },
    });
    return jsonResponse({ ok: true, organization: data });
  },

  // --- people / members ---
  'members': async ({ session }) => {
    const { data } = await controlPlaneRequest<Array<Record<string, unknown>>>(session, `/api/portal/${org(session)}/portal/members`);
    return jsonResponse({ ok: true, members: data });
  },
  'members/update-role': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/members/${String(body.member_id)}/role`,
      { method: 'PATCH', body: { role: body.role } },
    );
    return jsonResponse({ ok: true, member: data });
  },
  'members/suspend': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/members/${String(body.member_id)}/suspend`,
      { method: 'POST', body: { suspended: Boolean(body.suspended) } },
    );
    return jsonResponse({ ok: true, member: data });
  },

  // --- invitations ---
  'invitations': async ({ session }) => {
    const { data } = await controlPlaneRequest<Array<Record<string, unknown>>>(session, `/api/portal/${org(session)}/portal/invitations`);
    return jsonResponse({ ok: true, invitations: data });
  },
  'invitations/create': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/invitations`,
      { method: 'POST', body: { email: body.email, role: body.role } },
    );
    return jsonResponse({ ok: true, invitation: data });
  },

  // --- machines ---
  'machines': async ({ session }) => {
    const { data } = await controlPlaneRequest<{ machines: unknown[]; summary: Record<string, number> }>(
      session, `/api/portal/${org(session)}/portal/machines`,
    );
    return jsonResponse({ ok: true, machines: data.machines, summary: data.summary });
  },
  'machines/enroll': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/machines/enroll`,
      { method: 'POST', body: { display_name: body.display_name ?? '' } },
    );
    return jsonResponse({ ok: true, machine: data.machine, enroll_token: data.enroll_token, expires_at: data.expires_at });
  },
  'machines/revoke': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/machines/${String(body.machine_id)}/revoke`,
      { method: 'POST' },
    );
    return jsonResponse({ ok: true, machine: data });
  },

  // --- models ---
  'models': async ({ session }) => {
    const { data } = await controlPlaneRequest<Array<Record<string, unknown>>>(session, `/api/portal/${org(session)}/portal/models`);
    return jsonResponse({ ok: true, models: data });
  },
  'models/register': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/models`,
      { method: 'POST', body: { display_name: body.display_name, base_url: body.endpoint_url, capabilities: [] } },
    );
    return jsonResponse({ ok: true, model: data });
  },

  // --- MCP servers ---
  'mcp-servers': async ({ session }) => {
    const { data } = await controlPlaneRequest<Array<Record<string, unknown>>>(session, `/api/portal/${org(session)}/portal/mcp-servers`);
    return jsonResponse({ ok: true, servers: data });
  },
  'mcp-servers/register': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/mcp-servers`,
      { method: 'POST', body: { display_name: body.name, url: body.endpoint } },
    );
    return jsonResponse({ ok: true, server: data });
  },
  'mcp-servers/discover': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/mcp-servers/${String(body.server_id)}/discover`,
      { method: 'POST' },
    );
    return jsonResponse({ ok: true, ...data });
  },
  'mcp-servers/approve-tool': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/mcp-servers/${String(body.server_id)}/tools/${encodeURIComponent(String(body.tool_name))}/approve`,
      { method: 'POST' },
    );
    return jsonResponse({ ok: true, policy: data });
  },

  // --- tool policies ---
  'tool-policies': async ({ session }) => {
    const { data } = await controlPlaneRequest<{ policies: unknown[]; summary: Record<string, unknown> }>(
      session, `/api/portal/${org(session)}/portal/tool-policies`,
    );
    return jsonResponse({ ok: true, policies: data.policies, summary: data.summary });
  },
  'tool-policies/update': async ({ request, session }) => {
    const body = await readBody(request);
    const { data } = await controlPlaneRequest<Record<string, unknown>>(
      session, `/api/portal/${org(session)}/portal/tool-policies/${String(body.policy_id)}`,
      { method: 'PATCH', body: { enabled: body.enabled } },
    );
    return jsonResponse({ ok: true, policy: data });
  },
  'tool-policies/export': async ({ session, url }) => {
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const { bytes, contentType } = await controlPlaneRequest<undefined>(
      session, `/api/portal/${org(session)}/portal/tool-policies/export?format=${format}`,
      { method: 'GET', binary: true },
    );
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="tool-policies.${format}"`, 'Cache-Control': 'no-store' },
    });
  },

  // --- audit ---
  'audit': async ({ session, url }) => {
    const cursor = url.searchParams.get('cursor');
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const { data } = await controlPlaneRequest<{ items: unknown[]; next_cursor: string | null }>(
      session, `/api/portal/${org(session)}/portal/audit-log${suffix}`,
    );
    return jsonResponse({ ok: true, events: data.items, next_cursor: data.next_cursor });
  },
  'audit/export': async ({ session }) => {
    const { bytes, contentType } = await controlPlaneRequest<undefined>(
      session, `/api/portal/${org(session)}/portal/audit-log/export`,
      { method: 'GET', binary: true },
    );
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': 'attachment; filename="audit-log.json"', 'Cache-Control': 'no-store' },
    });
  },

  // --- employee portal ---
  'employee': async ({ session }) => {
    const { data } = await controlPlaneRequest<Record<string, unknown>>(session, `/api/portal/${org(session)}/portal/employee`);
    return jsonResponse({ ok: true, ...data });
  },
};

export const GET: APIRoute = async ({ params, request }) => {
  const route = getRoute(params as Record<string, unknown> | undefined);
  const url = new URL(request.url);
  const publicHandler = PUBLIC_ROUTES[route];
  if (publicHandler) {
    return guard(() => publicHandler({ request, url }));
  }
  const session = await getControlPlaneSession(request);
  if (!session) {
    return jsonResponse({ ok: false, error: 'An active organization session is required', kind: 'unauthorized' }, 401);
  }
  const handler = GET_ONLY.has(route) ? routes[route] : READ_ROUTES[route];
  if (!handler) return notFound();
  return guard(() => handler({ request, route, url, session }));
};

export const POST: APIRoute = async ({ params, request }) => {
  const route = getRoute(params as Record<string, unknown> | undefined);
  const url = new URL(request.url);
  const publicHandler = PUBLIC_ROUTES[route];
  if (publicHandler) {
    return guard(() => publicHandler({ request, url }));
  }
  const session = await getControlPlaneSession(request);
  if (!session) {
    return jsonResponse({ ok: false, error: 'An active organization session is required', kind: 'unauthorized' }, 401);
  }
  const handler = POST_ROUTES[route];
  if (!handler) return notFound();
  return guard(() => handler({ request, route, url, session }));
};

export const PATCH: APIRoute = async ({ params, request }) => {
  const route = getRoute(params as Record<string, unknown> | undefined);
  const session = await getControlPlaneSession(request);
  if (!session) {
    return jsonResponse({ ok: false, error: 'An active organization session is required', kind: 'unauthorized' }, 401);
  }
  const handler = POST_ROUTES[route] ?? PATCH_ROUTES[route];
  if (!handler) return notFound();
  return guard(() => handler({ request, route, url: new URL(request.url), session }));
};

function getRoute(params: Record<string, unknown> | undefined) {
  const routeParam = params?.route;
  if (Array.isArray(routeParam)) return routeParam.join('/');
  return typeof routeParam === 'string' ? routeParam : '';
}

// Mutating routes: POST only.
const POST_ROUTES: Record<string, (input: {
  request: Request;
  route: string;
  url: URL;
  session: ControlPlaneSession;
}) => Promise<Response>> = {
  'settings/update': routes['settings/update'],
  'members/update-role': routes['members/update-role'],
  'members/suspend': routes['members/suspend'],
  'invitations/create': routes['invitations/create'],
  'machines/enroll': routes['machines/enroll'],
  'machines/revoke': routes['machines/revoke'],
  'models/register': routes['models/register'],
  'mcp-servers/register': routes['mcp-servers/register'],
  'mcp-servers/discover': routes['mcp-servers/discover'],
  'mcp-servers/approve-tool': routes['mcp-servers/approve-tool'],
  'tool-policies/update': routes['tool-policies/update'],
};

// PATCH-only routes.
const PATCH_ROUTES: Record<string, (input: {
  request: Request;
  route: string;
  url: URL;
  session: ControlPlaneSession;
}) => Promise<Response>> = {
  'tool-policies/update': routes['tool-policies/update'],
  'settings/update': routes['settings/update'],
};

// Download routes only valid on GET.
const GET_ONLY = new Set(['tool-policies/export', 'audit/export']);

// Read routes valid on GET.
const READ_ROUTES: Record<string, (input: {
  request: Request;
  route: string;
  url: URL;
  session: ControlPlaneSession;
}) => Promise<Response>> = {
  overview: routes.overview,
  settings: routes.settings,
  members: routes.members,
  invitations: routes.invitations,
  machines: routes.machines,
  models: routes.models,
  'mcp-servers': routes['mcp-servers'],
  'tool-policies': routes['tool-policies'],
  audit: routes.audit,
  employee: routes.employee,
  'tool-policies/export': routes['tool-policies/export'],
  'audit/export': routes['audit/export'],
};