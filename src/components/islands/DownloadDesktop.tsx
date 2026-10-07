import { useState } from "react";
import { Download } from "lucide-react";
import type { DesktopOs, DesktopRelease } from "../../lib/api/downloads";

export default function DownloadDesktop({ release }: { release: DesktopRelease }) {
  const [os, setOs] = useState<DesktopOs>("Windows");
  const url = release.downloadUrlByOs[os];
  const checksum = release.checksumsByOs[os];

  return (
    <>
      <div className="os-tabs">
        {(Object.keys(release.osDetails) as DesktopOs[]).map((x) => (
          <button key={x} className={os === x ? "active" : ""} onClick={() => setOs(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="download-box">
        <div>
          <b>{release.available ? `Obrenna Desktop ${release.version}` : "Obrenna Desktop"}</b>
          <small>
            {release.available
              ? `${release.osDetails[os]} · Released ${new Date(release.releasedOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
              : "No published build for this platform yet"}
          </small>
          {release.available && checksum && (
            <small className="download-checksum" title={checksum}>SHA-256 {checksum.slice(0, 12)}…</small>
          )}
        </div>
        {url ? (
          <a className="button" href={url} download>
            <Download size={16} /> Download
          </a>
        ) : (
          <button className="button" disabled title="This asset has not been published">
            Unavailable
          </button>
        )}
      </div>
    </>
  );
}