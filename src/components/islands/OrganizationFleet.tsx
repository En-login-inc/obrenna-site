import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import Status from "../StatusReact";
import {
  enrollMachine,
  getMachines,
  machineStatusLabel,
  revokeMachine,
  type ControlPlaneMachine,
  type MachinesData,
} from "../../lib/api/machines";

function formatLastSeen(value: string | null): string {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export default function OrganizationFleet() {
  const [data, setData] = useState<MachinesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [enrollName, setEnrollName] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollToken, setEnrollToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busyMachine, setBusyMachine] = useState<string | null>(null);

  async function reload() {
    setError("");
    try {
      setData(await getMachines());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load enrolled machines");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  async function handleEnroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEnrolling(true);
    setError("");
    setNotice("");
    const result = await enrollMachine(enrollName.trim() || "New machine");
    setEnrolling(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const payload = (result.data ?? {}) as { enroll_token?: string; expires_at?: string };
    if (payload.enroll_token) {
      setEnrollToken({ token: payload.enroll_token, expiresAt: payload.expires_at ?? "" });
    }
    setEnrollName("");
    await reload();
  }

  async function handleRevoke(machine: ControlPlaneMachine) {
    if (!window.confirm(`Revoke ${machine.display_name}? Its credentials and enrollment tokens will be invalidated.`)) return;
    setBusyMachine(machine.id);
    setError("");
    setNotice("");
    const result = await revokeMachine(machine.id);
    setBusyMachine(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(`${machine.display_name} was revoked.`);
    await reload();
  }

  const summary = data?.summary;

  return (
    <>
      {(error || notice) && <p className={error ? "admin-action-error" : "admin-action-success"} role="status">{error || notice}</p>}
      {loading && <p role="status">Loading enrolled machines…</p>}

      {!loading && summary && (
        <div className="machine-summary">
          <div>
            <Status tone={summary.online > 0 ? "good" : "neutral"}>{summary.online} ONLINE</Status>
            <b>Enrolled machines</b>
            <span>{summary.total} records · {summary.offline} offline · {summary.revoked} revoked</span>
          </div>
          <div><span><b>{summary.pending}</b><small>Pending enrollment</small></span></div>
          <div><span><b>—</b><small>Hardware telemetry unavailable</small></span></div>
          <div><span><b>—</b><small>Heartbeat telemetry unavailable</small></span></div>
        </div>
      )}

      <form className="enroll-form" onSubmit={handleEnroll}>
        <input
          type="text"
          placeholder="Machine name (e.g. AI-NODE-05)"
          value={enrollName}
          onChange={(event) => setEnrollName(event.target.value)}
          maxLength={160}
        />
        <button type="submit" className="button" disabled={enrolling}>
          {enrolling ? "Issuing…" : "Enroll machine"}
        </button>
      </form>
      {enrollToken && (
        <div className="enroll-token portal-card" role="status">
          <div>
            <b>One-time enrollment token</b>
            <small>Expires {new Date(enrollToken.expiresAt).toLocaleTimeString()} — run the agent installer on the target machine with this token.</small>
          </div>
          <code>{enrollToken.token}</code>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(enrollToken.token)}
          >
            Copy
          </button>
        </div>
      )}

      {!loading && data && data.machines.length === 0 && !error && (
        <p role="status">No machines are enrolled for this organization yet.</p>
      )}

      {!loading && data && data.machines.length > 0 && (
        <div className="machine-table portal-card">
          <div className="table-head"><span>Machine</span><span>OS</span><span>Enrolled</span><span>Last seen</span><span>Status</span><span>Actions</span></div>
          {data.machines.map((machine) => {
            const badge = machineStatusLabel(machine.status);
            return (
              <div className="table-row machine-row" key={machine.id}>
                <span className="machine-name">
                  <span className={`machine-icon ${machine.status === "online" ? "good" : "neutral"}`}>
                    <Server size={16} aria-hidden="true" />
                  </span>
                  <span><b>{machine.display_name}</b><small>{machine.hostname ?? machine.id}</small></span>
                </span>
                <span>{machine.os ?? "Unknown"}</span>
                <span>{new Date(machine.created_at).toLocaleDateString()}</span>
                <span>{formatLastSeen(machine.last_seen_at)}</span>
                <span><Status tone={badge.tone}>{badge.label}</Status></span>
                <span>
                  <button
                    type="button"
                    className="membership-action"
                    disabled={machine.status === "revoked" || busyMachine === machine.id}
                    onClick={() => void handleRevoke(machine)}
                  >
                    {busyMachine === machine.id ? "Revoking…" : "Revoke"}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="enrollment-note">
        <span><b>Machine credentials are issued per enrollment.</b><small>Each enrollment token expires 15 minutes after issue and is valid for exactly one machine.</small></span>
      </div>
    </>
  );
}