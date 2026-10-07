import type { MutationResult } from './mutation-result';

export interface ContactRequestPayload {
  workEmail: string;
  firstName: string;
  lastName: string;
  organization: string;
  teamSize: string;
  message: string;
}

/** Proxied by the Astro server into the control plane's lead store. */
export async function submitContactRequest(
  payload: ContactRequestPayload,
): Promise<MutationResult> {
  try {
    const response = await fetch('/api/contact-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        company_name: payload.organization,
        work_email: payload.workEmail,
        contact_name: `${payload.firstName} ${payload.lastName}`.trim(),
        message: [payload.teamSize ? `Team size: ${payload.teamSize}` : '', payload.message]
          .filter(Boolean)
          .join('\n'),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.received !== true) {
      return { ok: false, message: typeof body.detail === 'string' ? body.detail : 'Could not submit this request' };
    }
    return { ok: true, data: { lead_id: body.lead_id } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not reach Obrenna' };
  }
}