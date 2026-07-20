import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Status from "../StatusReact";
import type { ToolPolicy } from "../../lib/api/policies";
import { setToolEnabled } from "../../lib/api/policies";

export default function PolicyToolTable({ tools }: { tools: ToolPolicy[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(tools.map((t) => [t.tool, t.enabled]))
  );

  async function toggle(tool: string) {
    const next = !enabled[tool];
    setEnabled((prev) => ({ ...prev, [tool]: next }));
    await setToolEnabled(tool, next);
  }

  return (
    <div className="policy-table portal-card">
      <div className="table-head">
        <span>Enabled</span>
        <span>Tool</span>
        <span>Server</span>
        <span>Risk</span>
        <span>Confirmation</span>
        <span>Eligible roles</span>
        <span>Approval</span>
        <span />
      </div>
      {tools.map((t) => (
        <div className="table-row policy-row" key={t.tool}>
          <span>
            <button onClick={() => toggle(t.tool)} className={enabled[t.tool] ? "toggle on" : "toggle"}>
              <i />
            </button>
          </span>
          <span>
            <b>{t.tool}</b>
            <small>schema {t.approval === "Schema changed" ? "changed" : t.schemaHash}</small>
          </span>
          <span>{t.server}</span>
          <span><em className={`risk-${t.risk.toLowerCase()}`}>{t.risk}</em></span>
          <span>{t.confirmation}</span>
          <span>{t.eligibleRoles}</span>
          <span><Status tone={t.tone}>{t.approval}</Status></span>
          <span><MoreHorizontal size={16} /></span>
        </div>
      ))}
    </div>
  );
}
