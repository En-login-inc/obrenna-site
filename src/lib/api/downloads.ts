export type DesktopOs = 'Windows' | 'macOS' | 'Linux';

export interface DesktopRelease {
  version: string;
  releasedOn: string;
  osDetails: Record<DesktopOs, string>;
  downloadUrlByOs: Partial<Record<DesktopOs, string>>;
  checksumsByOs: Partial<Record<DesktopOs, string>>;
  available: boolean;
}

const OS_KEY_MAP: Record<DesktopOs, string> = { Windows: 'windows', macOS: 'macos', Linux: 'linux' };

function osDetailFor(os: string): string {
  switch (os) {
    case 'windows': return 'Windows 11 · x64';
    case 'macos': return 'macOS 14+ · x64 (Intel)';
    case 'linux': return 'Ubuntu 22.04+ · x64';
    default: return os;
  }
}

/**
 * Live release lookup from the control plane. Assets without a published
 * checksum are reported as unavailable rather than shown as downloadable.
 */
export async function getLatestDesktopRelease(): Promise<DesktopRelease> {
  const empty: DesktopRelease = {
    version: 'Unavailable',
    releasedOn: '',
    osDetails: { Windows: 'Not published', macOS: 'Not published', Linux: 'Not published' },
    downloadUrlByOs: {},
    checksumsByOs: {},
    available: false,
  };
  try {
    const response = await fetch('/api/releases/desktop/latest', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return empty;
    const body = await response.json().catch(() => null);
    if (!body || typeof body.version !== 'string') return empty;
    const assets = Array.isArray(body.assets) ? body.assets : [];
    const published = assets.filter(
      (asset: { url?: unknown; checksum_sha256?: unknown }) =>
        typeof asset.url === 'string' && asset.url.length > 0
        && typeof asset.checksum_sha256 === 'string' && asset.checksum_sha256.length > 0,
    );
    const downloadUrlByOs: Partial<Record<DesktopOs, string>> = {};
    const checksumsByOs: Partial<Record<DesktopOs, string>> = {};
    const osDetails: Record<DesktopOs, string> = { Windows: 'Not published', macOS: 'Not published', Linux: 'Not published' };
    for (const asset of published) {
      const key = Object.entries(OS_KEY_MAP).find(([, value]) => value === asset.os)?.[0] as DesktopOs | undefined;
      if (!key) continue;
      downloadUrlByOs[key] = String(asset.url);
      checksumsByOs[key] = String(asset.checksum_sha256);
      osDetails[key] = osDetailFor(String(asset.os));
    }
    return {
      version: body.version,
      releasedOn: typeof body.published_at === 'string' ? body.published_at.slice(0, 10) : '',
      osDetails,
      downloadUrlByOs,
      checksumsByOs,
      available: Object.keys(downloadUrlByOs).length > 0,
    };
  } catch {
    return empty;
  }
}

/**
 * Agent installation is organization-scoped and enrollment-credential based.
 * The public download page can no longer show a generic one-liner; admins get
 * their command from the machines portal after issuing an enrollment token.
 */
export function getAgentInstallCommand(): string | null {
  return null;
}
