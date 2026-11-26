import type { APIRoute } from 'astro';
import { latestReleaseWithAsset } from '../../lib/releases';

/**
 * Redirects to the newest published server bundle in the public releases repo.
 * A locally built public/install/obrenna-server.tar.gz (dev/release builds)
 * takes precedence over this route; in production the bundle is not checked in,
 * so this route serves the bootstrap scripts' download.
 */
export const GET: APIRoute = async () => {
  try {
    const found = await latestReleaseWithAsset('obrenna-server.tar.gz');
    if (!found) return new Response('No server bundle is published yet.', { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: found.asset.browser_download_url, 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return new Response('Release lookup failed; try again shortly.', { status: 503 });
  }
};