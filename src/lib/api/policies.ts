import type { StatusTone } from './types';
import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export interface ToolPolicyRow {
  id: string;
  server_id: string;
  server_name: string;
  tool_name: string;
  enabled: boolean;
  risk: 'read' | 'network' | 'write' | 'destructive';
  confirmation: 'never' | 'first_use' | 'every_use';
  updated_at: string;
}

export interface PolicySummaryRow {
  approvedToolCount: number;
  readCount: number;
  networkCount: number;
  writeCount: number;
  destructiveCount: number;
  appliedRevision: string;
}

export async function listToolPolicies(): Promise<ToolPolicyRow[]> {
  const body = await readJson<{ ok: true; policies: ToolPolicyRow[] }>('/api/portal/tool-policies', { method: 'GET' }, 'Could not load tool policies');
  return body.policies;
}

export async function getPolicySummary(): Promise<PolicySummaryRow> {
  const body = await readJson<{ ok: true; summary: PolicySummaryRow }>('/api/portal/tool-policies', { method: 'GET' }, 'Could not load tool policies');
  return body.summary;
}

export async function setToolEnabled(policyId: string, enabled: boolean): Promise<MutationResult> {
  return mutation('/api/portal/tool-policies/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ policy_id: policyId, enabled }),
  }, 'Could not update this tool policy');
}

export function policyTone(risk: ToolPolicyRow['risk'], enabled: boolean): StatusTone {
  if (!enabled) return 'neutral';
  switch (risk) {
    case 'destructive': return 'bad';
    case 'write': return 'teal';
    case 'network': return 'warn';
    case 'read': return 'good';
    default: return 'neutral';
  }
}