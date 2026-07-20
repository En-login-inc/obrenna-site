import { useState } from "react";
import { Download } from "lucide-react";
import type { DesktopOs, DesktopRelease } from "../../lib/api/downloads";

export default function DownloadDesktop({ release }: { release: DesktopRelease }) {
  const [os, setOs] = useState<DesktopOs>("Windows");

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
          <b>Obrenna Desktop {release.version}</b>
          <small>
            {release.osDetails[os]} · Released{" "}
            {new Date(release.releasedOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </small>
        </div>
        <a className="button" href={release.downloadUrlByOs[os]}>
          <Download size={16} /> Download
        </a>
      </div>
    </>
  );
}
