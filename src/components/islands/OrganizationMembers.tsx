import { useEffect, useMemo, useState } from "react";
import { FileCheck2, ShieldCheck, UserCheck, Users } from "lucide-react";
import Status from "../StatusReact";
import {
  listOrganizationMembers,
  setOrganizationMembershipStatus,
  type OrganizationMember,
  type OrganizationRole,
} from "../../lib/api/people";

const roleDetails: Record<OrganizationRole, { label: string; description: string; icon: typeof Users }> = {
  owner: { label: "Owner", description: "Full organization control.", icon: UserCheck },
  admin: { label: "Admin", description: "Infrastructure, policy and membership administration.", icon: ShieldCheck },
  member: { label: "Member", description: "Use approved models and tools through the desktop app.", icon: Users },
  auditor: { label: "Auditor", description: "Read-only access to permitted health and audit metadata.", icon: FileCheck2 },
};

function initials(member: OrganizationMember) {
  return member.full_name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase()
    || member.email.slice(0, 2).toUpperCase();
}

export default function OrganizationMembers({ organizationId }: { organizationId: string }) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMembership, setBusyMembership] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setError("");
    try {
      setMembers(await listOrganizationMembers(organizationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load organization members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [organizationId]);

  const activeRoleCounts = useMemo(() => {
    const counts: Record<OrganizationRole, number> = { owner: 0, admin: 0, member: 0, auditor: 0 };
    for (const member of members) if (member.status === "active") counts[member.role] += 1;
    return counts;
  }, [members]);

  async function toggleMembership(member: OrganizationMember) {
    const nextStatus = member.status === "active" ? "suspended" : "active";
    setBusyMembership(member.membership_id);
    setError("");
    setNotice("");
    const result = await setOrganizationMembershipStatus(organizationId, member.membership_id, nextStatus);
    if (!result.ok) {
      setError(result.message);
      setBusyMembership(null);
      return;
    }
    setNotice(nextStatus === "suspended"
      ? `${member.full_name} was suspended. Their organization desktop devices were suspended.`
      : `${member.full_name} was reactivated. They must enroll their desktop again.`);
    await reload();
    setBusyMembership(null);
  }

  return (
    <>
      <div className="people-tabs">
        <span className="people-tab-current">Members <span>{members.length}</span></span>
        <button disabled title="Invitation management requires a configured control-plane connection">Pending invitations</button>
        <button disabled title="Role editing workflow is not available yet">Roles &amp; permissions</button>
      </div>

      {(error || notice) && <p className={error ? "admin-action-error" : "admin-action-success"} role="status">{error || notice}</p>}
      {loading && <p role="status">Loading organization members…</p>}
      {!loading && !error && members.length === 0 && <p role="status">No organization members were found.</p>}

      {members.length > 0 && (
        <div className="people-table portal-card">
          <div className="table-head">
            <span>Person</span><span>Role</span><span>Organization access</span><span>Desktop devices</span><span>Account</span><span>Membership action</span><span />
          </div>
          {members.map((member) => (
            <div className="table-row people-row" key={member.membership_id}>
              <span className="person"><i>{initials(member)}</i><span><b>{member.full_name}</b><small>{member.email}</small></span></span>
              <span><em className={`role-${member.role}`}>{roleDetails[member.role].label}</em></span>
              <span>Organization-wide</span>
              <span>{Number(member.active_devices) === 0 ? "No active device" : `${member.active_devices} active`}</span>
              <span><Status tone={member.status === "suspended" ? "neutral" : "good"}>{member.status === "suspended" ? "Suspended" : "Active"}</Status></span>
              <span>
                <button
                  type="button"
                  className="membership-action"
                  disabled={member.role === "owner" || busyMembership === member.membership_id}
                  title={member.role === "owner" ? "Owner membership cannot be changed here" : undefined}
                  onClick={() => void toggleMembership(member)}
                >
                  {busyMembership === member.membership_id ? "Updating…" : member.status === "active" ? "Suspend" : "Reactivate"}
                </button>
              </span>
              <span />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && members.length > 0 && (
        <div className="role-cards">
          {(Object.keys(roleDetails) as OrganizationRole[]).map((role) => {
            const detail = roleDetails[role];
            const Icon = detail.icon;
            return (
              <article key={role}>
                <Icon size={20} aria-hidden="true" />
                <span><b>{detail.label}</b><small>{detail.description}</small></span>
                <strong>{activeRoleCounts[role]} active</strong>
              </article>
            );
          })}
        </div>
      )}
      <p className="membership-help">Suspending a member disables their organization desktop devices. After reactivation, the desktop must sign in again to enroll.</p>
    </>
  );
}
