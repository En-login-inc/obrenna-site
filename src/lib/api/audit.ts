import { readJson } from './portal-client';
import type { StatusTone } from './types';

export interface AuditEventRow {
  id: string;
  event_type: string;
  summary: string;
  actor_user_id: string | null;
  actor_machine_id: string | null;
  created_at: string;
}

export function decisionFor(event: AuditEventRow): { label: string; tone: StatusTone } {
  switch (event.event_type) {
    case 'tool_confirmation': return { label: 'Approved', tone: 'good' };
    case 'tool_denied': return { label: 'Denied', tone: 'bad' };
    case 'mcp_discovery': return { label: 'Schema change', tone: 'warn' };
    case 'machine_revoked': return { label: 'Revoked', tone: 'neutral' };
    default: return { label: event.event_type.replaceAll('_', ' '), tone: 'neutral' };
  }
}

export interface AuditPage {
  events: AuditEventRow[];
  nextCursor: string | null;
}

export async function listAuditEvents(cursor?: string | null): Promise<AuditPage> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const body = await readJson<{ ok: true; events: AuditEventRow[]; next_cursor: string | null }>(
    `/api/portal/audit${suffix}`, { method: 'GET' }, 'Could not load the audit log',
  );
  return { events: body.events, nextCursor: body.next_cursor };
}

export async function exportAuditMetadata(): Promise<void> {
  const response = await fetch('/api/portal/audit/export', { method: 'GET', credentials: 'include' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === 'string' ? body.error : 'Could not export audit metadata');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'audit-log.json';
  anchor.click();
  URL.revokeObjectURL(url);
}