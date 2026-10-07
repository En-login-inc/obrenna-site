import type { APIRoute } from 'astro';
import { controlPlaneConfig, controlPlaneConfigured } from '../../lib/portal/control-plane-config';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const companyName = String(body.company_name ?? '').trim();
  const workEmail = String(body.work_email ?? '').trim().toLowerCase();
  if (!companyName || !workEmail) {
    return Response.json({ ok: false, detail: 'company_name and work_email are required' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
    return Response.json({ ok: false, detail: 'work_email must be a valid email address' }, { status: 422 });
  }
  const controlPlane = controlPlaneConfig();
  if (!controlPlaneConfigured() || !controlPlane.baseUrl) {
    return Response.json({ ok: false, detail: 'Sales submissions are not configured' }, { status: 503 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${controlPlane.baseUrl}/api/portal/portal/contact-sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        company_name: companyName,
        work_email: workEmail,
        contact_name: String(body.contact_name ?? '').slice(0, 160),
        message: String(body.message ?? '').slice(0, 4000),
      }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.received !== true) {
      return Response.json(
        { ok: false, detail: typeof result.detail === 'string' ? result.detail : 'Could not submit this request' },
        { status: response.status === 503 ? 503 : 502 },
      );
    }
    return Response.json({ received: true, lead_id: result.lead_id }, { status: 201 });
  } catch {
    return Response.json({ ok: false, detail: 'Could not submit this request' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
};