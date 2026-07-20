import type { StatusTone } from "./machines";

export interface OverviewMetric {
  icon: string;
  label: string;
  value: string;
  sub: string;
  trend: string;
  tone: StatusTone;
}

export interface ActivityItem {
  icon: string;
  title: string;
  sub: string;
  time: string;
  tone: StatusTone;
}

export interface ServiceHealthRow {
  icon: string;
  label: string;
  value: string;
  sparkline: number[];
}

// TODO(backend): Replace with a real aggregate query (e.g. GET /api/organizations/:id/overview)
// combining machine, model, MCP and membership counts computed at request time.
export async function getOverviewMetrics(): Promise<OverviewMetric[]> {
  return [
    { icon: "server", label: "Machines", value: "3", sub: "2 online · 1 staging", trend: "Healthy", tone: "good" },
    { icon: "brain-circuit", label: "Model endpoints", value: "6", sub: "4 available to members", trend: "100% healthy", tone: "good" },
    { icon: "network", label: "MCP servers", value: "8", sub: "31 approved tools", trend: "1 review", tone: "warn" },
    { icon: "users", label: "Members", value: "47", sub: "41 active this week", trend: "3 invites", tone: "neutral" },
  ];
}

// TODO(backend): Replace with a real recent-activity feed (e.g. GET /api/organizations/:id/activity)
// reading the same redacted audit event stream shown in full on /portal/admin/audit.
export async function getRecentActivity(): Promise<ActivityItem[]> {
  return [
    { icon: "check-circle-2", title: "Tool use approved", sub: "Priya approved finance.lookup", time: "2 min ago", tone: "good" },
    { icon: "alert-triangle", title: "Schema change detected", sub: "Linear MCP · create_issue", time: "18 min ago", tone: "warn" },
    { icon: "user-plus", title: "Member invited", sub: "Noah Williams · Member", time: "1 hr ago", tone: "teal" },
    { icon: "refresh-ccw", title: "Configuration applied", sub: "AI-NODE-01 · config v42", time: "3 hr ago", tone: "neutral" },
  ];
}

// TODO(backend): Replace with real uptime/latency telemetry (e.g. GET /api/organizations/:id/service-health)
// sourced from the health-metadata channel described in the privacy model, not prompt-level telemetry.
export async function getServiceHealth(): Promise<ServiceHealthRow[]> {
  return [
    { icon: "brain-circuit", label: "Primary reasoning", value: "99.98%", sparkline: [2, 3, 4, 3, 5, 4, 5, 5, 4, 5, 5, 5] },
    { icon: "network", label: "MCP services", value: "99.94%", sparkline: [2, 3, 4, 3, 5, 4, 5, 5, 4, 5, 5, 5] },
    { icon: "refresh-ccw", label: "Configuration sync", value: "100%", sparkline: [2, 3, 4, 3, 5, 4, 5, 5, 4, 5, 5, 5] },
  ];
}

// TODO(backend): Replace with a real onboarding-progress query (e.g. GET /api/organizations/:id/setup-progress)
// tracking which of the recommended first-run steps (invite members, configure a tool policy, etc.) are complete.
export async function getSetupProgress(): Promise<{ completedSteps: number; totalSteps: number }> {
  return { completedSteps: 3, totalSteps: 4 };
}
