import type { MutationResult } from './mutation-result';

export async function createOrganization(input: {
  name: string;
  identifier: string;
  region: string;
  orgType: string;
}): Promise<MutationResult> {
  try {
    const response = await fetch('/api/auth/organizations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: input.name, identifier: input.identifier, region: input.region, orgType: input.orgType }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, message: typeof body.error === 'string' ? body.error : 'Could not create this organization' };
    }
    return { ok: true, data: body.organization };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not create this organization' };
  }
}
