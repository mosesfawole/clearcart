import type { Order } from './store';
import { ConfigurationError, UserError } from './http';
export type PaymentMode = 'sample' | 'sandbox';
export type PaymentEvidence = { orderId: string; customId: string; orderStatus: string; captureId: string; captureStatus: string; amountCents: number; currency: string };
export interface Gateway {
  mode: PaymentMode;
  create(order: Order): Promise<{ providerOrderId: string; approvalUrl: string | null }>;
  capture(order: Order): Promise<PaymentEvidence>;
}
export class SampleGateway implements Gateway {
  readonly mode = 'sample';
  async create(order: Order): Promise<{ providerOrderId: string; approvalUrl: string | null }> {
    return { providerOrderId: `SAMPLE-${order.id}`, approvalUrl: null };
  }
  async capture(order: Order): Promise<PaymentEvidence> {
    return { orderId: `SAMPLE-${order.id}`, customId: order.id, orderStatus: 'COMPLETED', captureId: `SAMPLE-${order.captureRequestId}`, captureStatus: 'COMPLETED', amountCents: order.basket.totalCents, currency: 'USD' };
  }
}
export class SandboxGateway implements Gateway {
  readonly mode = 'sandbox';
  private readonly origin: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: typeof globalThis.fetch;
  private token: { value: string; expires: number } | undefined;
  private tokenRequest: Promise<string> | undefined;
  constructor(options: { clientId: string; clientSecret: string; appUrl: string; fetch?: typeof globalThis.fetch }) {
    this.clientId = options.clientId.trim(); this.clientSecret = options.clientSecret.trim();
    if (!this.clientId || !this.clientSecret) throw new ConfigurationError('PayPal sandbox configuration requires both client ID and client secret.');
    try {
      const url = new URL(options.appUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      this.origin = url.origin;
    } catch { throw new ConfigurationError('APP_URL configuration must be a plain http or https origin with no path, credentials, or query.'); }
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(`https://api-m.sandbox.paypal.com${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new UserError('PayPal sandbox could not be reached or timed out. Retry the same checkout.'); }
  }
  private async json(response: Response): Promise<unknown> {
    try { return await response.json(); }
    catch { throw new UserError('PayPal sandbox returned an invalid response. Retry the same checkout.'); }
  }
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const response = await this.request('/v1/oauth2/token', {
        method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!response.ok) throw new UserError('PayPal sandbox authentication failed. Check the sandbox credentials.');
      const payload = record(await this.json(response));
      if (typeof payload.access_token !== 'string' || !payload.access_token || /[\r\n]/.test(payload.access_token)
        || payload.token_type !== 'Bearer' || typeof payload.expires_in !== 'number' || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) {
        throw new UserError('PayPal sandbox returned an invalid authentication response.');
      }
      this.token = { value: payload.access_token, expires: Date.now() + Math.max(0, payload.expires_in - 30) * 1000 };
      return this.token.value;
    })();
    try { return await this.tokenRequest; }
    finally { this.tokenRequest = undefined; }
  }
  private async headers(requestId?: string): Promise<Headers> {
    const headers = new Headers({ Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
    if (requestId) headers.set('PayPal-Request-Id', requestId);
    return headers;
  }
  async create(order: Order): Promise<{ providerOrderId: string; approvalUrl: string | null }> {
    if (order.mode !== this.mode) throw new ConfigurationError('Payment mode does not match this order.');
    const response = await this.request('/v2/checkout/orders', {
      method: 'POST', headers: await this.headers(order.createRequestId), body: JSON.stringify({
        intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id, amount: { currency_code: 'USD', value: decimal(order.basket.totalCents) } }],
        payment_source: { paypal: { experience_context: {
          brand_name: 'ClearCart Sandbox', user_action: 'PAY_NOW', payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED', shipping_preference: 'NO_SHIPPING',
          return_url: `${this.origin}/?checkout=return&orderId=${encodeURIComponent(order.id)}`,
          cancel_url: `${this.origin}/?checkout=cancel&orderId=${encodeURIComponent(order.id)}`,
        } } },
      }),
    });
    if (response.status !== 200 && response.status !== 201) throw new UserError('PayPal sandbox order creation failed. Retry checkout.');
    const payload = record(await this.json(response));
    const providerOrderId = providerId(payload.id);
    const links = Array.isArray(payload.links) ? payload.links.map(record) : [];
    const link = links.find((item) => item.rel === 'payer-action') ?? links.find((item) => item.rel === 'approve');
    let approvalUrl: string;
    try {
      if (typeof link?.href !== 'string') throw new Error();
      const url = new URL(link.href);
      if (url.protocol !== 'https:' || !['www.sandbox.paypal.com', 'sandbox.paypal.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error();
      approvalUrl = url.href;
    } catch { throw new UserError('PayPal sandbox returned an invalid approval link. Retry checkout.'); }
    return { providerOrderId, approvalUrl };
  }
  private async retrieve(order: Order): Promise<Record<string, unknown>> {
    const response = await this.request(`/v2/checkout/orders/${providerId(order.providerOrderId)}`, { method: 'GET', headers: await this.headers() });
    if (!response.ok) throw new UserError('PayPal sandbox could not retrieve the payment order. Retry confirmation.');
    const payload = record(await this.json(response));
    verifyOrder(payload, order);
    return payload;
  }
  async capture(order: Order): Promise<PaymentEvidence> {
    if (order.mode !== this.mode) throw new ConfigurationError('Payment mode does not match this order.');
    const before = await this.retrieve(order);
    if (before.status === 'COMPLETED') return paymentEvidence(before, order);
    if (before.status !== 'APPROVED') throw new UserError('PayPal payment has not been approved. Complete buyer approval before confirming.');
    const response = await this.request(`/v2/checkout/orders/${providerId(order.providerOrderId)}/capture`, {
      method: 'POST', headers: await this.headers(order.captureRequestId), body: '{}',
    });
    if (!response.ok) {
      const payload = record(await this.json(response));
      const details = Array.isArray(payload.details) ? payload.details.map(record) : [];
      if (response.status !== 422 || details.length !== 1 || details[0].issue !== 'ORDER_ALREADY_CAPTURED') {
        throw new UserError('PayPal sandbox payment capture failed. Payment is not confirmed; retry or check buyer approval.');
      }
    }
    // Even an HTTP 2xx capture response can be pending or contain a declined capture.
    // A fresh order retrieval is the only source of completed payment evidence.
    return paymentEvidence(await this.retrieve(order), order);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UserError('PayPal sandbox returned invalid payment data.');
  return value as Record<string, unknown>;
}
function providerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(value)) throw new UserError('PayPal sandbox returned an invalid order or capture ID.');
  return value;
}
function decimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new UserError('Payment amount must be a positive whole number of cents.');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
function exactAmount(value: unknown): { amountCents: number; currency: string } {
  const amount = record(value);
  if (amount.currency_code !== 'USD' || typeof amount.value !== 'string' || !/^(?:0|[1-9]\d*)\.\d{2}$/.test(amount.value)) {
    throw new UserError('PayPal payment amount or currency could not be verified.');
  }
  const [whole, fractional] = amount.value.split('.');
  const cents = Number(whole) * 100 + Number(fractional);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new UserError('PayPal payment amount could not be verified.');
  return { amountCents: cents, currency: 'USD' };
}
function unit(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.purchase_units) || payload.purchase_units.length !== 1) throw new UserError('PayPal payment purchase units could not be verified.');
  return record(payload.purchase_units[0]);
}
function verifyOrder(payload: Record<string, unknown>, order: Order): void {
  const purchaseUnit = unit(payload);
  if (providerId(payload.id) !== order.providerOrderId || purchaseUnit.custom_id !== order.id
    || purchaseUnit.reference_id !== order.id || exactAmount(purchaseUnit.amount).amountCents !== order.basket.totalCents) {
    throw new UserError('PayPal payment identity or amount does not match your saved basket.');
  }
}
function paymentEvidence(payload: Record<string, unknown>, order: Order): PaymentEvidence {
  verifyOrder(payload, order);
  const purchaseUnit = unit(payload);
  const payments = record(purchaseUnit.payments);
  if (payload.status !== 'COMPLETED' || !Array.isArray(payments.captures) || payments.captures.length !== 1) {
    throw new UserError('PayPal payment does not have one verified completed capture. Retry confirmation later.');
  }
  const capture = record(payments.captures[0]);
  const amount = exactAmount(capture.amount);
  if (capture.status !== 'COMPLETED' || amount.amountCents !== order.basket.totalCents) {
    throw new UserError('PayPal capture is not completed or its amount does not match your basket.');
  }
  return { orderId: providerId(payload.id), customId: order.id, orderStatus: 'COMPLETED', captureId: providerId(capture.id), captureStatus: 'COMPLETED', ...amount };
}

export function paymentMode(): PaymentMode {
  const client = process.env.PAYPAL_CLIENT_ID?.trim(); const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!!client !== !!secret) throw new ConfigurationError('PayPal sandbox configuration requires both client ID and client secret, or neither for sample mode.');
  return client && secret ? 'sandbox' : 'sample';
}
let sandbox: SandboxGateway | undefined;
let sandboxConfiguration: { clientId: string; clientSecret: string; appUrl: string } | undefined;
const sample = new SampleGateway();
export function getGateway(): Gateway {
  if (paymentMode() === 'sample') return sample;
  const options = { clientId: process.env.PAYPAL_CLIENT_ID!.trim(), clientSecret: process.env.PAYPAL_CLIENT_SECRET!.trim(), appUrl: process.env.APP_URL?.trim() || 'http://localhost:3000' };
  if (!sandbox || sandboxConfiguration?.clientId !== options.clientId || sandboxConfiguration.clientSecret !== options.clientSecret || sandboxConfiguration.appUrl !== options.appUrl) {
    sandbox = new SandboxGateway(options); sandboxConfiguration = options;
  }
  return sandbox;
}
