import type { APIRoute } from 'astro';
import { latestReleaseWithAsset } from '../../lib/releases';

export const GET: APIRoute = async () => {
  try {
    const found = await latestReleaseWithAsset('obrenna-server.tar.gz.sha256');
    if (!found) return new Response('No server bundle checksum is published yet.', { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: found.asset.browser_download_url, 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return new Response('Release lookup failed; try again shortly.', { status: 503 });
  }
};