import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export interface OrganizationProfile {
  id: string;
  slug: string;
  display_name: string;
  config_revision: number;
  prompt_telemetry_enabled: boolean;
  created_at: string;
}

export interface PrivacyDefaults {
  promptTelemetryEnabled: boolean;
  redactedLifecycleTelemetryEnabled: boolean;
  optionalDiagnosticsEnabled: boolean;
}

export async function getOrganizationProfile(): Promise<OrganizationProfile> {
  const body = await readJson<{ ok: true; organization: OrganizationProfile }>('/api/portal/settings', { method: 'GET' }, 'Could not load organization settings');
  return body.organization;
}

export async function getPrivacyDefaults(): Promise<PrivacyDefaults> {
  const profile = await getOrganizationProfile();
  return {
    promptTelemetryEnabled: profile.prompt_telemetry_enabled,
    // The control plane tracks prompt telemetry; other defaults are not
    // stored server-side yet and are reported as their safe defaults.
    redactedLifecycleTelemetryEnabled: true,
    optionalDiagnosticsEnabled: false,
  };
}

export async function updateOrganizationProfile(input: { name: string }): Promise<MutationResult> {
  return mutation('/api/portal/settings/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ display_name: input.name }),
  }, 'Could not update the organization profile');
}

export async function updatePrivacyDefaults(input: Partial<PrivacyDefaults>): Promise<MutationResult> {
  return mutation('/api/portal/settings/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ prompt_telemetry_enabled: input.promptTelemetryEnabled }),
  }, 'Could not update privacy defaults');
}