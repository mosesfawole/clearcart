import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiMode, interpretRequest, requestConstraints } from '../src/lib/intent';
import { effectiveBudget, recommendBasket, type Intent } from '../src/lib/basket';
import type { Category } from '../src/lib/catalog';
import { apiError, assertSameOrigin, newSession, rateLimit, readBody, readSession } from '../src/lib/http';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function geminiResponse(intent: Intent) {
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(intent) }] } }] });
}

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

describe('Gemini starter task scope', () => {
  it.each<{
    request: string; returned: Category[]; expected: Category[]; budgetCents: number; totalCents: number;
  }>([
    { request: 'A lightweight travel kit under $75, no leather', returned: ['bag', 'bottle', 'charger', 'notebook'], expected: ['bag', 'bottle', 'charger'], budgetCents: 7500, totalCents: 7400 },
    { request: '  a   lightweight TRAVEL kit under $75, no leather  ', returned: ['bag', 'bottle', 'charger', 'notebook'], expected: ['bag', 'bottle', 'charger'], budgetCents: 7500, totalCents: 7400 },
    { request: 'A notebook and lamp to refresh my desk under $65', returned: ['notebook', 'lamp', 'bag'], expected: ['notebook', 'lamp'], budgetCents: 6500, totalCents: 4300 },
    { request: 'A thoughtful bottle and notebook gift under $40', returned: ['bottle', 'notebook', 'charger'], expected: ['bottle', 'notebook'], budgetCents: 4000, totalCents: 3200 },
  ])('keeps the advertised starter basket for $request despite an unsolicited category', async ({ request, returned, expected, budgetCents, totalCents }) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: returned, preferredProductIds: [], explanation: 'Suggested essentials.' }));

    const intent = await interpretRequest(request);
    const basket = recommendBasket(intent, budgetCents, { lightweight: true, leatherFree: true });

    expect(basket.lines.map((line) => line.category)).toEqual(expected);
    expect(basket.totalCents).toBe(totalCents);
  });
  it.each([
    'A lightweight travel kit under $75, no leather.',
    'A lightweight travel kit under $75, no leather!',
    'A lightweight travel kit under $75, no leather?',
  ])('recognizes sentence punctuation on the starter request %s', async (request) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['bag', 'bottle', 'charger', 'notebook'], preferredProductIds: [], explanation: '' }));

    expect(recommendBasket(await interpretRequest(request), 7500, { lightweight: true, leatherFree: true }).totalCents).toBe(7400);
  });
  it('keeps every starter category when a valid Gemini response omits an essential', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['bag', 'bottle'], preferredProductIds: [], explanation: '' }));

    const basket = recommendBasket(await interpretRequest('A lightweight travel kit under $75, no leather'), 7500, { lightweight: true, leatherFree: true });

    expect(basket.lines.map((line) => line.productId)).toEqual(['daypack', 'steel-bottle', 'travel-charger']);
    expect(basket.totalCents).toBe(7400);
  });
  it('preserves Gemini preferences within the starter categories', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['notebook', 'lamp', 'bag'], preferredProductIds: ['desk-notebook', 'leather-bag'], explanation: '' }));

    const intent = await interpretRequest('A notebook and lamp to refresh my desk under $65');
    const basket = recommendBasket(intent, 6500, { lightweight: false, leatherFree: true });

    expect(intent.preferredProductIds).toEqual(['desk-notebook']);
    expect(basket.lines.map((line) => line.productId)).toEqual(['desk-notebook', 'task-lamp']);
    expect(basket.totalCents).toBe(5000);
  });
  it.each([
    'A lightweight travel kit under $75, no leather, plus a notebook',
    'A lightweight travel kit with a notebook, no leather',
  ])('retains an explicit additional category in custom request %s', async (request) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['bag', 'bottle', 'charger', 'notebook'], preferredProductIds: [], explanation: '' }));

    const intent = await interpretRequest(request);

    expect(() => recommendBasket(intent, effectiveBudget(request, 7500), { lightweight: true, leatherFree: true })).toThrow(/\$83\.00/);
    const affordableRequest = request.replace('under $75', 'under $83');
    const basket = recommendBasket(await interpretRequest(affordableRequest), effectiveBudget(affordableRequest, 8300), { lightweight: true, leatherFree: true });
    expect(basket.lines.map((line) => line.category)).toEqual(['bag', 'bottle', 'charger', 'notebook']);
    expect(basket.totalCents).toBe(8300);
  });
  it('keeps custom negations outside the exact starter contract', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['bottle', 'charger'], preferredProductIds: [], explanation: '' }));

    const basket = recommendBasket(await interpretRequest('A lightweight travel kit under $75, no leather, no bag'), 7500, { lightweight: true, leatherFree: true });

    expect(basket.lines.map((line) => line.category)).toEqual(['bottle', 'charger']);
    expect(basket.totalCents).toBe(4700);
  });
  it('rejects a starter basket when its genuine minimum exceeds a reduced budget', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => geminiResponse({ categories: ['bag', 'bottle', 'charger', 'notebook'], preferredProductIds: [], explanation: '' }));

    const intent = await interpretRequest('A lightweight travel kit under $75, no leather');

    expect(() => recommendBasket(intent, 5000, { lightweight: true, leatherFree: true })).toThrow(/\$74\.00/);
  });
  it.each([
    { status: 429, body: { error: 'provider failure' } },
    { status: 200, body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] } },
  ])('does not replace failed or invalid Gemini responses with a starter basket %#', async ({ status, body }) => {
    vi.stubEnv('GEMINI_API_KEY', 'controlled-test-key');
    vi.stubGlobal('fetch', async () => Response.json(body, { status }));

    await expect(interpretRequest('A lightweight travel kit under $75, no leather')).rejects.toThrow(/Gemini/);
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
  it('uses the public Host when Next rewrites the request URL to internal localhost', () => {
    const request = new Request('http://localhost:3000/api/recommend', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
  it.each(['http://localhost:3000', 'http://evil.test', 'http://127.0.0.1:3001', 'https://127.0.0.1:3000'])('rejects an Origin that differs from the exact public host and protocol: %s', (origin) => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/recommend', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin },
    }))).toThrow(/origin/i);
  });
  it('requires a POST Origin even when the public Host is supplied', () => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/recommend', {
      method: 'POST', headers: { host: '127.0.0.1:3000' },
    }))).toThrow(/origin/i);
  });
  it('uses the request protocol for HTTPS and supports IPv6 public hosts', () => {
    expect(() => assertSameOrigin(new Request('https://localhost:3000/api/recommend', {
      method: 'POST', headers: { host: '[::1]:3000', origin: 'https://[::1]:3000' },
    }))).not.toThrow();
  });
  it.each(['127.0.0.1:3000/path', 'user@127.0.0.1:3000', '127.0.0.1:3000,evil.test', '127.0.0.1:3000?query', ''])('rejects malformed Host authorities: %s', (host) => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/recommend', {
      method: 'POST', headers: { host, origin: 'http://localhost:3000' },
    }))).toThrow(/origin/i);
  });
  it('does not use untrusted forwarded host or protocol headers to accept a foreign origin', () => {
    expect(() => assertSameOrigin(new Request('http://localhost:3000/api/recommend', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'https://evil.test', 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'https' },
    }))).toThrow(/origin/i);
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
