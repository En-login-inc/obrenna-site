import { useEffect, useState } from "react";
import { getCodeModeSetting, setCodeModeSetting } from "../../lib/api/organization-settings";
import Status from "../StatusReact";

export default function CodeModeSwitch({ organizationId }: { organizationId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getCodeModeSetting(organizationId)
      .then(setEnabled)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load the Code mode setting"));
  }, [organizationId]);

  async function change(next: boolean) {
    setBusy(true);
    setError("");
    const result = await setCodeModeSetting(organizationId, next);
    if (result.ok) setEnabled(next);
    else setError(result.message);
    setBusy(false);
  }

  return (
    <section className="portal-card code-mode-switch" aria-labelledby="code-mode-heading">
      <div>
        <Status tone={enabled === false ? "neutral" : "good"}>{enabled === null ? "…" : enabled ? "ON" : "OFF"}</Status>
        <b id="code-mode-heading">Code mode in the desktop app</b>
        <span>Lets people in this organization use Obrenna's Code mode, which reads and edits files in a project folder on their computer. Turning it off takes effect when a desktop next refreshes its organization grant, within a day at most.</span>
      </div>
      <label>
        <input type="checkbox" checked={enabled === true} disabled={enabled === null || busy} onChange={(event) => void change(event.target.checked)} />
        {" "}Allow Code mode
      </label>
      {error && <p className="admin-action-error" role="status">{error}</p>}
    </section>
  );
}
