import { useEffect, useState, type FormEvent } from "react";

interface Machine {
  id: string;
  display_name: string;
  hostname: string;
  os: string;
  kind: "host" | "client";
  status: "online" | "offline" | "revoked" | "pending";
  last_seen_at: string | null;
  created_at: string;
}

interface OneTimeSecret {
  value: string;
  title: string;
  detail: string;
}

interface InstallCommand {
  command: string;
  expiresAt: string;
}

export default function MachineAdminPanel() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [hostName, setHostName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [installCommand, setInstallCommand] = useState<InstallCommand | null>(null);
  const [installPlatform, setInstallPlatform] = useState("windows");
  const [pairingToken, setPairingToken] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingDone, setPairingDone] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/control/machines", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load enrolled machines.");
      setMachines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load enrolled machines.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("pair");
    if (token) setPairingToken(token);
  }, []);

  async function generateInstallCommand() {
    setBusy(true);
    setError("");
    setInstallCommand(null);
    try {
      const response = await fetch("/api/control/install-sessions", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a server install command.");
      const token = String(data.token);
      const origin = window.location.origin;
      let command: string;
      if (installPlatform === "local-dev-windows") {
        command = `Set-ExecutionPolicy -Scope Process Bypass -Force; .\\scripts\\install.ps1 -ControlPlaneUrl '${origin}' -InstallToken '${token}' -SourcePath (Get-Location).Path -LocalDevelopment`;
      } else if (installPlatform === "local-dev-macos" || installPlatform === "local-dev-linux") {
        const script = installPlatform === "local-dev-macos" ? "install-macos.sh" : "install-linux.sh";
        command = `bash ./scripts/${script} --control-plane '${origin}' --install-token '${token}' --source-dir "$PWD"`;
      } else if (installPlatform === "windows") {
        command = `$ErrorActionPreference = 'Stop'; $script = Join-Path $env:TEMP 'obrenna-server-install.ps1'; Invoke-WebRequest -Headers @{ Authorization = 'Bearer ${token}' } -Uri '${origin}/api/control/hosts/install-source?format=windows-script' -OutFile $script; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -ControlPlaneUrl '${origin}' -InstallToken '${token}'`;
      } else {
        const format = installPlatform === "macos" ? "macos-script" : "linux-script";
        command = `set -o pipefail; curl -fsSL -H 'Authorization: Bearer ${token}' '${origin}/api/control/hosts/install-source?format=${format}' | bash -s -- --control-plane '${origin}' --install-token '${token}'`;
      }
      setInstallCommand({ command, expiresAt: data.expires_at });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a server install command.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInstallCommand() {
    if (!installCommand) return;
    try {
      await navigator.clipboard.writeText(installCommand.command);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy the install command.");
    }
  }

  async function approveHostPairing() {
    setPairingBusy(true);
    setError("");
    try {
      const response = await fetch("/api/control/hosts/pair", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_token: pairingToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not approve this server.");
      window.history.replaceState({}, "", window.location.pathname);
      setPairingToken("");
      setPairingDone(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not approve this server.");
    } finally {
      setPairingBusy(false);
    }
  }

  async function createHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/control/hosts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: hostName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not register the model host.");
      setSecret({
        value: data.token,
        title: "Host credential — shown once",
        detail: "Set OBRENNA_HOST_TOKEN on this Obrenna-Server, then start the service. Do not share this credential with desktop clients.",
      });
      setHostName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register the model host.");
    } finally {
      setBusy(false);
    }
  }

  async function createEnrollmentCode() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/control/enrollment-codes", {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create an enrollment code.");
      setSecret({
        value: data.code,
        title: "One-time client enrollment code",
        detail: `Expires ${new Date(data.expires_at).toLocaleString()}. Enter it in the Obrenna app's remote Ollama settings.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create an enrollment code.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(machine: Machine) {
    if (!window.confirm(`Revoke ${machine.display_name}? Its credentials will stop working after the host syncs.`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/control/machines?revoke=${encodeURIComponent(machine.id)}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke this machine.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this machine.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="machine-admin">
      {pairingToken && (
        <section className="host-pairing-prompt portal-card" aria-live="polite" aria-labelledby="host-pairing-title">
          <span className="host-pairing-label">Action required · New server</span>
          <h2 id="host-pairing-title">Approve and link this Ollama host</h2>
          <p>This one-time request connects the pending server to the currently selected organization. Only approve it if you started this installation.</p>
          <button className="button host-pairing-button" type="button" onClick={() => void approveHostPairing()} disabled={pairingBusy}>
            {pairingBusy ? "Linking host…" : "Approve and link host"}
          </button>
        </section>
      )}
      {pairingDone && <p className="form-success" role="status">Host linked. It will become available after its next policy sync.</p>}
      <div className="machine-admin-actions portal-card">
        <section className="settings-card">
          <h2>Install Obrenna-Server</h2>
          <p>Generate a short-lived command for this organization. Platform installs retrieve the installer and private server source through an authenticated, expiring download from Obrenna. Local development uses the checked-out source.</p>
          <label>Host operating system
            <select value={installPlatform} onChange={(event) => setInstallPlatform(event.target.value)}>
              <option value="local-dev-windows">Local development (current checkout, Windows)</option>
              <option value="local-dev-macos">Local development (current checkout, macOS)</option>
              <option value="local-dev-linux">Local development (current checkout, Linux)</option>
              <option value="windows">Windows (PowerShell)</option>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
            </select>
          </label>
          <button className="button" type="button" onClick={() => void generateInstallCommand()} disabled={busy}>Generate install command</button>
        </section>
        <form className="settings-card" onSubmit={createHost}>
          <h2>Register an Ollama host</h2>
          <p>Create a host identity. Its credential is displayed only once and is used for outbound policy sync.</p>
          <label>Host display name
            <input required maxLength={120} value={hostName} onChange={(event) => setHostName(event.target.value)} placeholder="Obrenna model host" />
          </label>
          <button className="button" disabled={busy}>Register host</button>
        </form>
        <div className="settings-card">
          <h2>Enroll a client computer</h2>
          <p>Generate a single-use code that expires in 15 minutes. The Obrenna app redeems it with the registered host.</p>
          <button className="secondary-button" onClick={createEnrollmentCode} disabled={busy}>Generate enrollment code</button>
        </div>
        {installCommand && (
          <section className="one-time-secret portal-card">
            <h2>One-time installer command</h2>
            <p>This install token expires {new Date(installCommand.expiresAt).toLocaleString()} and can be used once. Treat it like a password; do not post it publicly.</p>
            {installPlatform.startsWith("local-dev-") && <p>Run this from the Obrenna-Server checkout directory on the same development computer as the site. It installs required Python/Ollama packages where supported, uses the local source, and starts the server in the current terminal.</p>}
            <label>Run on the Ollama host
              <textarea readOnly rows={installPlatform === "windows" ? 4 : 3} value={installCommand.command} onFocus={(event) => event.currentTarget.select()} />
            </label>
            <button className="secondary-button" type="button" onClick={() => void copyInstallCommand()}>Copy command</button>
          </section>
        )}
      </div>
      {secret && (
        <section className="one-time-secret portal-card" aria-live="polite">
          <h2>{secret.title}</h2>
          <p>{secret.detail}</p>
          <label>Copy this value now<input readOnly value={secret.value} onFocus={(event) => event.currentTarget.select()} /></label>
          <button className="secondary-button" onClick={() => setSecret(null)}>Dismiss</button>
        </section>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="machine-admin-heading">
        <h2>Connected computers</h2>
        <button className="secondary-button" onClick={() => void load()} disabled={loading || busy}>Refresh</button>
      </div>
      {loading ? <p role="status">Loading machines…</p> : (
        <div className="machine-table portal-card">
          <div className="table-head"><span>Name</span><span>Type</span><span>Host name</span><span>Operating system</span><span>Last heartbeat</span><span>Status</span><span /></div>
          {machines.length === 0 ? <p className="machine-empty">No hosts or client computers are enrolled yet.</p> : machines.map((machine) => (
            <div className="table-row machine-row" key={`${machine.kind}-${machine.id}`}>
              <span className="machine-name"><b>{machine.display_name}</b></span>
              <span>{machine.kind === "host" ? "Ollama host" : "Obrenna client"}</span>
              <span>{machine.hostname || "—"}</span>
              <span>{machine.os || "—"}</span>
              <span>{machine.last_seen_at ? new Date(machine.last_seen_at).toLocaleString() : "Never"}</span>
              <span className={`machine-status ${machine.status}`}>{machine.status}</span>
              <span>{machine.status !== "revoked" && <button className="text-button" onClick={() => void revoke(machine)} disabled={busy}>Revoke</button>}</span>
            </div>
          ))}
        </div>
      )}
      <p className="enrollment-note"><b>Credentials are never listed.</b> Revoked credentials are removed from the host's next outbound policy sync.</p>
    </div>
  );
}
