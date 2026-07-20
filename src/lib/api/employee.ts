import type { StatusTone } from "./machines";

export interface ConnectionStatus {
  organizationName: string;
  machineName: string;
  availableModelCount: number;
  availableToolCount: number;
  configVersion: string;
  connected: boolean;
}

export interface EmployeeModel {
  icon: string;
  variant: "default" | "alt";
  name: string;
  description: string;
}

export interface EmployeeToolService {
  icon: string;
  name: string;
  summary: string;
  confirmationNote: string;
}

export interface EmployeeConfirmation {
  tool: string;
  status: string;
  time: string;
  tone: StatusTone;
}

// TODO(backend): Replace with a real query (e.g. GET /api/me/connection) reading the signed-in
// user's live desktop-app connection state, reported by the Obrenna Desktop app itself rather
// than assumed by the website.
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return {
    organizationName: "Northstar Production",
    machineName: "AI-NODE-01",
    availableModelCount: 4,
    availableToolCount: 24,
    configVersion: "v42",
    connected: true,
  };
}

// TODO(backend): Replace with a real query (e.g. GET /api/me/models) reading models assigned to
// the signed-in user's role from the current policy configuration.
export async function getAvailableModels(): Promise<EmployeeModel[]> {
  return [
    { icon: "brain-circuit", variant: "default", name: "General Assistant", description: "Everyday writing, research and analysis" },
    { icon: "sparkles", variant: "alt", name: "Reasoning Primary", description: "Complex analysis and multi-step work" },
  ];
}

// TODO(backend): Replace with a real query (e.g. GET /api/me/tools) reading tool-service access
// grouped by MCP server, scoped to the signed-in user's role and current policy configuration.
export async function getAvailableToolServices(): Promise<EmployeeToolService[]> {
  return [
    { icon: "database", name: "Knowledge Index", summary: "7 read tools", confirmationNote: "No confirmation" },
    { icon: "link-2", name: "Linear Workspace", summary: "6 available · 1 unavailable", confirmationNote: "Write confirmation" },
    { icon: "globe-2", name: "Finance Systems", summary: "4 read tools", confirmationNote: "Role limited" },
  ];
}

// TODO(backend): Replace with a real query (e.g. GET /api/me/confirmations) reading the signed-in
// user's own recent tool-confirmation decisions — visible only to that user and authorized admins.
export async function getMyRecentConfirmations(): Promise<EmployeeConfirmation[]> {
  return [
    { tool: "finance.lookup", status: "Approved", time: "Today, 1:54 PM", tone: "good" },
    { tool: "linear.create_issue", status: "Approved", time: "Yesterday, 4:18 PM", tone: "good" },
    { tool: "files.delete", status: "Denied by policy", time: "July 14, 11:02 AM", tone: "neutral" },
  ];
}

// TODO(backend): Replace with a real connection diagnostic (e.g. POST /api/me/connection/check)
// that pings the user's enrolled desktop app / private machine and reports live results, instead
// of this being a purely client-side "Open Obrenna Desktop" link.
export async function runConnectionCheck(): Promise<{ ok: boolean }> {
  return { ok: true };
}
