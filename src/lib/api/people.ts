export interface Person {
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Member" | "Auditor";
  access: string;
  lastActivity: string;
  deviceStatus: string;
  accountStatus: "Active" | "Suspended";
  initials: string;
}

export interface RoleSummary {
  role: "Owner" | "Admin" | "Member" | "Auditor";
  description: string;
  memberCount: number;
}

// TODO(backend): Replace with a real query (e.g. GET /api/organizations/:id/members) reading
// the membership table, joined with last-seen and device-session state.
export async function listPeople(): Promise<Person[]> {
  return [
    { name: "Darian J.", email: "darian@northstar.ai", role: "Owner", access: "All environments", lastActivity: "Now", deviceStatus: "2 active", accountStatus: "Active", initials: "DJ" },
    { name: "Priya Shah", email: "priya@northstar.ai", role: "Admin", access: "All environments", lastActivity: "12 min ago", deviceStatus: "1 active", accountStatus: "Active", initials: "PS" },
    { name: "Noah Williams", email: "noah@northstar.ai", role: "Member", access: "Production", lastActivity: "2 hours ago", deviceStatus: "1 active", accountStatus: "Active", initials: "NW" },
    { name: "Maya Chen", email: "maya@northstar.ai", role: "Auditor", access: "Audit metadata only", lastActivity: "Yesterday", deviceStatus: "No desktop", accountStatus: "Active", initials: "MC" },
    { name: "Jon Bell", email: "jon@northstar.ai", role: "Member", access: "Production", lastActivity: "18 days ago", deviceStatus: "Session expired", accountStatus: "Suspended", initials: "JB" },
  ];
}

// TODO(backend): Replace with a real query alongside listPeople(), computed from the same
// membership table grouped by role.
export async function listRoleSummaries(): Promise<RoleSummary[]> {
  return [
    { role: "Owner", description: "Full organization control, including ownership transfer and deletion.", memberCount: 1 },
    { role: "Admin", description: "Infrastructure, policy and membership administration.", memberCount: 4 },
    { role: "Member", description: "Use approved models and tools through the desktop app.", memberCount: 40 },
    { role: "Auditor", description: "Read-only access to permitted health and audit metadata.", memberCount: 2 },
  ];
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/organizations/:id/invitations)
// that creates a pending invitation record and sends the invite email.
export async function invitePerson(_input: { email: string; role: Person["role"] }): Promise<{ ok: boolean }> {
  return { ok: true };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/members/:id/suspend) that revokes
// active sessions and blocks sign-in without deleting the membership record.
export async function suspendPerson(_email: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
