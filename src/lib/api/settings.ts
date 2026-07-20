export interface OrganizationProfile {
  name: string;
  identifier: string;
}

export interface PrivacyDefaults {
  promptTelemetryEnabled: boolean;
  redactedLifecycleTelemetryEnabled: boolean;
  optionalDiagnosticsEnabled: boolean;
}

// TODO(backend): Replace with a real query (e.g. GET /api/organizations/:id/settings) reading
// the organization profile record from the control plane.
export async function getOrganizationProfile(): Promise<OrganizationProfile> {
  return { name: "Northstar Labs", identifier: "northstar-labs" };
}

// TODO(backend): Replace with a real mutation (e.g. PATCH /api/organizations/:id) that updates
// the display name. The identifier field is immutable by design (used in enrollment/sign-in
// URLs) and must stay read-only server-side regardless of client input.
export async function updateOrganizationProfile(_input: { name: string }): Promise<{ ok: boolean }> {
  return { ok: true };
}

// TODO(backend): Replace with a real query reading the organization's default privacy/telemetry
// configuration, applied to new environments unless explicitly overridden per-environment.
export async function getPrivacyDefaults(): Promise<PrivacyDefaults> {
  return {
    promptTelemetryEnabled: false,
    redactedLifecycleTelemetryEnabled: true,
    optionalDiagnosticsEnabled: false,
  };
}

// TODO(backend): Replace with a real mutation (e.g. PATCH /api/organizations/:id/privacy-defaults).
// promptTelemetryEnabled must remain false unless an admin explicitly opts in — never default it
// to true server-side, per the "no prompt storage by default" commitment on /privacy.
export async function updatePrivacyDefaults(_input: Partial<PrivacyDefaults>): Promise<{ ok: boolean }> {
  return { ok: true };
}
