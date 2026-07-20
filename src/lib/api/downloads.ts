export type DesktopOs = "Windows" | "macOS" | "Linux";

export interface DesktopRelease {
  version: string;
  releasedOn: string;
  osDetails: Record<DesktopOs, string>;
  downloadUrlByOs: Record<DesktopOs, string>;
}

// TODO(backend): Replace with a real release lookup (e.g. GET /api/releases/desktop/latest)
// served from the actual build/release pipeline, including signed download URLs and
// per-OS SHA-256 checksums. Currently returns fixed mock metadata.
export async function getLatestDesktopRelease(): Promise<DesktopRelease> {
  return {
    version: "0.9.2",
    releasedOn: "2026-07-14",
    osDetails: {
      Windows: "Windows 11 · x64",
      macOS: "macOS 14+ · Apple Silicon",
      Linux: "Ubuntu 22.04+ · x64",
    },
    downloadUrlByOs: {
      Windows: "#",
      macOS: "#",
      Linux: "#",
    },
  };
}

// TODO(backend): Replace with a real endpoint (e.g. GET /api/releases/agent/install-script)
// that returns the organization-scoped install command, since the enrollment code embedded
// in the script must be tied to the signed-in admin's organization.
export function getAgentInstallCommand(): string {
  return "curl -fsSL get.obrenna.com/agent | sudo sh";
}
