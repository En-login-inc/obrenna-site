import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export interface ModelEndpointRow {
  id: string;
  org_id: string;
  display_name: string;
  provider: string;
  base_url: string;
  capabilities: string[];
  status: 'unverified' | 'healthy' | 'unreachable';
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

export async function listModelEndpoints(): Promise<ModelEndpointRow[]> {
  const body = await readJson<{ ok: true; models: ModelEndpointRow[] }>('/api/portal/models', { method: 'GET' }, 'Could not load model endpoints');
  return body.models;
}

export async function registerModelEndpoint(input: {
  display_name: string;
  endpoint_url: string;
}): Promise<MutationResult> {
  return mutation('/api/portal/models/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  }, 'Could not register this model endpoint');
}

export function modelStatusLabel(status: ModelEndpointRow['status']): string {
  switch (status) {
    case 'healthy': return 'Healthy';
    case 'unreachable': return 'Unreachable';
    case 'unverified': return 'Pending check';
    default: return status;
  }
}