import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendBasket } from '../src/lib/basket';
import { CheckoutService } from '../src/lib/checkout';
import { Store, type Order } from '../src/lib/store';
import { SampleGateway, type Gateway, type PaymentEvidence } from '../src/lib/paypal';

const stores: Store[] = [];
const folders: string[] = [];
afterEach(() => { stores.forEach((store) => store.close()); stores.length = 0; folders.forEach((path) => rmSync(path, { recursive: true, force: true })); folders.length = 0; vi.useRealTimers(); });
const basket = () => recommendBasket({ categories: ['bag', 'bottle', 'charger'], preferredProductIds: [], explanation: '' }, 7500, { leatherFree: true, lightweight: true });
function memoryStore() { const store = new Store(':memory:'); stores.push(store); return store; }
function gateway(mode: 'sandbox' | 'sample' = 'sandbox') {
  const requests: Order[] = [];
  let captureCalls = 0;
  let evidence: Partial<PaymentEvidence> = {};
  let createFailure = false;
  const adapter: Gateway = {
    mode,
    async create(order) {
      requests.push(structuredClone(order));
      if (createFailure) throw new Error('controlled create timeout');
      return { providerOrderId: 'PAYPALORDER123', approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPALORDER123' };
    },
    async capture(order) {
      captureCalls++;
      await Promise.resolve();
      return { orderId: 'PAYPALORDER123', customId: order.id, orderStatus: 'COMPLETED', captureId: 'CAPTURE123', captureStatus: 'COMPLETED', amountCents: 7400, currency: 'USD', ...evidence };
    },
  };
  return { adapter, requests, get captureCalls() { return captureCalls; }, set evidence(value: Partial<PaymentEvidence>) { evidence = value; }, set createFailure(value: boolean) { createFailure = value; } };
}

describe('persistent immutable snapshots', () => {
  it('creates an independent 15 minute quote snapshot with session ownership', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const store = memoryStore();
    const original = basket();
    const quote = store.saveQuote('owner', original);
    original.lines[0].unitPriceCents = 1;
    quote.lines[0].unitPriceCents = 2;
    expect(store.getQuote(quote.id)).toMatchObject({ sessionId: 'owner', createdAt: '2026-11-03T12:00:00.000Z', expiresAt: '2026-11-03T12:15:00.000Z', totalCents: 7400, lines: [{ unitPriceCents: 2700 }, {}, {}] });
    expect(store.getQuote('missing')).toBeNull();
  });
  it('preserves an order and receipt across SQLite restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'clearcart-')); folders.push(folder);
    const path = join(folder, 'nested', 'clearcart.sqlite');
    const first = new Store(path); stores.push(first);
    const quote = first.saveQuote('owner', basket());
    const checkout = new CheckoutService(first, new SampleGateway());
    const started = await checkout.start('owner', quote.id);
    expect(first.getOrder(started.orderId)?.state).toBe('pending');
    const receipt = await checkout.capture('owner', started.orderId);
    first.close(); stores.splice(stores.indexOf(first), 1);
    const reopened = new Store(path); stores.push(reopened);
    expect(reopened.getOrder(started.orderId)?.receipt).toEqual(receipt);
    expect(reopened.getOrderByQuote(quote.id)?.id).toBe(started.orderId);
    const reused = await new CheckoutService(reopened, new SampleGateway()).start('owner', quote.id);
    expect(reused.receipt).toEqual(receipt);
  });
  it('enforces unique quote mappings and keeps the original basket on upsert', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket());
    const started = await new CheckoutService(store, new SampleGateway()).start('owner', quote.id);
    const order = store.getOrder(started.orderId)!;
    store.saveOrder({ ...order, basket: { ...order.basket, totalCents: 1 } });
    expect(store.getOrder(order.id)?.basket.totalCents).toBe(7400);
    expect(() => store.saveOrder({ ...order, id: 'another-order' })).toThrow();
    expect(store.getOrderByQuote(quote.id)?.id).toBe(order.id);
  });
  it('rolls back a conflicting provider mapping without losing either order', async () => {
    const store = memoryStore(); const firstQuote = store.saveQuote('owner', basket()); const secondQuote = store.saveQuote('owner', basket());
    const service = new CheckoutService(store, new SampleGateway());
    const first = await service.start('owner', firstQuote.id); const second = await service.start('owner', secondQuote.id);
    const firstOrder = store.getOrder(first.orderId)!; const secondOrder = store.getOrder(second.orderId)!;
    const pendingQuote = store.saveQuote('owner', basket());
    store.saveOrder({ ...secondOrder, id: 'pending-order', quoteId: pendingQuote.id, providerOrderId: null });
    expect(() => store.saveOrder({ ...secondOrder, id: 'pending-order', quoteId: pendingQuote.id, providerOrderId: firstOrder.providerOrderId })).toThrow();
    expect(store.getOrder(first.orderId)?.providerOrderId).toBe(firstOrder.providerOrderId);
    expect(store.getOrder(second.orderId)?.providerOrderId).toBe(secondOrder.providerOrderId);
    expect(store.getOrder('pending-order')?.providerOrderId).toBeNull();
  });
});

describe('checkout boundaries and idempotency', () => {
  it('serializes simultaneous starts for a quote with one stable order', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway();
    const service = new CheckoutService(store, fake.adapter);
    const [first, second] = await Promise.all([service.start('owner', quote.id), new CheckoutService(store, fake.adapter).start('owner', quote.id)]);
    expect(first).toEqual(second);
    expect(fake.requests).toHaveLength(1);
    expect(store.getOrderByQuote(quote.id)?.providerOrderId).toBe('PAYPALORDER123');
  });
  it('persists separate stable create/capture UUIDs before a create timeout and retries them', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway(); fake.createFailure = true;
    const service = new CheckoutService(store, fake.adapter);
    await expect(service.start('owner', quote.id)).rejects.toThrow();
    const pending = store.getOrderByQuote(quote.id)!;
    expect(pending).toMatchObject({ state: 'pending', providerOrderId: null, receipt: null });
    expect(pending.createRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(pending.captureRequestId).not.toBe(pending.createRequestId);
    fake.createFailure = false;
    const started = await new CheckoutService(store, fake.adapter).start('owner', quote.id);
    expect(started.orderId).toBe(pending.id);
    expect(fake.requests[1].createRequestId).toBe(fake.requests[0].createRequestId);
    expect(fake.requests[1].captureRequestId).toBe(fake.requests[0].captureRequestId);
  });
  it('rejects expired quotes and another session before creating an order', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway();
    const service = new CheckoutService(store, fake.adapter);
    await expect(service.start('intruder', quote.id)).rejects.toThrow(/quote|session|belong/i);
    vi.advanceTimersByTime(15 * 60 * 1000);
    await expect(service.start('owner', quote.id)).rejects.toThrow(/expired/i);
    expect(fake.requests).toHaveLength(0);
  });
  it('persists one receipt for simultaneous and duplicate callbacks', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway();
    const service = new CheckoutService(store, fake.adapter); const started = await service.start('owner', quote.id);
    const [first, second] = await Promise.all([service.capture('owner', started.orderId, 'PAYPALORDER123'), new CheckoutService(store, fake.adapter).capture('owner', started.orderId, 'PAYPALORDER123')]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ orderId: started.orderId, providerOrderId: 'PAYPALORDER123', captureId: 'CAPTURE123', amountCents: 7400, currency: 'USD', mode: 'sandbox' });
    expect(fake.captureCalls).toBe(1);
    expect(store.getOrder(started.orderId)).toMatchObject({ state: 'paid', receipt: first });
    expect(await service.capture('owner', started.orderId, 'PAYPALORDER123')).toEqual(first);
    expect((await service.start('owner', quote.id)).receipt).toEqual(first);
    expect(fake.captureCalls).toBe(1);
  });
  it.each([
    { orderStatus: 'COMPLETED', captureStatus: 'DECLINED' }, { orderStatus: 'APPROVED' },
    { amountCents: 7401 }, { currency: 'EUR' }, { customId: 'wrong-local-id' },
    { orderId: 'WRONGPROVIDER' }, { captureId: '' }, { captureId: '   ' },
  ])('keeps payment pending for mismatched evidence %j', async (evidence) => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway(); fake.evidence = evidence;
    const service = new CheckoutService(store, fake.adapter); const started = await service.start('owner', quote.id);
    await expect(service.capture('owner', started.orderId, 'PAYPALORDER123')).rejects.toThrow(/payment|match|complet|verif/i);
    expect(store.getOrder(started.orderId)).toMatchObject({ state: 'pending', receipt: null });
  });
  it('checks session, exact token, and stored payment mode even for a paid callback', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway();
    const service = new CheckoutService(store, fake.adapter); const started = await service.start('owner', quote.id);
    await expect(service.capture('intruder', started.orderId, 'PAYPALORDER123')).rejects.toThrow(/order|session|belong/i);
    await expect(service.capture('owner', started.orderId)).rejects.toThrow(/token|approval/i);
    await expect(service.capture('owner', started.orderId, 'wrong')).rejects.toThrow(/token|approval/i);
    expect(fake.captureCalls).toBe(0);
    await service.capture('owner', started.orderId, 'PAYPALORDER123');
    await expect(service.capture('owner', started.orderId, 'wrong')).rejects.toThrow(/token|approval/i);
    await expect(new CheckoutService(store, new SampleGateway()).capture('owner', started.orderId, 'PAYPALORDER123')).rejects.toThrow(/mode|configur/i);
  });
  it('leaves a network capture failure pending and allows retry', async () => {
    const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const fake = gateway();
    const service = new CheckoutService(store, fake.adapter); const started = await service.start('owner', quote.id);
    const original = fake.adapter.capture; fake.adapter.capture = async () => { throw new Error('controlled timeout'); };
    await expect(service.capture('owner', started.orderId, 'PAYPALORDER123')).rejects.toThrow();
    expect(store.getOrder(started.orderId)?.state).toBe('pending');
    fake.adapter.capture = original;
    expect((await service.capture('owner', started.orderId, 'PAYPALORDER123')).amountCents).toBe(7400);
  });
  it('keeps sample payment pending until explicit capture and makes no network call', async () => {
    const fetch = vi.fn(() => { throw new Error('Network must not be used'); }); vi.stubGlobal('fetch', fetch);
    try {
      const store = memoryStore(); const quote = store.saveQuote('owner', basket()); const service = new CheckoutService(store, new SampleGateway());
      const started = await service.start('owner', quote.id);
      expect(started).toMatchObject({ mode: 'sample', approvalUrl: null });
      expect(store.getOrder(started.orderId)).toMatchObject({ state: 'pending', receipt: null });
      const receipt = await service.capture('owner', started.orderId);
      expect(receipt.providerOrderId).toMatch(/^SAMPLE-/);
      expect(receipt.captureId).toMatch(/^SAMPLE-/);
      expect(receipt.amountCents).toBe(7400);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
