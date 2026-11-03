import { randomUUID } from 'node:crypto';

// Only deliberately authored messages may cross the HTTP boundary.
export class UserError extends Error {}
export class ConfigurationError extends UserError {}

export function newSession(): string { return randomUUID(); }

export function readSession(request: Request): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';')
    .map((value) => value.trim()).filter((value) => value.startsWith('clearcart-session='));
  if (values.length !== 1) return null;
  const id = values[0].slice('clearcart-session='.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const requestUrl = new URL(request.url);
  const host = request.headers.get('host');
  let expectedOrigin = requestUrl.origin;
  if (host !== null) {
    // Next may expose an internal localhost URL while preserving the public Host.
    // Host is one authority, never a URL or a list; forwarded headers are not trusted.
    try {
      if (!host || /[\s,/\\@?#%]/.test(host) || !['http:', 'https:'].includes(requestUrl.protocol)) throw new Error();
      const publicUrl = new URL(`${requestUrl.protocol}//${host}`);
      if (!publicUrl.hostname) throw new Error();
      expectedOrigin = publicUrl.origin;
    } catch { throw new UserError('Request origin is not allowed. Reload ClearCart and try again.'); }
  }
  if ((!origin && request.method === 'POST') || (origin && origin !== expectedOrigin)) {
    throw new UserError('Request origin is not allowed. Reload ClearCart and try again.');
  }
}

export async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new UserError('Request body must be valid JSON.');
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (text.length > 4096 || bytes > 16384) {
        await reader.cancel();
        throw new UserError('Request body is too large; use at most 4096 characters.');
      }
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  if (text.length > 4096) throw new UserError('Request body is too large; use at most 4096 characters.');
  try { return JSON.parse(text); }
  catch { throw new UserError('Request body must be valid JSON.'); }
}

const limits = new Map<string, { count: number; expires: number }>();
export function rateLimit(sessionId: string): void {
  const now = Date.now();
  for (const [id, entry] of limits) if (entry.expires <= now) limits.delete(id);
  const existing = limits.get(sessionId);
  if (existing && existing.count >= 10) throw new UserError('Too many AI requests. Try again in a minute.');
  // Refuse new sessions at capacity rather than evicting an active limiter.
  if (!existing && limits.size >= 10000) throw new UserError('AI requests are busy. Try again in a minute.');
  limits.set(sessionId, { count: (existing?.count ?? 0) + 1, expires: existing?.expires ?? now + 60000 });
}

export function apiError(error: unknown): Response {
  // Basket errors are authored deterministic validations, never provider data.
  const basketValidation = error instanceof Error && /^(Budget must be|Choose at least one valid product category\.|Preferred product IDs must|Material and weight constraints|No in-stock (?:bag|bottle|charger|headphones|notebook|lamp) meets|A complete basket needs|Text budget must|Budget request must)/.test(error.message);
  const message = error instanceof UserError || basketValidation ? (error as Error).message : 'Request could not be completed. Check your input and try again.';
  return Response.json({ error: message }, { status: error instanceof ConfigurationError ? 503 : 400 });
}
