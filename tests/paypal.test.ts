import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendBasket } from '../src/lib/basket';
import { apiError } from '../src/lib/http';
import { getGateway, paymentMode, SandboxGateway } from '../src/lib/paypal';
import type { Order } from '../src/lib/store';

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const order = (): Order => ({
  id: 'local-order-1', quoteId: 'quote-1', sessionId: 'owner', mode: 'sandbox', providerOrderId: 'PAYPALORDER123',
  approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDER123', state: 'pending',
  createRequestId: '669e0cda-3b06-4c0c-8c5c-01d5767d6354', captureRequestId: '11141a60-81c7-475d-8e80-bb4a681ad486', createdAt: '2026-11-03T12:00:00.000Z', receipt: null,
  basket: recommendBasket({ categories: ['bag', 'bottle', 'charger'], preferredProductIds: [], explanation: '' }, 7500, { leatherFree: true, lightweight: true }),
});
const approved = () => ({
  id: 'PAYPALORDER123', intent: 'CAPTURE', status: 'APPROVED',
  purchase_units: [{ reference_id: 'local-order-1', custom_id: 'local-order-1', amount: { currency_code: 'USD', value: '74.00' } }],
  payer: { payer_id: 'TESTPAYER', name: { given_name: 'Test', surname: 'Buyer' }, email_address: 'buyer@example.test' },
  links: [{ href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPALORDER123', rel: 'self', method: 'GET' }],
});
const completed = () => ({ ...approved(), status: 'COMPLETED', purchase_units: [{
  ...approved().purchase_units[0], payments: { captures: [{
    id: 'CAPTURE123', status: 'COMPLETED', amount: { currency_code: 'USD', value: '74.00' }, final_capture: true,
    seller_protection: { status: 'ELIGIBLE' }, create_time: '2026-11-03T12:05:00Z', update_time: '2026-11-03T12:05:00Z',
    links: [{ href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE123', rel: 'self', method: 'GET' }],
  }] },
}] });
type Step = { method: string; path: string; status?: number; body: unknown };
function network(steps: Step[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    const step = steps.shift();
    if (!step) throw new Error('Unexpected network call');
    expect(url).toBe(`https://api-m.sandbox.paypal.com${step.path}`);
    expect(init.method).toBe(step.method);
    expect(init.redirect).toBe('error');
    return Response.json(step.body, { status: step.status ?? 200 });
  };
  const adapter = new SandboxGateway({ clientId: 'test-client', clientSecret: 'test-secret', appUrl: 'http://localhost:3000', fetch });
  return { adapter, calls, steps };
}
const token: Step = { method: 'POST', path: '/v1/oauth2/token', body: { access_token: 'controlled-access-token', token_type: 'Bearer', expires_in: 3600 } };
const get = (body: unknown): Step => ({ method: 'GET', path: '/v2/checkout/orders/PAYPALORDER123', body });
const capture = (body: unknown, status = 201): Step => ({ method: 'POST', path: '/v2/checkout/orders/PAYPALORDER123/capture', status, body });

describe('payment configuration', () => {
  it('uses sample only with neither credential, sandbox with both, and errors for a partial configuration', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', ''); vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    expect(paymentMode()).toBe('sample'); expect(getGateway().mode).toBe('sample');
    vi.stubEnv('PAYPAL_CLIENT_ID', 'test-client');
    let error;
    try { paymentMode(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect(String(error)).toMatch(/configur|both/i);
    expect(apiError(error).status).toBe(503);
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'test-secret'); expect(paymentMode()).toBe('sandbox');
  });
  it.each(['https://example.test/path', 'javascript:alert(1)', 'https://user:password@example.test', 'https://example.test/?token=secret'])('rejects an APP_URL that is not a plain origin: %s', (appUrl) => {
    expect(() => new SandboxGateway({ clientId: 'test-client', clientSecret: 'test-secret', appUrl })).toThrow(/APP_URL|origin|configur/i);
  });
});

describe('sandbox order creation', () => {
  it('sends immutable server cents with modern PayPal experience context and stable request ID', async () => {
    const net = network([token, { method: 'POST', path: '/v2/checkout/orders', status: 201, body: { ...approved(), status: 'PAYER_ACTION_REQUIRED', links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDER123', rel: 'payer-action', method: 'GET' }] } }]);
    expect(await net.adapter.create(order())).toEqual({ providerOrderId: 'PAYPALORDER123', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDER123' });
    const oauth = net.calls[0].init;
    expect(new Headers(oauth.headers).get('Authorization')).toBe(`Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
    expect(oauth.body).toBe('grant_type=client_credentials');
    const request = net.calls[1].init; const headers = new Headers(request.headers); const body = JSON.parse(request.body as string);
    expect(headers.get('PayPal-Request-Id')).toBe('669e0cda-3b06-4c0c-8c5c-01d5767d6354');
    expect(headers.get('Prefer')).toBe('return=representation');
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units).toEqual([{ reference_id: 'local-order-1', custom_id: 'local-order-1', amount: { currency_code: 'USD', value: '74.00' } }]);
    expect(body.payment_source.paypal.experience_context).toEqual({ brand_name: 'ClearCart Sandbox', user_action: 'PAY_NOW', payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED', shipping_preference: 'NO_SHIPPING', return_url: 'http://localhost:3000/?checkout=return&orderId=local-order-1', cancel_url: 'http://localhost:3000/?checkout=cancel&orderId=local-order-1' });
    expect(body.application_context).toBeUndefined(); expect(JSON.stringify(body)).not.toContain('owner');
    expect(net.steps).toHaveLength(0);
  });
  it('accepts the alternate sandbox approve link', async () => {
    const net = network([token, { method: 'POST', path: '/v2/checkout/orders', status: 201, body: { ...approved(), links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/checkoutnow?token=PAYPALORDER123' }] } }]);
    expect((await net.adapter.create(order())).approvalUrl).toBe('https://sandbox.paypal.com/checkoutnow?token=PAYPALORDER123');
  });
  it.each(['https://www.paypal.com/checkoutnow', 'https://www.sandbox.paypal.com.evil.test/checkoutnow', 'http://www.sandbox.paypal.com/checkoutnow', 'https://user:pass@www.sandbox.paypal.com/checkoutnow'])('rejects unsafe approval link %s', async (href) => {
    const net = network([token, { method: 'POST', path: '/v2/checkout/orders', body: { ...approved(), links: [{ rel: 'approve', href }] } }]);
    await expect(net.adapter.create(order())).rejects.toThrow(/approval|sandbox|invalid/i);
  });
  it('rejects unsafe provider IDs', async () => {
    const net = network([token, { method: 'POST', path: '/v2/checkout/orders', body: { ...approved(), id: '../evil', links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/checkoutnow' }] } }]);
    await expect(net.adapter.create(order())).rejects.toThrow(/order|invalid/i);
  });
});

describe('sandbox payment evidence', () => {
  it('verifies before capture, captures with its stable UUID and reconciles a fresh completed GET', async () => {
    const net = network([token, get(approved()), capture(completed()), get(completed())]);
    expect(await net.adapter.capture(order())).toEqual({ orderId: 'PAYPALORDER123', customId: 'local-order-1', orderStatus: 'COMPLETED', captureId: 'CAPTURE123', captureStatus: 'COMPLETED', amountCents: 7400, currency: 'USD' });
    expect(new Headers(net.calls[2].init.headers).get('PayPal-Request-Id')).toBe('11141a60-81c7-475d-8e80-bb4a681ad486');
    expect(new Headers(net.calls[2].init.headers).get('Prefer')).toBe('return=representation');
    expect(net.steps).toHaveLength(0);
  });
  it.each([
    { id: 'OTHERORDER' },
    { purchase_units: [{ ...approved().purchase_units[0], custom_id: 'other-local-id' }] },
    { purchase_units: [{ ...approved().purchase_units[0], amount: { currency_code: 'USD', value: '74.01' } }] },
    { purchase_units: [{ ...approved().purchase_units[0], amount: { currency_code: 'EUR', value: '74.00' } }] },
    { purchase_units: [approved().purchase_units[0], approved().purchase_units[0]] },
  ])('rejects a mismatched pre-capture GET without a capture call %j', async (changes) => {
    const net = network([token, get({ ...approved(), ...changes })]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/match|verif|payment|amount/i);
    expect(net.calls).toHaveLength(2);
    expect(net.calls.some((call) => call.url.endsWith('/capture'))).toBe(false);
  });
  it.each(['74.001', '7.4e1', '74', '-74.00', ' 74.00', '074.00'])('does not round or coerce arbitrary provider amounts: %s', async (value) => {
    const net = network([token, get({ ...approved(), purchase_units: [{ ...approved().purchase_units[0], amount: { currency_code: 'USD', value } }] })]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/amount|verif|match/i);
    expect(net.calls).toHaveLength(2);
  });
  it.each(['DECLINED', 'PENDING', 'FAILED'])('rejects nested capture %s even when the order says COMPLETED', async (status) => {
    const result = completed(); result.purchase_units[0].payments.captures[0].status = status;
    const net = network([token, get(approved()), capture(result), get(result)]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/complet|payment|capture/i);
  });
  it('rejects an ambiguous completed capture list', async () => {
    const result = completed(); result.purchase_units[0].payments.captures.push({ ...result.purchase_units[0].payments.captures[0], id: 'CAPTURE456' });
    const net = network([token, get(result)]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/capture|ambig|verif/i);
    expect(net.calls).toHaveLength(2);
  });
  it.each([{ currency_code: 'EUR', value: '74.00' }, { currency_code: 'USD', value: '70.00' }])('rejects mismatched nested capture amount %j', async (amount) => {
    const result = completed(); result.purchase_units[0].payments.captures[0].amount = amount;
    const net = network([token, get(result)]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/amount|match|verif/i);
  });
  it('reconciles ORDER_ALREADY_CAPTURED and other completed retries without another capture', async () => {
    const net = network([token, get(approved()), capture({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Already captured' }] }, 422), get(completed()), get(completed())]);
    const first = await net.adapter.capture(order()); const second = await net.adapter.capture(order());
    expect(first.captureId).toBe('CAPTURE123'); expect(second).toEqual(first);
    expect(net.calls.filter((call) => call.url.endsWith('/capture'))).toHaveLength(1);
    expect(net.calls.filter((call) => call.url.endsWith('/token'))).toHaveLength(1);
  });
  it.each([202, 207])('does not treat HTTP %s as completed payment', async (status) => {
    const net = network([token, get(approved()), capture({ ...approved(), status: 'PENDING' }, status), get({ ...approved(), status: 'PENDING' })]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/complet|pending|payment/i);
  });
  it('rejects non-approved orders before capture', async () => {
    const net = network([token, get({ ...approved(), status: 'CREATED' })]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/approv|payment/i);
    expect(net.calls).toHaveLength(2);
  });
  it('fails generic capture errors without trusting the HTTP status or exposing provider text', async () => {
    const net = network([token, get(approved()), capture({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED', description: 'provider raw secret' }] }, 422)]);
    await expect(net.adapter.capture(order())).rejects.toThrow(/PayPal|payment|capture/i);
    expect(net.calls).toHaveLength(3);
  });
  it('reports an unavailable PayPal network without exposing raw upstream errors', async () => {
    const adapter = new SandboxGateway({ clientId: 'test-client', clientSecret: 'test-secret', appUrl: 'http://localhost:3000', fetch: async () => { throw new Error('network raw secret'); } });
    let error;
    try { await adapter.capture(order()); } catch (caught) { error = caught; }
    expect(String(error)).toMatch(/PayPal.*timed out/i);
    expect(await apiError(error).text()).not.toContain('network raw secret');
  });
  it('refreshes the OAuth token after its expiry buffer', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const net = network([token, get(completed()), token, get(completed())]);
    await net.adapter.capture(order()); vi.advanceTimersByTime(3571_000); await net.adapter.capture(order());
    expect(net.calls.filter((call) => call.url.endsWith('/token'))).toHaveLength(2);
  });
});
