import { randomUUID } from 'node:crypto';
import type { Store, Receipt, Order } from './store';
import type { Gateway, PaymentMode } from './paypal';
import { ConfigurationError, UserError } from './http';

const storeLocks = new WeakMap<Store, Map<string, Promise<void>>>();
export class CheckoutService {
  private readonly locks: Map<string, Promise<void>>;
  constructor(private readonly store: Store, private readonly gateway: Gateway) {
    this.locks = storeLocks.get(store) ?? new Map();
    storeLocks.set(store, this.locks);
  }
  private async locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
  private checkMode(order: Order): void {
    if (order.mode !== this.gateway.mode) throw new ConfigurationError('Payment mode changed since this order was created. Restore the original configuration or create a new quote.');
  }
  async start(sessionId: string, quoteId: string): Promise<{ orderId: string; mode: PaymentMode; approvalUrl: string | null; receipt?: Receipt }> {
    return this.locked(`quote:${quoteId}`, async () => {
      const quote = this.store.getQuote(quoteId);
      if (!quote || quote.sessionId !== sessionId) throw new UserError('This quote does not belong to your session. Create a new basket.');
      if (Date.parse(quote.expiresAt) <= Date.now()) throw new UserError('This quote has expired. Create a new basket before checkout.');
      let order = this.store.getOrderByQuote(quoteId);
      if (!order) {
        const { id: _quoteId, sessionId: _owner, createdAt: _created, expiresAt: _expires, ...basket } = quote;
        order = { id: randomUUID(), quoteId, sessionId, mode: this.gateway.mode, providerOrderId: null, approvalUrl: null, state: 'pending', createRequestId: randomUUID(), captureRequestId: randomUUID(), basket, createdAt: new Date().toISOString(), receipt: null };
        this.store.saveOrder(order);
      }
      this.checkMode(order);
      if (!order.providerOrderId) {
        let result;
        try { result = await this.gateway.create(order); }
        catch (error) { if (error instanceof UserError) throw error; throw new UserError('Payment order creation failed or timed out. Retry checkout; your payment has not been confirmed.'); }
        if (typeof result.providerOrderId !== 'string' || !result.providerOrderId.trim()) throw new UserError('Payment provider returned an invalid order. Retry checkout.');
        order = { ...order, ...result };
        this.store.saveOrder(order);
      }
      return { orderId: order.id, mode: order.mode, approvalUrl: order.approvalUrl, ...(order.receipt ? { receipt: order.receipt } : {}) };
    });
  }
  async capture(sessionId: string, orderId: string, token?: string): Promise<Receipt> {
    return this.locked(`order:${orderId}`, async () => {
      const order = this.store.getOrder(orderId);
      if (!order || order.sessionId !== sessionId) throw new UserError('This order does not belong to your session.');
      this.checkMode(order);
      if (!order.providerOrderId) throw new UserError('This order has not been created with the payment provider. Retry checkout.');
      if (order.mode === 'sandbox' && token !== order.providerOrderId) throw new UserError('The approval token does not match this payment order.');
      if (order.state === 'paid' && order.receipt) return order.receipt;
      let evidence;
      try { evidence = await this.gateway.capture(order); }
      catch (error) { if (error instanceof UserError) throw error; throw new UserError('Payment confirmation failed or timed out. Retry confirmation to check the same order.'); }
      if (!evidence || evidence.orderId !== order.providerOrderId || evidence.customId !== order.id
        || evidence.orderStatus !== 'COMPLETED' || evidence.captureStatus !== 'COMPLETED'
        || typeof evidence.captureId !== 'string' || !evidence.captureId.trim()
        || !Number.isSafeInteger(evidence.amountCents) || evidence.amountCents !== order.basket.totalCents || evidence.currency !== 'USD') {
        throw new UserError('Payment could not be verified: completed capture, order identity, amount and currency must match your basket.');
      }
      const receipt: Receipt = { id: randomUUID(), orderId: order.id, providerOrderId: order.providerOrderId, captureId: evidence.captureId, mode: order.mode, amountCents: order.basket.totalCents, currency: 'USD', createdAt: new Date().toISOString(), lines: structuredClone(order.basket.lines) };
      this.store.saveOrder({ ...order, state: 'paid', receipt });
      return receipt;
    });
  }
}
