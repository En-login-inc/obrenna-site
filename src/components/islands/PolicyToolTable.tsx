import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import Status from "../StatusReact";
import type { ToolPolicyRow } from "../../lib/api/policies";
import { policyTone, setToolEnabled } from "../../lib/api/policies";

const RISK_LABELS: Record<ToolPolicyRow["risk"], string> = {
  read: "Read",
  network: "Network",
  write: "Write",
  destructive: "Destructive",
};

const CONFIRMATION_LABELS: Record<ToolPolicyRow["confirmation"], string> = {
  never: "Never",
  first_use: "First use",
  every_use: "Every use",
};

function approvalFor(policy: ToolPolicyRow): { label: string; tone: ReturnType<typeof policyTone> } {
  if (!policy.enabled) return { label: "Disabled", tone: "neutral" };
  return { label: "Approved", tone: policyTone(policy.risk, true) };
}

export default function PolicyToolTable({ tools }: { tools: ToolPolicyRow[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    Object.fromEntries(tools.map((t) => [t.id, t.enabled]))
  );
  const [busyPolicy, setBusyPolicy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function toggle(policy: ToolPolicyRow) {
    const next = !enabled[policy.id];
    setBusyPolicy(policy.id);
    const result = await setToolEnabled(policy.id, next);
    setBusyPolicy(null);
    if (result.ok) {
      setEnabled((prev) => ({ ...prev, [policy.id]: next }));
      setMessage("");
    } else {
      setMessage(result.message);
    }
  }

  return (
    <div className="policy-table portal-card">
      {message && <p className="admin-action-unavailable" role="status">{message}</p>}
      {tools.length === 0 && <p role="status">No tool policies are configured yet. Register an MCP server to discover its tools.</p>}
      <div className="table-head">
        <span>Enabled</span>
        <span>Tool</span>
        <span>Server</span>
        <span>Risk</span>
        <span>Confirmation</span>
        <span>Approval</span>
        <span />
      </div>
      {tools.map((t) => {
        const approval = approvalFor(t);
        return (
          <div className="table-row policy-row" key={t.id}>
            <span>
              <button
                onClick={() => void toggle(t)}
                disabled={busyPolicy === t.id}
                className={enabled[t.id] ? "toggle on" : "toggle"}
              >
                <i />
              </button>
            </span>
            <span>
              <b>{t.tool_name}</b>
              <small>updated {new Date(t.updated_at).toLocaleString()}</small>
            </span>
            <span>{t.server_name}</span>
            <span><em className={`risk-${t.risk}`}>{RISK_LABELS[t.risk] ?? t.risk}</em></span>
            <span>{CONFIRMATION_LABELS[t.confirmation] ?? t.confirmation}</span>
            <span><Status tone={approval.tone}>{approval.label}</Status></span>
            <span><MoreHorizontal size={16} /></span>
          </div>
        );
      })}
    </div>
  );
}