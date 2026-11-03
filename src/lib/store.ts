import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Basket, BasketLine } from './basket';
import { UserError } from './http';
export type Quote = Basket & { id: string; sessionId: string; createdAt: string; expiresAt: string };
export type Receipt = { id: string; orderId: string; providerOrderId: string; captureId: string; mode: 'sample' | 'sandbox'; amountCents: number; currency: 'USD'; createdAt: string; lines: BasketLine[] };
export type Order = { id: string; quoteId: string; sessionId: string; mode: 'sample' | 'sandbox'; providerOrderId: string | null; approvalUrl: string | null; state: 'pending' | 'paid'; createRequestId: string; captureRequestId: string; basket: Basket; createdAt: string; receipt: Receipt | null };
export class Store {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id),
        provider_id TEXT UNIQUE,
        snapshot TEXT NOT NULL
      );
    `);
  }
  saveQuote(sessionId: string, basket: Basket): Quote {
    const now = Date.now();
    const quote: Quote = { ...structuredClone(basket), id: randomUUID(), sessionId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60 * 1000).toISOString() };
    this.db.prepare('INSERT INTO quotes (id, snapshot) VALUES (?, ?)').run(quote.id, JSON.stringify(quote));
    return quote;
  }
  getQuote(id: string): Quote | null {
    const row = this.db.prepare('SELECT snapshot FROM quotes WHERE id = ?').get(id);
    return row ? JSON.parse(row.snapshot as string) as Quote : null;
  }
  getOrder(id: string): Order | null {
    const row = this.db.prepare('SELECT snapshot FROM orders WHERE id = ?').get(id);
    return row ? JSON.parse(row.snapshot as string) as Order : null;
  }
  getOrderByQuote(id: string): Order | null {
    const row = this.db.prepare('SELECT snapshot FROM orders WHERE quote_id = ?').get(id);
    return row ? JSON.parse(row.snapshot as string) as Order : null;
  }
  saveOrder(order: Order): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getOrder(order.id);
      if (existing && (existing.quoteId !== order.quoteId || existing.sessionId !== order.sessionId || existing.mode !== order.mode
        || (existing.providerOrderId && existing.providerOrderId !== order.providerOrderId))) {
        throw new UserError('Order identity does not match the saved checkout.');
      }
      // Basket, request UUIDs, ownership and creation time never change on upsert.
      const saved: Order = existing ? existing.state === 'paid' ? existing : {
        ...existing, providerOrderId: order.providerOrderId, approvalUrl: order.approvalUrl, state: order.state, receipt: order.receipt,
      } : structuredClone(order);
      this.db.prepare(`INSERT INTO orders (id, quote_id, provider_id, snapshot) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET provider_id = excluded.provider_id, snapshot = excluded.snapshot`)
        .run(saved.id, saved.quoteId, saved.providerOrderId, JSON.stringify(saved));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.close(); }
}
let singleton: Store | undefined;
export function getStore(): Store { return singleton ??= new Store(resolve('data', 'clearcart.sqlite')); }
