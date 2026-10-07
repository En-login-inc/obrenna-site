import { readError, readJson } from './portal-client';
import type { MutationResult } from './mutation-result';

export interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  /** Only set on creation (site builds the URL from the site origin). */
  token?: string;
}

export async function createOrganization(input: {
  name: string;
  identifier: string;
  region: string;
  orgType: string;
}): Promise<MutationResult> {
  try {
    const response = await fetch('/api/auth/organizations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: input.name, identifier: input.identifier, region: input.region, orgType: input.orgType }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, message: typeof body.error === 'string' ? body.error : 'Could not create this organization' };
    }
    return { ok: true, data: body.organization };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not create this organization' };
  }
}

export async function listInvitations(): Promise<InvitationRow[]> {
  const body = await readJson<{ ok: true; invitations: InvitationRow[] }>('/api/portal/invitations', { method: 'GET' }, 'Could not load invitations');
  return body.invitations;
}

export async function createInvitation(input: { email: string; role: string }): Promise<MutationResult> {
  try {
    const response = await fetch('/api/portal/invitations/create', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, message: typeof body.error === 'string' ? body.error : 'Could not create this invitation' };
    }
    return { ok: true, data: body.invitation };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not create this invitation' };
  }
}

/** Public (unauthenticated) invitation lookup for the onboarding page. */
export interface InvitationPublic {
  organizationName: string;
  organizationInitials: string;
  invitedByName: string;
  inviteeEmail: string;
  role: string;
  expiresAt: string;
}

export async function getInvitation(token: string): Promise<InvitationPublic | null> {
  if (!token) return null;
  try {
    const body = await readJson<{ ok: true; invitation: Record<string, unknown> }>(
      `/api/portal/invitations/${encodeURIComponent(token)}`, { method: 'GET' }, 'Invitation not found',
    );
    const invitation = body.invitation;
    return {
      organizationName: String(invitation.organization_name ?? 'Your organization'),
      organizationInitials: String(invitation.organization_initials ?? 'OB'),
      invitedByName: String(invitation.invited_by_name ?? 'An administrator'),
      inviteeEmail: String(invitation.email ?? ''),
      role: String(invitation.role ?? 'member'),
      expiresAt: String(invitation.expires_at ?? ''),
    };
  } catch {
    return null;
  }
}

export async function acceptInvitation(token: string): Promise<MutationResult> {
  return invitationAction(`/api/portal/invitations/${encodeURIComponent(token)}/accept`, 'Could not accept this invitation');
}

export async function declineInvitation(token: string): Promise<MutationResult> {
  return invitationAction(`/api/portal/invitations/${encodeURIComponent(token)}/decline`, 'Could not decline this invitation');
}

async function invitationAction(url: string, fallback: string): Promise<MutationResult> {
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, message: typeof body.error === 'string' ? body.error : fallback };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : fallback };
  }
}

export { readError };