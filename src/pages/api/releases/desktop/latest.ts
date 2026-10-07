import type { APIRoute } from 'astro';
import { controlPlaneConfig } from '../../../../lib/portal/control-plane-config';

export const GET: APIRoute = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${controlPlaneConfig().baseUrl}/api/releases/desktop/latest`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return Response.json({ version: '', published_at: '', assets: [] }, { status: 503 });
  } finally {
    clearTimeout(timer);
  }
};