import { useState } from "react";
import type { PrivacyDefaults } from "../../lib/api/settings";
import { updatePrivacyDefaults } from "../../lib/api/settings";

export default function PrivacyDefaultsToggles({ initial }: { initial: PrivacyDefaults }) {
  const [defaults, setDefaults] = useState(initial);

  async function toggle(key: keyof PrivacyDefaults) {
    const next = { ...defaults, [key]: !defaults[key] };
    setDefaults(next);
    await updatePrivacyDefaults({ [key]: next[key] });
  }

  return (
    <>
      <div className="setting-toggle">
        <span>
          <b>Prompt and response telemetry</b>
          <small>Keep disabled to prevent content telemetry from being configured.</small>
        </span>
        <button
          className={defaults.promptTelemetryEnabled ? "toggle on" : "toggle"}
          onClick={() => toggle("promptTelemetryEnabled")}
        >
          <i />
        </button>
      </div>
      <div className="setting-toggle">
        <span>
          <b>Redacted lifecycle telemetry</b>
          <small>Share failure category, duration and component version—without prompt content.</small>
        </span>
        <button
          className={defaults.redactedLifecycleTelemetryEnabled ? "toggle on" : "toggle"}
          onClick={() => toggle("redactedLifecycleTelemetryEnabled")}
        >
          <i />
        </button>
      </div>
      <div className="setting-toggle">
        <span>
          <b>Optional diagnostics</b>
          <small>Administrators must explicitly enable diagnostics for a bounded support window.</small>
        </span>
        <button
          className={defaults.optionalDiagnosticsEnabled ? "toggle on" : "toggle"}
          onClick={() => toggle("optionalDiagnosticsEnabled")}
        >
          <i />
        </button>
      </div>
    </>
  );
}
