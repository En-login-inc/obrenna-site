import type { StatusTone } from "./machines";

export interface ModelEndpoint {
  title: string;
  model: string;
  runtime: "vLLM" | "Ollama";
  role: string;
  contextWindow: string;
  machine: string;
  environment: "Production" | "Staging";
  tone: StatusTone;
  lastCheckedAgo: string;
}

export interface ModelCapacity {
  healthyEndpointCount: number;
  machineCount: number;
  currentRequests: number;
  availableCapacityPct: number;
  peakUtilizationPct: number;
  policyHeadroomTargetPct: number;
}

// TODO(backend): Replace with a real query (e.g. GET /api/organizations/:id/models) reading
// registered model endpoints and their live health-check results from the control plane.
export async function listModelEndpoints(): Promise<ModelEndpoint[]> {
  return [
    { title: "Reasoning Primary", model: "Northstar-35B-A3B", runtime: "vLLM", role: "Primary reasoning", contextWindow: "128K", machine: "AI-NODE-01", environment: "Production", tone: "good", lastCheckedAgo: "12 sec" },
    { title: "General Assistant", model: "Northstar-27B", runtime: "Ollama", role: "General chat", contextWindow: "64K", machine: "AI-NODE-02", environment: "Production", tone: "good", lastCheckedAgo: "12 sec" },
    { title: "Fast Utility", model: "Northstar-4B", runtime: "Ollama", role: "Extraction & routing", contextWindow: "32K", machine: "AI-NODE-01", environment: "Production", tone: "good", lastCheckedAgo: "12 sec" },
    { title: "Reasoning Staging", model: "Northstar-35B-A3B", runtime: "vLLM", role: "Primary reasoning", contextWindow: "128K", machine: "AI-STAGE-01", environment: "Staging", tone: "warn", lastCheckedAgo: "4 min" },
  ];
}

// TODO(backend): Replace with a real aggregate computed from live endpoint health and request
// throughput, rather than fixed mock figures.
export async function getModelCapacity(): Promise<ModelCapacity> {
  return {
    healthyEndpointCount: 6,
    machineCount: 3,
    currentRequests: 18,
    availableCapacityPct: 64,
    peakUtilizationPct: 78,
    policyHeadroomTargetPct: 20,
  };
}

// TODO(backend): Replace with a real mutation (e.g. POST /api/organizations/:id/models) that
// registers a new Ollama/vLLM/OpenAI-compatible endpoint, verifies reachability, and runs an
// initial health test before making it selectable in policy configuration.
export async function registerModelEndpoint(_input: {
  endpointUrl: string;
  runtime: "vLLM" | "Ollama" | "OpenAI-compatible";
}): Promise<{ ok: boolean }> {
  return { ok: true };
}
