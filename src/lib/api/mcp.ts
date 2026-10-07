import { readJson, mutation } from './portal-client';
import type { MutationResult } from './mutation-result';

export interface McpServerRow {
  id: string;
  org_id: string;
  display_name: string;
  transport: string;
  url: string | null;
  status: string;
  created_at: string;
  tool_count: number;
  enabled_tool_count: number;
  tools_pending_review: number;
}

export interface McpDiscoveryResult {
  server: McpServerRow;
  diff: { added: string[]; removed: string[] };
  error: string | null;
}

export async function listMcpServers(): Promise<McpServerRow[]> {
  const body = await readJson<{ ok: true; servers: McpServerRow[] }>('/api/portal/mcp-servers', { method: 'GET' }, 'Could not load MCP servers');
  return body.servers;
}

export interface McpRegistration {
  server: McpServerRow;
  registration: {
    status: 'ready' | 'failed';
    error: string | null;
    tools_discovered: string[];
  };
}

export async function addMcpServer(input: {
  name: string;
  endpoint: string;
}): Promise<MutationResult> {
  return mutation('/api/portal/mcp-servers/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  }, 'Could not register this MCP server');
}

export async function discoverTools(serverId: string): Promise<MutationResult> {
  return mutation('/api/portal/mcp-servers/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ server_id: serverId }),
  }, 'Could not run tool discovery');
}

export async function approveSchemaChange(serverId: string, toolName: string): Promise<MutationResult> {
  return mutation('/api/portal/mcp-servers/approve-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ server_id: serverId, tool_name: toolName }),
  }, 'Could not approve this tool');
}