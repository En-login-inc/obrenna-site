import { readJson } from './portal-client';
import type { StatusTone } from './types';
import type { MutationResult } from './mutation-result';

export interface ConnectionStatus {
  organizationName: string;
  machineCount: number;
  onlineMachineCount: number;
  machineName: string;
  availableModelCount: number;
  availableToolCount: number;
  configVersion: string;
  connected: boolean;
}

export interface EmployeeModelRow {
  id: string;
  display_name: string;
  provider: string;
  base_url: string;
  status: string;
}

export interface EmployeeToolRow {
  id: string;
  server_id: string;
  tool_name: string;
  risk: string;
  confirmation: string;
  enabled: boolean;
}

export interface EmployeeConfirmationRow {
  id: string;
  event_type: string;
  summary: string;
  created_at: string;
}

export interface EmployeePortalData {
  organization: { id: string; slug: string; display_name: string; config_revision: number };
  viewer: { user_id: string; role: string };
  connections: Array<{
    machine_id: string;
    display_name: string;
    status: string;
    last_seen_at: string | null;
  }>;
  allocated_models: EmployeeModelRow[];
  allocated_tools: EmployeeToolRow[];
  recent_confirmations: EmployeeConfirmationRow[];
}

export async function getEmployeePortal(): Promise<EmployeePortalData> {
  const body = await readJson<EmployeePortalData & { ok: true }>('/api/portal/employee', { method: 'GET' }, 'Could not load your organization access');
  return body;
}

export function toConnectionStatus(data: EmployeePortalData | null, organizationName: string): ConnectionStatus {
  if (!data) {
    return {
      organizationName,
      machineCount: 0,
      onlineMachineCount: 0,
      machineName: 'Unavailable',
      availableModelCount: 0,
      availableToolCount: 0,
      configVersion: 'Unavailable',
      connected: false,
    };
  }
  const online = data.connections.filter((c) => c.status === 'online');
  return {
    organizationName,
    machineCount: data.connections.length,
    onlineMachineCount: online.length,
    machineName: online[0]?.display_name ?? 'No machine online',
    availableModelCount: data.allocated_models.length,
    availableToolCount: data.allocated_tools.length,
    configVersion: `v${data.organization.config_revision}`,
    connected: online.length > 0,
  };
}

export function confirmationTone(eventType: string): StatusTone {
  switch (eventType) {
    case 'tool_confirmation': return 'good';
    case 'tool_denied': return 'bad';
    default: return 'neutral';
  }
}

/**
 * A live connection diagnostic is not supported by the control plane yet.
 * Report that honestly rather than faking a passing check.
 */
export async function runConnectionCheck(): Promise<MutationResult> {
  return {
    ok: false,
    unavailable: true,
    message: 'Desktop connection diagnostics are not available yet. Your connection status above reflects the last control-plane heartbeat.',
  };
}