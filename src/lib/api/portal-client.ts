import type { MutationResult } from './mutation-result';

export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral' | 'teal';

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : fallback;
}

async function mutation(url: string, init: RequestInit, fallback: string): Promise<MutationResult> {
  try {
    const response = await fetch(url, { credentials: 'include', ...init });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
      return { ok: false, message: typeof body.error === 'string' ? body.error : fallback };
    }
    return { ok: true, data: body };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : fallback };
  }
}

async function readJson<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return body as T;
}

export { readError, readJson, mutation };