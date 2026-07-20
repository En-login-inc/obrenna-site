export interface CreateOrganizationPayload {
  name: string;
  identifier: string;
  region: "Canada" | "United States" | "European Union";
  orgType: "Business" | "Education" | "Government" | "Non-profit";
}

export interface Invitation {
  organizationName: string;
  organizationInitials: string;
  invitedByName: string;
  inviteeEmail: string;
  role: "Owner" | "Admin" | "Member" | "Auditor";
  expiresAt: string;
}

// TODO(backend): Replace with a real call (e.g. POST /api/organizations) that reserves the
// identifier (must be globally unique), persists region/retention/org-type defaults, and
// provisions the initial control-plane config revision (v1) for the new organization.
export async function createOrganization(
  _payload: CreateOrganizationPayload
): Promise<{ ok: boolean; organizationId: string }> {
  return { ok: true, organizationId: "org_mock_northstar" };
}

// TODO(backend): Replace with a real lookup (e.g. GET /api/invitations/:token) resolving the
// invitation token from the URL query string against the control plane, including expiry and
// revocation checks. Currently returns fixed mock data so the invitation screen is viewable.
export async function getInvitation(_token: string): Promise<Invitation | null> {
  return {
    organizationName: "Northstar Labs",
    organizationInitials: "NL",
    invitedByName: "Priya Shah",
    inviteeEmail: "darian@northstar.ai",
    role: "Member",
    expiresAt: "2026-07-24",
  };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/invitations/:token/accept) that
// creates the membership record, assigns the invited role, and revokes the invitation token.
export async function acceptInvitation(_token: string): Promise<{ ok: boolean }> {
  return { ok: true };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/invitations/:token/decline).
export async function declineInvitation(_token: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
