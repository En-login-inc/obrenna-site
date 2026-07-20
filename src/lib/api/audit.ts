import type { StatusTone } from "./machines";

export interface AuditEvent {
  time: string;
  date: string;
  decision: "Approved" | "Denied" | "Schema change" | "Revoked";
  tool: string;
  actor: string;
  reason: string;
  server: string;
  schemaHash: string;
  tone: StatusTone;
}

// TODO(backend): Replace with a real paginated query (e.g. GET /api/organizations/:id/audit-log)
// reading redacted policy-decision and lifecycle events from the control plane. This log must
// never include prompt text, file contents, tool arguments or tool results — only decision
// metadata, per the privacy model described on /privacy.
export async function listAuditEvents(): Promise<{ events: AuditEvent[]; totalCount: number }> {
  return {
    totalCount: 1284,
    events: [
      { time: "14:42:08", date: "Jul 17", decision: "Approved", tool: "finance.export", actor: "Priya Shah", reason: "Every-use confirmation", server: "Finance Systems", schemaHash: "sha256:8bd1…421a", tone: "good" },
      { time: "14:38:51", date: "Jul 17", decision: "Denied", tool: "files.delete", actor: "Noah Williams", reason: "User denied confirmation", server: "Admin Operations", schemaHash: "sha256:2ac9…901c", tone: "bad" },
      { time: "14:21:17", date: "Jul 17", decision: "Schema change", tool: "linear.create_issue", actor: "System", reason: "Tool disabled pending review", server: "Linear Workspace", schemaHash: "sha256:NEW…4f1d", tone: "warn" },
      { time: "13:54:03", date: "Jul 17", decision: "Approved", tool: "finance.lookup", actor: "Darian J.", reason: "Policy: confirmation never", server: "Finance Systems", schemaHash: "sha256:7ac2…e91f", tone: "good" },
      { time: "13:09:44", date: "Jul 17", decision: "Revoked", tool: "knowledge.search", actor: "Maya Chen", reason: "First-use approval revoked", server: "Knowledge Index", schemaHash: "sha256:be14…009c", tone: "neutral" },
    ],
  };
}

// TODO(backend): Replace with a real export (e.g. GET /api/organizations/:id/audit-log/export)
// returning a downloadable, redacted metadata export honoring the organization's retention window.
export async function exportAuditMetadata(): Promise<{ ok: boolean; downloadUrl: string }> {
  return { ok: true, downloadUrl: "#" };
}
