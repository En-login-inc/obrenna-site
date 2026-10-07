import type { StatusTone } from './types';
import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export type MachineStatus = 'pending' | 'online' | 'offline' | 'revoked';

export interface ControlPlaneMachine {
  id: string;
  org_id: string;
  display_name: string;
  hostname: string | null;
  os: string | null;
  status: MachineStatus;
  last_seen_at: string | null;
  created_at: string;
}

export interface MachinesData {
  machines: ControlPlaneMachine[];
  summary: {
    total: number;
    online: number;
    offline: number;
    pending: number;
    revoked: number;
  };
}

export interface OrganizationInferenceMachine {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  created_at: string;
  models: string[];
}

export async function listOrganizationInferenceMachines(organizationId: string): Promise<OrganizationInferenceMachine[]> {
  const query = new URLSearchParams({ organization_id: organizationId });
  const response = await fetch(`/api/auth/inference-machines?${query}`, {
    method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !Array.isArray(body.machines)) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not load inference machines');
  }
  return body.machines as OrganizationInferenceMachine[];
}

export async function revokeOrganizationInferenceMachine(
  organizationId: string,
  machineId: string,
): Promise<MutationResult> {
  return mutation('/api/auth/inference-machines/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ organization_id: organizationId, machine_id: machineId }),
  }, 'Could not revoke this inference machine');
}

export async function getMachines(): Promise<MachinesData> {
  const body = await readJson<MachinesData & { ok: true }>('/api/portal/machines', { method: 'GET' }, 'Could not load enrolled machines');
  return { machines: body.machines, summary: body.summary };
}

export interface EnrollMachineResult {
  machine: ControlPlaneMachine;
  enroll_token: string;
  expires_at: string;
}

export async function enrollMachine(displayName: string): Promise<MutationResult> {
  return mutation('/api/portal/machines/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  }, 'Could not enroll this machine');
}

export async function revokeMachine(machineId: string): Promise<MutationResult> {
  return mutation('/api/portal/machines/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ machine_id: machineId }),
  }, 'Could not revoke this machine');
}

export function machineStatusLabel(status: MachineStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'online': return { label: 'Online', tone: 'good' };
    case 'pending': return { label: 'Pending', tone: 'warn' };
    case 'offline': return { label: 'Offline', tone: 'neutral' };
    case 'revoked': return { label: 'Revoked', tone: 'bad' };
    default: return { label: status, tone: 'neutral' };
  }
}