import type { StatusTone } from "./machines";

export interface ToolPolicy {
  tool: string;
  server: string;
  risk: "Read" | "Write" | "Destructive" | "Network";
  confirmation: "Never" | "First use" | "Every use";
  eligibleRoles: string;
  approval: "Approved" | "Schema changed" | "Disabled";
  tone: StatusTone;
  enabled: boolean;
  schemaHash: string;
}

export interface PolicySummary {
  approvedToolCount: number;
  readCount: number;
  networkCount: number;
  writeCount: number;
  destructiveCount: number;
  appliedRevision: string;
}

// TODO(backend): Replace with a real query (e.g. GET /api/organizations/:id/tool-policies)
// reading the current signed policy configuration from the control plane. New and changed
// tools must default to enabled: false server-side — the UI must never be the source of truth
// for that default.
export async function listToolPolicies(): Promise<ToolPolicy[]> {
  return [
    { tool: "finance.lookup", server: "Finance Systems", risk: "Read", confirmation: "Never", eligibleRoles: "Members", approval: "Approved", tone: "good", enabled: true, schemaHash: "sha256:7ac2…e91f" },
    { tool: "finance.export", server: "Finance Systems", risk: "Write", confirmation: "Every use", eligibleRoles: "Admin, Finance", approval: "Approved", tone: "teal", enabled: true, schemaHash: "sha256:7ac2…e91f" },
    { tool: "linear.create_issue", server: "Linear Workspace", risk: "Write", confirmation: "Every use", eligibleRoles: "Members", approval: "Schema changed", tone: "warn", enabled: false, schemaHash: "changed" },
    { tool: "files.delete", server: "Admin Operations", risk: "Destructive", confirmation: "Every use", eligibleRoles: "Admin", approval: "Disabled", tone: "neutral", enabled: false, schemaHash: "sha256:7ac2…e91f" },
  ];
}

// TODO(backend): Replace with a real aggregate query over the current policy configuration.
export async function getPolicySummary(): Promise<PolicySummary> {
  return {
    approvedToolCount: 31,
    readCount: 18,
    networkCount: 4,
    writeCount: 8,
    destructiveCount: 1,
    appliedRevision: "v42",
  };
}

// TODO(backend): Replace with a real mutation (e.g. PATCH /api/tool-policies/:tool) that
// updates the enabled flag, re-signs the configuration revision, and pushes it to organization
// agents. A tool with a pending schema change must stay disabled until explicitly approved,
// regardless of this toggle.
export async function setToolEnabled(_tool: string, _enabled: boolean): Promise<{ ok: boolean }> {
  return { ok: true };
}

// TODO(backend): Replace with a real export (e.g. GET /api/organizations/:id/tool-policies/export)
// returning a signed, downloadable policy document (JSON or CSV) for offline review.
export async function exportPolicy(): Promise<{ ok: boolean; downloadUrl: string }> {
  return { ok: true, downloadUrl: "#" };
}
