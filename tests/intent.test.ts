import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiMode, interpretRequest, requestConstraints } from '../src/lib/intent';
import { apiError, assertSameOrigin, newSession, rateLimit, readBody, readSession } from '../src/lib/http';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('request intent', () => {
  it('uses sample travel categories when no key exists', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(aiMode()).toBe('sample');
    expect(await interpretRequest('A lightweight travel kit')).toMatchObject({ categories: ['bag', 'bottle', 'charger'], preferredProductIds: [] });
  });
  it.each([
    ['work at my desk', ['notebook', 'lamp']], ['study', ['notebook', 'lamp']],
    ['focus with music', ['headphones', 'notebook']], ['gifts', ['bottle', 'notebook']],
    ['a backpack and headphones', ['bag', 'headphones']],
  ])('maps supported sample request %s', async (text, categories) => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await interpretRequest(text)).categories).toEqual(categories);
  });
  it('rejects gibberish and oversized requests with helpful errors', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(interpretRequest('zxqv 981')).rejects.toThrow(/request|travel|categor/i);
    await expect(interpretRequest('bag'.repeat(401))).rejects.toThrow(/1200|long/i);
  });
  it.each(['NO-LEATHER and LIGHT-WEIGHT', 'leather-free lightweight', 'No leather light weight'])('enforces typed material and weight constraints for %s', (text) => {
    expect(requestConstraints(text, { leatherFree: false, lightweight: false })).toEqual({ leatherFree: true, lightweight: true });
  });
  it('cannot weaken explicitly checked constraints', () => {
    expect(requestConstraints('heavy leather bag', { leatherFree: true, lightweight: true })).toEqual({ leatherFree: true, lightweight: true });
  });
  it('sends intent-only structured data to the fixed Gemini host with key header', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'ignore this' }, { text: JSON.stringify({ categories: ['bottle'], preferredProductIds: ['steel-bottle'], explanation: 'Reusable for travel.' }) }] } }] });
    });
    expect(aiMode()).toBe('gemini');
    expect(await interpretRequest('water bottle')).toEqual({ categories: ['bottle'], preferredProductIds: ['steel-bottle'], explanation: 'Reusable for travel.' });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(new Headers(calls[0].init.headers).get('x-goog-api-key')).toBe('controlled-test-key');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 1500 });
    expect(body.generationConfig.responseJsonSchema.properties.categories.items.enum).toEqual(['bag', 'bottle', 'charger', 'headphones', 'notebook', 'lamp']);
    expect(body.systemInstruction.parts[0].text).toMatch(/untrusted|data/i);
    expect(body.contents[0].parts[0].text).toContain('steel-bottle');
    expect(body.contents[0].parts[0].text).not.toContain('priceCents');
  });
  it.each([
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] },
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: '{}' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"categories":["fake"],"preferredProductIds":[],"explanation":"x"}' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"categories":["bag"],"preferredProductIds":["fake"],"explanation":"x"}' }] } }] },
  ])('fails closed for malformed or blocked Gemini output %#', async (response) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => Response.json(response));
    await expect(interpretRequest('travel')).rejects.toThrow(/Gemini|interpret/i);
  });
  it('surfaces quota errors without sample fallback or provider secrets', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => Response.json({ error: 'secret upstream body' }, { status: 429 }));
    await expect(interpretRequest('travel')).rejects.toThrow(/quota|busy|later/i);
    try { await interpretRequest('travel'); } catch (error) { expect(String(error)).not.toContain('secret upstream body'); }
  });
  it('rejects a model name that could alter the provider URL', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key'); vi.stubEnv('GEMINI_MODEL', '../evil?key=secret');
    await expect(interpretRequest('bag')).rejects.toThrow(/configur|model/i);
  });
  it.each([
    { categories: [], preferredProductIds: [], explanation: '' },
    { categories: ['bag'], preferredProductIds: [], explanation: 'x'.repeat(301) },
    { categories: ['bag'], preferredProductIds: Array(13).fill('daypack'), explanation: '' },
  ])('rejects response schema boundary violation %#', async (intent) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(intent) }] } }] }));
    await expect(interpretRequest('bag')).rejects.toThrow(/Gemini|invalid/i);
  });
  it('reports an unavailable Gemini network without a sample fallback', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => { throw new Error('network raw secret'); });
    await expect(interpretRequest('travel')).rejects.toThrow(/Gemini.*timed out/i);
  });
});

describe('HTTP boundaries', () => {
  it('creates opaque session UUIDs and accepts only that cookie form', () => {
    const id = newSession();
    expect(id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(readSession(new Request('http://localhost/', { headers: { cookie: `other=1; clearcart-session=${id}` } }))).toBe(id);
    expect(readSession(new Request('http://localhost/', { headers: { cookie: 'clearcart-session=forged' } }))).toBeNull();
  });
  it('rejects cross-origin and missing-origin POSTs', () => {
    expect(() => assertSameOrigin(new Request('http://localhost/api', { method: 'POST' }))).toThrow(/origin/i);
    expect(() => assertSameOrigin(new Request('http://localhost/api', { method: 'POST', headers: { origin: 'http://evil.test' } }))).toThrow(/origin/i);
    expect(() => assertSameOrigin(new Request('http://localhost/api', { method: 'POST', headers: { origin: 'http://localhost' } }))).not.toThrow();
  });
  it('bounds request bodies and rejects malformed JSON', async () => {
    expect(await readBody(new Request('http://localhost/', { method: 'POST', body: '{"text":"bag"}' }))).toEqual({ text: 'bag' });
    await expect(readBody(new Request('http://localhost/', { method: 'POST', body: 'x'.repeat(4097) }))).rejects.toThrow(/large|4096/i);
    await expect(readBody(new Request('http://localhost/', { method: 'POST', body: '{oops' }))).rejects.toThrow(/JSON|body/i);
  });
  it('limits AI requests per session and permits a new minute', () => {
    vi.useFakeTimers();
    const id = newSession();
    for (let i = 0; i < 10; i++) rateLimit(id);
    expect(() => rateLimit(id)).toThrow(/many|minute|limit/i);
    expect(() => rateLimit(newSession())).not.toThrow();
    vi.advanceTimersByTime(60_001);
    expect(() => rateLimit(id)).not.toThrow();
  });
  it('redacts arbitrary errors and returns safe configuration errors', async () => {
    const result = apiError(new Error('raw-secret-upstream-payload'));
    expect(result.status).toBe(400);
    expect(await result.text()).not.toContain('raw-secret-upstream-payload');
  });
  it('rejects ambiguous duplicate session cookies', () => {
    const first = newSession(); const second = newSession();
    expect(readSession(new Request('http://localhost/', { headers: { cookie: `clearcart-session=${first}; clearcart-session=${second}` } }))).toBeNull();
  });
});
