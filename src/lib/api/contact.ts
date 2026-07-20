export interface ContactRequestPayload {
  workEmail: string;
  firstName: string;
  lastName: string;
  organization: string;
  teamSize: string;
  message: string;
}

// TODO(backend): Replace with a real submission (e.g. POST /api/contact-sales) that validates
// the work email, writes the lead to CRM/sales-pipeline storage, and triggers the "reply within
// one business day" notification to the sales team. Currently a no-op that always succeeds.
export async function submitContactRequest(
  _payload: ContactRequestPayload
): Promise<{ ok: boolean }> {
  return { ok: true };
}
