import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/lib/store';
import { SampleGateway } from '../src/lib/paypal';

const shared = vi.hoisted(() => ({ store: null as Store | null }));
vi.mock('../src/lib/store', async (original) => ({
  ...await original<typeof import('../src/lib/store')>(),
  getStore: () => shared.store!,
}));
vi.mock('../src/lib/paypal', async (original) => ({
  ...await original<typeof import('../src/lib/paypal')>(),
  getGateway: () => new SampleGateway(),
}));

import { GET as config } from '../src/app/api/config/route';
import { POST as recommend } from '../src/app/api/recommend/route';
import { POST as checkout } from '../src/app/api/checkout/route';
import { POST as capture } from '../src/app/api/capture/route';

let cookie = '';
function post(path: string, body: unknown, origin = 'http://localhost:3000', sessionCookie = cookie) {
  return new Request(`http://localhost:3000/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: sessionCookie },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  shared.store?.close();
  shared.store = new Store(':memory:');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('PAYPAL_CLIENT_ID', '');
  vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
  const response = await config(new Request('http://localhost:3000/api/config'));
  cookie = response.headers.get('set-cookie')!.split(';')[0];
});
afterAll(() => { shared.store?.close(); vi.unstubAllEnvs(); });

describe('storefront HTTP contract', () => {
  it('provides modes and an opaque HTTP-only session without exposing keys', async () => {
    const response = await config(new Request('https://localhost/api/config'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/);
    expect(response.headers.get('set-cookie')).toMatch(/Secure/);
    const body = await response.json();
    expect(body.aiMode).toBe('sample');
    expect(body.paymentMode).toBe('sample');
    expect(body.catalog).toHaveLength(12);
    expect(Object.keys(body).sort()).toEqual(['aiMode', 'catalog', 'model', 'paymentMode']);
  });

  it('enforces typed constraints and the stricter text budget then verifies one sample receipt', async () => {
    const response = await recommend(post('recommend', {
      request: 'A lightweight travel kit under $75, no-leather', budgetCents: 10000,
      constraints: { lightweight: false, leatherFree: false },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.quote).toMatchObject({ totalCents: 7400, budgetCents: 7500, constraints: { lightweight: true, leatherFree: true } });
    expect(body.quote).not.toHaveProperty('sessionId');
    const start = await checkout(post('checkout', { quoteId: body.quote.id }));
    expect(start.status).toBe(200);
    const order = await start.json();
    expect(order.mode).toBe('sample');
    expect(order).not.toHaveProperty('receipt');
    const paid = await capture(post('capture', { orderId: order.orderId }));
    expect(paid.status).toBe(200);
    const receipt = (await paid.json()).receipt;
    expect(receipt).toMatchObject({ amountCents: 7400, currency: 'USD', mode: 'sample' });
    const repeated = await capture(post('capture', { orderId: order.orderId }));
    expect((await repeated.json()).receipt.id).toBe(receipt.id);
  });

  it('rejects cross-origin or sessionless mutation requests', async () => {
    const body = { quoteId: crypto.randomUUID() };
    expect((await checkout(post('checkout', body, 'https://unrelated.example'))).status).toBeGreaterThanOrEqual(400);
    expect((await checkout(post('checkout', body, 'http://localhost:3000', ''))).status).toBeGreaterThanOrEqual(400);
  });

  it('rejects a cross-origin config request without creating a session', async () => {
    const response = await config(new Request('http://localhost:3000/api/config', { headers: { Origin: 'https://unrelated.example' } }));
    expect(response.status).toBe(400);
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('gives sessionless shoppers a useful recovery message', async () => {
    const response = await checkout(post('checkout', { quoteId: crypto.randomUUID() }, 'http://localhost:3000', ''));
    expect((await response.json()).error).toMatch(/session.*expired/i);
  });

  it('rejects an oversized body before interpreting a request', async () => {
    const response = await recommend(post('recommend', {
      request: 'travel ' + 'a'.repeat(5000), budgetCents: 7500,
      constraints: { lightweight: true, leatherFree: true },
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/too large/i);
  });

  it('rejects browser-supplied prices and malformed constraints', async () => {
    const body = { request: 'Travel kit', budgetCents: 7500, constraints: { lightweight: true, leatherFree: true } };
    expect((await recommend(post('recommend', { ...body, totalCents: 1 }))).status).toBe(400);
    expect((await recommend(post('recommend', { ...body, constraints: { ...body.constraints, priceCents: 1 } }))).status).toBe(400);
  });

  it('rejects unexpected checkout and capture fields', async () => {
    expect((await checkout(post('checkout', { quoteId: crypto.randomUUID(), approvalUrl: 'https://unrelated.example' }))).status).toBe(400);
    expect((await capture(post('capture', { orderId: crypto.randomUUID(), status: 'paid' }))).status).toBe(400);
  });

  it('reports partial payment configuration instead of advertising sandbox', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'configured');
    const response = await config(new Request('http://localhost:3000/api/config'));
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty('error');
  });
});
