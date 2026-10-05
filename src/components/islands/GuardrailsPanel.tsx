import { useEffect, useState, type FormEvent } from "react";

interface Guardrails {
  revision: number;
  allowed_models: string[];
  requests_per_minute: number;
  max_input_chars: number;
  max_output_chars: number;
  blocked_terms: string[];
  detect_sensitive_data: boolean;
}

interface RegisteredHost {
  revoked_at: string | null;
  paired_at: string | null;
  available_models: unknown;
}

const emptyPolicy: Guardrails = {
  revision: 0,
  allowed_models: [],
  requests_per_minute: 30,
  max_input_chars: 100_000,
  max_output_chars: 20_000,
  blocked_terms: [],
  detect_sensitive_data: true,
};

export default function GuardrailsPanel() {
  const [policy, setPolicy] = useState(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [modelsText, setModelsText] = useState("");
  const [patternsText, setPatternsText] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [response, hostsResponse] = await Promise.all([
        fetch("/api/control/guardrails", { credentials: "include" }),
        fetch("/api/control/hosts", { credentials: "include" }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load guardrails.");
      setPolicy(data);
      setModelsText(data.allowed_models.join("\n"));
      setPatternsText(data.blocked_terms.join("\n"));
      if (hostsResponse.ok) {
        const hosts = await hostsResponse.json() as RegisteredHost[];
        const models = hosts
          .filter((host) => !host.revoked_at && host.paired_at && Array.isArray(host.available_models))
          .flatMap((host) => host.available_models as unknown[])
          .filter((model): model is string => typeof model === "string");
        setAvailableModels([...new Set(models)].sort());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load guardrails.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    const updated = {
      ...policy,
      allowed_models: modelsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      blocked_terms: patternsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    };
    try {
      const response = await fetch("/api/control/guardrails", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save guardrails.");
      setPolicy(data);
      setModelsText(data.allowed_models.join("\n"));
      setPatternsText(data.blocked_terms.join("\n"));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save guardrails.");
    } finally {
      setSaving(false);
    }
  }

  function toggleModel(model: string) {
    const selected = new Set(modelsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
    if (selected.has(model)) selected.delete(model);
    else selected.add(model);
    setModelsText([...selected].join("\n"));
  }

  if (loading) return <p role="status">Loading organization guardrails…</p>;

  return (
    <form className="settings-card portal-card guardrails-form" onSubmit={save}>
      <p>These rules are enforced by each enrolled Obrenna-Server before a prompt is sent to Ollama and before a response is returned.</p>
      <p>Policy revision: <b>{policy.revision}</b>. A host with a stale policy stops serving model requests.</p>
      <label>
        Allowed Ollama models
        <textarea rows={5} value={modelsText} onChange={(event) => setModelsText(event.target.value)} placeholder="qwen3:8b&#10;llama3.1:8b" />
        <small>Enter exact model IDs, one per line. An empty list denies all model requests.</small>
      </label>
      {availableModels.length > 0 && (
        <fieldset className="available-models">
          <legend>Models seen on registered hosts</legend>
          {availableModels.map((model) => (
            <label key={model}>
              <input
                type="checkbox"
                checked={modelsText.split(/\r?\n/).map((item) => item.trim()).includes(model)}
                onChange={() => toggleModel(model)}
              />
              {model}
            </label>
          ))}
        </fieldset>
      )}
      <div className="guardrails-number-grid">
        <label>Requests per machine per minute
          <input type="number" min={1} max={600} value={policy.requests_per_minute} onChange={(event) => setPolicy({ ...policy, requests_per_minute: Number(event.target.value) })} />
        </label>
        <label>Maximum input characters
          <input type="number" min={1} max={1_000_000} value={policy.max_input_chars} onChange={(event) => setPolicy({ ...policy, max_input_chars: Number(event.target.value) })} />
        </label>
        <label>Maximum output characters
          <input type="number" min={1} max={1_000_000} value={policy.max_output_chars} onChange={(event) => setPolicy({ ...policy, max_output_chars: Number(event.target.value) })} />
        </label>
      </div>
      <label>
        Blocked terms or phrases
        <textarea rows={5} value={patternsText} onChange={(event) => setPatternsText(event.target.value)} placeholder={"confidential project name\ninternal only"} />
        <small>One literal term or phrase per line. Matching is case-insensitive; matches in input or output are rejected.</small>
      </label>
      <label className="guardrails-check">
        <input type="checkbox" checked={policy.detect_sensitive_data} onChange={(event) => setPolicy({ ...policy, detect_sensitive_data: event.target.checked })} />
        Block common secrets and personal-data patterns in prompts and responses
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-success" role="status">Guardrails saved. Enrolled hosts will receive revision {policy.revision} on their next sync.</p>}
      <div className="settings-actions">
        <button className="button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save guardrails"}</button>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={saving}>Reload</button>
      </div>
    </form>
  );
}
