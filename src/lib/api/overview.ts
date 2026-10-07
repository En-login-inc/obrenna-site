import type { StatusTone } from './types';
import { readJson } from './portal-client';

export interface OverviewMetric {
  icon: string;
  label: string;
  value: string;
  sub: string;
  trend: string;
  tone: StatusTone;
}

export interface ActivityItem {
  icon: string;
  title: string;
  sub: string;
  time: string;
  tone: StatusTone;
}

export interface OverviewData {
  tiles: {
    activeMembers: number;
    enrolledMachines: number;
    machinesOnline: number;
    healthyModelEndpoints: number;
    mcpServers: number;
    toolsPendingReview: number;
  };
  recentActivity: Array<{
    id: string;
    event_type: string;
    summary: string;
    actor_user_id: string | null;
    actor_machine_id: string | null;
    created_at: string;
  }>;
}

export async function getOverview(): Promise<OverviewData> {
  const body = await readJson<OverviewData & { ok: true }>('/api/portal/overview', { method: 'GET' }, 'Could not load the organization overview');
  return { tiles: body.tiles, recentActivity: body.recentActivity };
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Unknown time';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}