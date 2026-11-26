/**
 * Public release artifacts live in En-login-inc/obrenna-releases (the source
 * repos are private, so GitHub Releases there cannot serve anonymous downloads).
 * These helpers resolve the newest release containing a given asset and return
 * its public download URL. Results are cached per isolate for five minutes.
 */
const RELEASES_REPO = 'En-login-inc/obrenna-releases';
const API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
const TTL_MS = 5 * 60 * 1000;

type GhAsset = { name: string; browser_download_url: string };
type GhRelease = { tag_name: string; draft: boolean; prerelease: boolean; assets: GhAsset[] };

let cache: { at: number; releases: GhRelease[] } | null = null;

async function listReleases(): Promise<GhRelease[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.releases;
  const response = await fetch(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'obrenna-site' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GitHub releases API returned ${response.status}`);
  const releases = (await response.json()) as GhRelease[];
  cache = { at: Date.now(), releases: releases.filter(r => !r.draft && !r.prerelease) };
  return cache.releases;
}

/** Newest published release that contains `assetName`, or null. */
export async function latestReleaseWithAsset(assetName: string): Promise<{ tag: string; asset: GhAsset } | null> {
  const releases = await listReleases();
  for (const release of releases) {
    const asset = release.assets.find(a => a.name === assetName);
    if (asset) return { tag: release.tag_name, asset };
  }
  return null;
}

/** Fetch a JSON manifest asset from the newest release that carries it. */
export async function latestManifest<T>(assetName: string): Promise<T | null> {
  const found = await latestReleaseWithAsset(assetName);
  if (!found) return null;
  const response = await fetch(found.asset.browser_download_url, {
    headers: { Accept: 'application/json', 'User-Agent': 'obrenna-site' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}