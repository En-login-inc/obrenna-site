import { controlPlaneConfig, controlPlaneConfigured, signPortalAssertion, type ControlPlaneSession } from './control-plane-config.ts';

export type PortalErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'unavailable';

export class PortalApiError extends Error {
  kind: PortalErrorKind;
  status: number;

  constructor(kind: PortalErrorKind, message: string, status = 502) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  binary?: false;
};

export type BinaryRequest = {
  method?: 'GET';
  binary: true;
};

type AnyOptions = RequestOptions | BinaryRequest;

function kindForStatus(status: number): PortalErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 422) return 'validation';
  return 'unavailable';
}

function safeMessageForStatus(status: number): string {
  switch (kindForStatus(status)) {
    case 'unauthorized': return 'Your organization session is no longer valid';
    case 'forbidden': return 'You do not have permission to perform this action';
    case 'not_found': return 'The requested organization resource was not found';
    case 'validation': return 'The request did not pass validation';
    case 'unavailable': return 'The organization control plane is temporarily unavailable';
  }
}

function isBinary(options: AnyOptions): options is BinaryRequest {
  return (options as BinaryRequest).binary === true;
}

/**
 * Server-side call into the FastAPI control plane, authenticated by the
 * short-lived signed portal assertion. Never returns raw provider errors
 * to the browser; secrets never leave this module.
 */
export async function controlPlaneRequest<T>(
  session: ControlPlaneSession,
  path: string,
  options: AnyOptions = {},
): Promise<{ data: T; contentType: string; bytes?: ArrayBuffer }> {
  if (!controlPlaneConfigured()) {
    throw new PortalApiError('unavailable', 'The organization control plane is not configured');
  }
  const config = controlPlaneConfig();
  const assertion = await signPortalAssertion(session);
  const method = options.method ?? 'GET';
  const hasBody = !isBinary(options) && options.body !== undefined;
  const bodyValue = hasBody ? (options as RequestOptions).body : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${assertion}`,
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(bodyValue) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      // Upstream detail can contain provider diagnostics, URLs, or secret
      // material. Keep the browser-facing message stable and content-free.
      throw new PortalApiError(kindForStatus(response.status), safeMessageForStatus(response.status), response.status);
    }

    if (isBinary(options)) {
      const bytes = await response.arrayBuffer();
      return { data: undefined as T, contentType: response.headers.get('content-type') ?? 'application/octet-stream', bytes };
    }

    const data = (await response.json()) as T;
    return { data, contentType: response.headers.get('content-type') ?? 'application/json' };
  } catch (error) {
    if (error instanceof PortalApiError) throw error;
    throw new PortalApiError('unavailable', 'The organization control plane is unreachable');
  } finally {
    // Keep the deadline active while consuming the body. A fetch promise can
    // resolve at response headers and otherwise leave a stalled JSON/export
    // body outside the advertised request timeout.
    clearTimeout(timer);
  }
}
