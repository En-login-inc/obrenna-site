import { mutation, readJson } from './portal-client';
import type { MutationResult } from './mutation-result';

export async function getCodeModeSetting(organizationId: string): Promise<boolean> {
  const query = new URLSearchParams({ organization_id: organizationId });
  const body = await readJson<{ ok: true; enabled: boolean }>(
    `/api/auth/organization-code-mode?${query}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
    'Could not load the Code mode setting',
  );
  return body.enabled;
}

export async function setCodeModeSetting(organizationId: string, enabled: boolean): Promise<MutationResult> {
  return mutation('/api/auth/organization-code-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ organization_id: organizationId, enabled }),
  }, 'Could not change the Code mode setting');
}
