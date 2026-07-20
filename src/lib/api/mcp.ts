import type { StatusTone } from "./machines";

export interface McpServer {
  name: string;
  transport: "Streamable HTTP" | "Local stdio";
  endpoint: string;
  toolsSummary: string;
  visibility: "Organization members" | "Admin only";
  status: "Healthy" | "Review required";
  tone: StatusTone;
  lastDiscoveryAgo: string;
}

// TODO(backend): Replace with a real query (e.g. GET /api/organizations/:id/mcp-servers) reading
// registered MCP server connections, their transport config, and discovered tool counts from the
// control plane, including which servers have pending schema-change reviews.
export async function listMcpServers(): Promise<McpServer[]> {
  return [
    { name: "Finance Systems", transport: "Streamable HTTP", endpoint: "finance.internal/mcp", toolsSummary: "12 tools", visibility: "Organization members", status: "Healthy", tone: "good", lastDiscoveryAgo: "5 min ago" },
    { name: "Linear Workspace", transport: "Streamable HTTP", endpoint: "linear.internal/mcp", toolsSummary: "8 tools · 1 changed", visibility: "Organization members", status: "Review required", tone: "warn", lastDiscoveryAgo: "18 min ago" },
    { name: "Knowledge Index", transport: "Local stdio", endpoint: "knowledge-mcp", toolsSummary: "7 tools", visibility: "Organization members", status: "Healthy", tone: "good", lastDiscoveryAgo: "5 min ago" },
    { name: "Admin Operations", transport: "Local stdio", endpoint: "ops-mcp", toolsSummary: "4 tools", visibility: "Admin only", status: "Healthy", tone: "good", lastDiscoveryAgo: "5 min ago" },
  ];
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/organizations/:id/mcp-servers)
// that registers a new server, performs an initial tool-schema discovery pass, and leaves all
// discovered tools disabled by default until an admin approves them (see policies.ts).
export async function addMcpServer(_input: {
  name: string;
  transport: "Streamable HTTP" | "Local stdio";
  endpoint: string;
}): Promise<{ ok: boolean }> {
  return { ok: true };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/mcp-servers/:id/discover) that
// re-runs tool discovery against the live server and flags any schema diffs for review.
export async function discoverTools(_serverId: string): Promise<{ ok: boolean; changedToolCount: number }> {
  return { ok: true, changedToolCount: 0 };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/mcp-servers/:id/tools/:tool/approve)
// that approves a detected schema change and re-enables the affected tool under current policy.
export async function approveSchemaChange(_serverId: string, _toolName: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
