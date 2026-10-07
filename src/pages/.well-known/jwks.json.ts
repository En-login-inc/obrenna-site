import type { APIRoute } from 'astro';
import { publicGrantJwks } from '../../lib/inference-grants';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    return Response.json(await publicGrantJwks(), {
      headers: { 'Cache-Control': 'public, max-age=60, must-revalidate' },
    });
  } catch {
    return Response.json({ error: 'Signing keys are not configured' }, { status: 503 });
  }
};
