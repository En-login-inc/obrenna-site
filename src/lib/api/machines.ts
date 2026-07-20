export type StatusTone = "good" | "warn" | "bad" | "neutral" | "teal";

export interface Machine {
  name: string;
  environment: "Production" | "Staging" | "Development";
  os: string;
  hardware: string;
  services: string;
  lastHeartbeat: string;
  status: "Online" | "Updating" | "Offline";
  tone: StatusTone;
}

export interface MachineSummary {
  onlineCount: number;
  totalCount: number;
  combinedAcceleratorMemoryGb: number;
  averageGpuUtilizationPct: number;
  averageHeartbeatMs: number;
  appliedConfigVersion: string;
}

// TODO(backend): Replace with a real fleet query (e.g. GET /api/organizations/:id/machines)
// against the control plane's machine-enrollment table, joined with the latest heartbeat
// and service-count rollups reported by each organization agent.
export async function listMachines(): Promise<Machine[]> {
  return [
    { name: "AI-NODE-01", environment: "Production", os: "Ubuntu 24.04", hardware: "2× RTX 4090 · 128 GB", services: "6 models · 5 MCP", lastHeartbeat: "Just now", status: "Online", tone: "good" },
    { name: "AI-NODE-02", environment: "Production", os: "RHEL 10", hardware: "RTX 6000 Ada · 96 GB", services: "3 models · 3 MCP", lastHeartbeat: "8 sec ago", status: "Online", tone: "good" },
    { name: "AI-STAGE-01", environment: "Staging", os: "Ubuntu 24.04", hardware: "RTX 3090 · 64 GB", services: "2 models · 4 MCP", lastHeartbeat: "2 min ago", status: "Updating", tone: "warn" },
    { name: "DEV-MAC-01", environment: "Development", os: "macOS 15", hardware: "Apple M4 Max · 64 GB", services: "1 model · 2 MCP", lastHeartbeat: "3 days ago", status: "Offline", tone: "neutral" },
  ];
}

// TODO(backend): Replace with a real aggregate query alongside listMachines(), computed from
// live heartbeat and utilization telemetry rather than fixed figures.
export async function getMachineSummary(): Promise<MachineSummary> {
  return {
    onlineCount: 2,
    totalCount: 3,
    combinedAcceleratorMemoryGb: 82,
    averageGpuUtilizationPct: 61,
    averageHeartbeatMs: 42,
    appliedConfigVersion: "v42",
  };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/organizations/:id/machines/enroll)
// that issues a one-time enrollment code (expires in 15 minutes per the UI copy) for a new
// machine to redeem via the organization agent CLI.
export async function createEnrollmentCode(): Promise<{ code: string; expiresAt: string }> {
  return { code: "OBR-0000-0000", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/organizations/:id/machines/:machineId/revoke)
// that invalidates the machine's signed identity and rejects further config sync from it.
export async function revokeMachine(_machineId: string): Promise<{ ok: boolean }> {
  return { ok: true };
}
