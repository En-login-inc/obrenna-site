export function buildError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function sanitizeString(value: string | null | undefined, maxLength = 160) {
  if (!value) return '';
  return value.trim().slice(0, maxLength);
}

export function getCookieValue(headerValue: string | null | undefined, key: string) {
  if (!headerValue) return null;

  for (const part of headerValue.split(';')) {
    const [cookieKey, ...rest] = part.trim().split('=');
    if (cookieKey === key) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return null;
}
