import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'auditor';
export type MembershipStatus = 'active' | 'suspended';

export interface OrganizationMember {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: OrganizationRole;
  status: MembershipStatus;
  active_devices: number;
}

/**
 * Members live in the site's canonical identity database; this endpoint is
 * the existing site-owned organization-members API.
 */
export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]> {
  if (!organizationId) throw new Error('Could not load organization members');
  const body = await readJson<{ ok: true; members: OrganizationMember[] }>(
    '/api/auth/organization-members', { method: 'GET' }, 'Could not load organization members',
  );
  return body.members.map((member) => ({
    ...member,
    role: (['owner', 'admin', 'member', 'auditor'].includes(member.role) ? member.role : 'member') as OrganizationRole,
    status: (member.status === 'suspended' ? 'suspended' : 'active') as MembershipStatus,
  }));
}

export async function setOrganizationMembershipStatus(
  organizationId: string,
  membershipId: string,
  status: MembershipStatus,
): Promise<MutationResult> {
  return mutation('/api/auth/organization-members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ organization_id: organizationId, membership_id: membershipId, status }),
  }, 'Could not update this membership');
}