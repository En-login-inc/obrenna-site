import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { listOrganizationInferenceMachines, revokeOrganizationInferenceMachine, type OrganizationInferenceMachine } from "../../lib/api/machines";
import Status from "../StatusReact";

export default function OrganizationMachines({ organizationId }: { organizationId: string }) {
  const [machines, setMachines] = useState<OrganizationInferenceMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMachine, setBusyMachine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    setError("");
    try {
      setMachines(await listOrganizationInferenceMachines(organizationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load inference machines");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [organizationId]);

  async function revoke(machine: OrganizationInferenceMachine) {
    if (!window.confirm(`Revoke ${machine.name}? This will invalidate its model assignments and active inference grants.`)) return;
    setBusyMachine(machine.id);
    setError("");
    setNotice("");
    const result = await revokeOrganizationInferenceMachine(organizationId, machine.id);
    if (!result.ok) {
      setError(result.message);
      setBusyMachine(null);
      return;
    }
    setNotice(`${machine.name} was revoked. Its model assignments and active grants are invalidated.`);
    await reload();
    setBusyMachine(null);
  }

  const activeCount = machines.filter((machine) => machine.status === "active").length;
  const revokedCount = machines.length - activeCount;

  return (
    <>
      <div className="machine-summary">
        <div>
          <Status tone={activeCount > 0 ? "good" : "neutral"}>{activeCount} ACTIVE</Status>
          <b>Registered inference machines</b>
          <span>{machines.length} records · {revokedCount} revoked</span>
        </div>
        <div><span><b>{machines.reduce((total, machine) => total + machine.models.length, 0)}</b><small>Active model assignments</small></span></div>
        <div><span><b>—</b><small>Hardware telemetry unavailable</small></span></div>
        <div><span><b>—</b><small>Heartbeat telemetry unavailable</small></span></div>
      </div>

      {(error || notice) && <p className={error ? "admin-action-error" : "admin-action-success"} role="status">{error || notice}</p>}
      {loading && <p role="status">Loading organization inference machines…</p>}
      {!loading && !error && machines.length === 0 && <p role="status">No inference machines are registered for this organization.</p>}

      {machines.length > 0 && (
        <div className="machine-table portal-card real-machine-table">
          <div className="table-head"><span>Inference machine</span><span>Model assignments</span><span>Registered</span><span>Status</span><span>Actions</span></div>
          {machines.map((machine) => (
            <div className="table-row machine-row" key={machine.id}>
              <span className="machine-name"><span className={`machine-icon ${machine.status === "active" ? "good" : "neutral"}`}><Server size={16} aria-hidden="true" /></span><span><b>{machine.name}</b><small>{machine.id}</small></span></span>
              <span>{machine.models.length ? machine.models.join(", ") : "No models assigned"}</span>
              <span>{new Date(machine.created_at).toLocaleDateString()}</span>
              <span><Status tone={machine.status === "active" ? "good" : "neutral"}>{machine.status === "active" ? "Active" : "Revoked"}</Status></span>
              <span><button type="button" className="membership-action" disabled={machine.status !== "active" || busyMachine === machine.id} onClick={() => void revoke(machine)}>{busyMachine === machine.id ? "Revoking…" : "Revoke"}</button></span>
            </div>
          ))}
        </div>
      )}

      <div className="enrollment-note">
        <span><b>These records authorize inference routing.</b><small>Hardware enrollment credentials and heartbeat telemetry are issued on the machines portal above.</small></span>
      </div>
    </>
  );
}
