'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronRight, Clock3,
  Feather, Headphones, LampDesk, Leaf, LoaderCircle, PackageCheck, PlugZap,
  ReceiptText, ShoppingBag, ShoppingBasket, SlidersHorizontal, Sparkles, Wine, X,
} from 'lucide-react';
import { catalog as sampleCatalog, type Product } from '../lib/catalog';
import type { Basket, Constraints } from '../lib/basket';
import type { Quote, Receipt } from '../lib/store';

type PublicQuote = Omit<Quote, 'sessionId'>;
type Config = { aiMode: 'sample' | 'gemini'; paymentMode: 'sample' | 'sandbox'; model: string; catalog: Product[] };
type Callback = { orderId: string; token?: string };
type CheckoutResult = { orderId: string; mode: 'sample' | 'sandbox'; approvalUrl: string | null; receipt?: Receipt };
type Busy = 'loading' | 'recommend' | 'checkout' | 'capture' | null;
type Collection = 'All' | 'Travel' | 'Desk' | 'Audio';

const initialRequest = 'A lightweight travel kit under $75, no leather';
const storageKey = 'clearcart-basket-v1';
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents: number) => dollars.format(cents / 100);
const productIcons = { bag: ShoppingBag, bottle: Wine, charger: PlugZap, headphones: Headphones, notebook: BookOpen, lamp: LampDesk };
const suggestions = [
  { name: 'Travel light', request: initialRequest, budget: '75', lightweight: true, leatherFree: true },
  { name: 'Desk refresh', request: 'A notebook and lamp to refresh my desk under $65', budget: '65', lightweight: false, leatherFree: true },
  { name: 'A thoughtful gift', request: 'A thoughtful bottle and notebook gift under $40', budget: '40', lightweight: false, leatherFree: true },
];

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  let data: T & { error?: string };
  try { data = await response.json(); }
  catch { throw new Error('We couldn’t read the response. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Something interrupted your request. Please try again.');
  return data;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'Something interrupted your request. Please try again.';
}

function clearCallbackUrl() {
  const url = new URL(window.location.href);
  for (const key of ['checkout', 'orderId', 'token', 'PayerID']) url.searchParams.delete(key);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function storedQuote(value: unknown): value is PublicQuote {
  if (!value || typeof value !== 'object') return false;
  const q = value as Partial<PublicQuote>;
  return typeof q.id === 'string' && typeof q.expiresAt === 'string' && typeof q.createdAt === 'string'
    && typeof q.explanation === 'string' && q.currency === 'USD'
    && [q.subtotalCents, q.shippingCents, q.taxCents, q.totalCents, q.budgetCents].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    && Array.isArray(q.lines) && q.lines.length > 0 && q.lines.every((line) => line && typeof line.name === 'string'
      && typeof line.productId === 'string' && Object.hasOwn(productIcons, line.category)
      && Number.isSafeInteger(line.quantity) && Number.isSafeInteger(line.totalCents))
    && Array.isArray(q.substitutions) && q.substitutions.every((item) => typeof item === 'string')
    && typeof q.constraints?.lightweight === 'boolean' && typeof q.constraints?.leatherFree === 'boolean';
}

function ProductArt({ product, small = false }: { product: Product; small?: boolean }) {
  const Icon = productIcons[product.category];
  return <div className={`product-art ${small ? 'product-art-small' : ''} art-${product.category}`} style={{ '--product-color': product.color } as CSSProperties} aria-hidden="true">
    <div className="art-orbit" /><div className="art-shadow" /><Icon className="product-icon" strokeWidth={1.2} />
    {!small && <span className="art-caption">{product.category === 'bottle' ? 'CARRY A LITTLE LESS.' : product.category === 'notebook' ? 'MAKE ROOM FOR IDEAS.' : 'MADE FOR YOUR EVERYDAY.'}</span>}
  </div>;
}

function BasketLines({ lines, products }: { lines: Basket['lines']; products: Product[] }) {
  return <ul className="basket-lines">{lines.map((line) => {
    const product = products.find((item) => item.id === line.productId);
    const Icon = productIcons[line.category] || ShoppingBag;
    return <li key={line.productId}>
      {product ? <ProductArt product={product} small /> : <span className="line-fallback"><Icon aria-hidden="true" /></span>}
      <div className="line-copy"><span>{line.name}</span><small>Qty {line.quantity}</small></div>
      <strong>{money(line.totalCents)}</strong>
    </li>;
  })}</ul>;
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [request, setRequest] = useState(initialRequest);
  const [budget, setBudget] = useState('75');
  const [constraints, setConstraints] = useState<Constraints>({ lightweight: true, leatherFree: true });
  const [collection, setCollection] = useState<Collection>('All');
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState<Busy>('loading');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading your shopping session.');
  const [callback, setCallback] = useState<Callback | null>(null);
  const [sampleOrder, setSampleOrder] = useState<CheckoutResult | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const checkoutButton = useRef<HTMLButtonElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const callbackStarted = useRef(false);
  const operationActive = useRef(false);
  const products = config?.catalog || sampleCatalog;
  const expired = Boolean(quote && new Date(quote.expiresAt).getTime() <= now);
  const remainingMinutes = quote ? Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - now) / 60000)) : 0;

  const verifyPayment = useCallback(async (payment: Callback) => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy('capture'); setError(''); setStatus('Verifying your payment. Please keep this page open.');
    try {
      const result = await api<{ receipt: Receipt }>('capture', payment);
      setReceipt(result.receipt); setCallback(null); setSampleOrder(null);
      dialog.current?.close(); clearCallbackUrl();
      setStatus(result.receipt.mode === 'sandbox' ? 'Sandbox payment verified. Your receipt is ready.' : 'Sample order complete. Your receipt is ready.');
      try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
    } catch (err) {
      setError(messageFrom(err)); setStatus('Verification needs another try. No completed payment has been confirmed here.');
    } finally { operationActive.current = false; setBusy(null); }
  }, []);

  useEffect(() => {
    let active = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (storedQuote(saved.quote)) setQuote(saved.quote);
        if (typeof saved.request === 'string' && saved.request.length <= 1200) setRequest(saved.request);
        if (typeof saved.budget === 'string' && /^\d+(?:\.\d{0,2})?$/.test(saved.budget)) setBudget(saved.budget);
        if (typeof saved.constraints?.lightweight === 'boolean' && typeof saved.constraints?.leatherFree === 'boolean') setConstraints(saved.constraints);
      }
    } catch { /* Private browsing can disable storage; shopping still works. */ }
    api<Config>('config').then((result) => {
      if (!active) return;
      setConfig(result); setBusy(null); setStatus('Ready. Describe what you need to find your basket.');
      const params = new URL(window.location.href).searchParams;
      if (params.get('checkout') === 'cancel') {
        clearCallbackUrl(); setStatus('Checkout canceled. Your basket is still here when you’re ready.');
      } else if (params.get('checkout') === 'return' && !callbackStarted.current) {
        callbackStarted.current = true;
        const payment = { orderId: params.get('orderId') || '', ...(params.get('token') ? { token: params.get('token')! } : {}) };
        setCallback(payment); void verifyPayment(payment);
      }
    }).catch((err) => {
      if (!active) return;
      setError(messageFrom(err)); setBusy(null); setStatus('Your shopping session could not load.');
    });
    return () => { active = false; };
  }, [verifyPayment]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (sampleOrder && !dialog.current?.open) dialog.current?.showModal();
  }, [sampleOrder]);
  useEffect(() => {
    if (receipt) receiptHeading.current?.focus();
  }, [receipt]);

  function rememberBasket(nextQuote: PublicQuote) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ quote: nextQuote, request, budget, constraints })); }
    catch { /* Server ownership and verification do not depend on browser storage. */ }
  }

  function invalidateBasket() {
    setQuote(null); setReceipt(null); setError('');
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
    setStatus('Your request changed. Find a fresh basket to check the new total.');
  }

  async function findBasket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationActive.current || !config || callback) return;
    if (!/^\d+(?:\.\d{1,2})?$/.test(budget) || Number(budget) <= 0 || Number(budget) > 1000) {
      setError('Enter a budget from $0.01 to $1,000 with up to two decimal places.'); return;
    }
    operationActive.current = true;
    setBusy('recommend'); setError(''); setReceipt(null); setQuote(null); setStatus('Finding a complete basket that fits your request.');
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
    try {
      const result = await api<{ quote: PublicQuote; aiMode: Config['aiMode'] }>('recommend', {
        request, budgetCents: Math.round(Number(budget) * 100), constraints,
      });
      setQuote(result.quote); setConfig((current) => current ? { ...current, aiMode: result.aiMode } : current);
      rememberBasket(result.quote); setNow(Date.now());
      setStatus(`Your basket is ready: ${result.quote.lines.length} items, ${money(result.quote.totalCents)} including shipping.`);
      if (window.matchMedia('(max-width: 900px)').matches) document.getElementById('your-basket')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    } catch (err) { setError(messageFrom(err)); setStatus('We couldn’t build that basket. Adjust your request or budget and try again.'); }
    finally { operationActive.current = false; setBusy(null); }
  }

  async function startCheckout() {
    if (operationActive.current || !quote || expired || callback) return;
    operationActive.current = true;
    setBusy('checkout'); setError(''); setStatus('Preparing your checkout.');
    try {
      const result = await api<CheckoutResult>('checkout', { quoteId: quote.id });
      if (result.receipt) {
        setReceipt(result.receipt); setStatus(result.receipt.mode === 'sandbox' ? 'Sandbox payment verified. Your receipt is ready.' : 'Sample order complete. Your receipt is ready.');
        try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
      } else if (result.mode === 'sample') {
        setSampleOrder(result); setStatus('Review and confirm the sample checkout. No real money moves.');
      } else {
        if (!result.approvalUrl) throw new Error('PayPal did not return an approval page. Please try checkout again.');
        rememberBasket(quote); setStatus('Opening PayPal Sandbox for your approval.');
        window.location.assign(result.approvalUrl);
      }
    } catch (err) { setError(messageFrom(err)); setStatus('Checkout could not start. Your basket is still here.'); }
    finally { operationActive.current = false; setBusy(null); }
  }

  function closeSample() {
    dialog.current?.close(); setSampleOrder(null);
    if (busy !== 'capture') setStatus('Sample checkout canceled. Your basket is still here.');
    checkoutButton.current?.focus();
  }

  function resetBasket() {
    if (operationActive.current) return;
    setQuote(null); setReceipt(null); setError(''); setSampleOrder(null); setCallback(null);
    setRequest(initialRequest); setBudget('75'); setConstraints({ lightweight: true, leatherFree: true });
    try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
    clearCallbackUrl(); setStatus('Ready for your next basket.'); textarea.current?.focus();
  }

  const visibleProducts = products.filter((product) => collection === 'All'
    || (collection === 'Travel' && ['bag', 'bottle', 'charger'].includes(product.category))
    || (collection === 'Desk' && ['notebook', 'lamp'].includes(product.category))
    || (collection === 'Audio' && product.category === 'headphones'));

  return <>
    <a className="skip-link" href="#main">Skip to shopping</a>
    <header className="site-header page-width">
      <a className="wordmark" href="#" aria-label="ClearCart home"><span className="brand-icon"><Leaf aria-hidden="true" strokeWidth={1.7} /></span>ClearCart<span className="brand-dot">.</span></a>
      <nav aria-label="Main navigation"><a href="#collection">Collection</a><a href="#how-it-works">How it works <ArrowUpRight size={14} aria-hidden="true" /></a></nav>
      <div className="mode-badges" aria-label="Current demo modes">
        <span className="mode-pill"><span className="mode-dot" />{config ? config.paymentMode === 'sample' ? 'Sample checkout' : 'PayPal Sandbox' : 'Loading session'}</span>
        <span className="ai-mode">{config ? config.aiMode === 'sample' ? 'Sample assistant' : 'Gemini assistant' : 'Please wait'}</span>
      </div>
    </header>

    <main id="main">
      <section className="hero page-width" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="eyebrow"><span />LESS SEARCHING. MORE SURE.</span>
          <h1 id="hero-title">Good finds.<br /><span>No guesswork.</span></h1>
          <p>Tell us what you have in mind. We’ll put together<br className="desktop-break" /> a thoughtful basket—with every cost upfront.</p>
          <div className="hero-promises"><span><CheckCircle2 aria-hidden="true" />Your budget, respected</span><span><CheckCircle2 aria-hidden="true" />Your choice, always</span></div>
          <div className="hero-footnote"><span className="mini-leaf"><Leaf aria-hidden="true" /></span><span>A little less scrolling.<br /><strong>A little more living.</strong></span><span className="hero-footnote-line" /></div>
        </div>

        <div className="request-card">
          <div className="request-card-heading"><span className="sparkle-box"><Sparkles aria-hidden="true" size={21} /></span><div><h2>Your next good find starts here.</h2><p>A few words are all it takes.</p></div></div>
          <form onSubmit={findBasket}>
            <label htmlFor="shopping-request">What are you shopping for?</label>
            <div className="textarea-wrap"><textarea ref={textarea} id="shopping-request" value={request} onChange={(event) => { invalidateBasket(); setRequest(event.target.value); }} minLength={3} maxLength={1200} rows={3} required disabled={Boolean(busy) || Boolean(callback)} /><Sparkles size={16} aria-hidden="true" /></div>
            <div className="request-controls">
              <div className="budget-control"><label htmlFor="budget">Your total budget <span>USD</span></label><div><span aria-hidden="true">$</span><input id="budget" type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={budget} onChange={(event) => { invalidateBasket(); setBudget(event.target.value); }} required disabled={Boolean(busy) || Boolean(callback)} aria-describedby="budget-note" /></div></div>
              <fieldset className="constraint-controls"><legend><SlidersHorizontal size={14} aria-hidden="true" />Preferences</legend><label><input type="checkbox" checked={constraints.lightweight} disabled={Boolean(busy) || Boolean(callback)} onChange={(event) => { invalidateBasket(); setConstraints((current) => ({ ...current, lightweight: event.target.checked })); }} /><span><Feather size={14} aria-hidden="true" />Lightweight</span></label><label><input type="checkbox" checked={constraints.leatherFree} disabled={Boolean(busy) || Boolean(callback)} onChange={(event) => { invalidateBasket(); setConstraints((current) => ({ ...current, leatherFree: event.target.checked })); }} /><span><Leaf size={14} aria-hidden="true" />No leather</span></label></fieldset>
            </div>
            <button className="primary-button find-button" type="submit" disabled={Boolean(busy) || !config || Boolean(callback)}>{busy === 'recommend' ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}<span>{busy === 'recommend' ? 'Finding your basket…' : 'Find my basket'}</span><ArrowRight size={18} aria-hidden="true" /></button>
            <p id="budget-note" className="form-note">Sample catalog · USD prices · $5 shipping · $0 demo tax</p>
          </form>
          <div className="suggestions"><span>Or start with</span><div>{suggestions.map((suggestion) => <button key={suggestion.name} type="button" disabled={Boolean(busy) || Boolean(callback)} onClick={() => { invalidateBasket(); setRequest(suggestion.request); setBudget(suggestion.budget); setConstraints({ lightweight: suggestion.lightweight, leatherFree: suggestion.leatherFree }); textarea.current?.focus(); }}>{suggestion.name}<ArrowUpRight size={12} aria-hidden="true" /></button>)}</div></div>
        </div>
      </section>

      <div className="trust-strip"><div className="page-width"><span><PackageCheck size={17} aria-hidden="true" />Everyday essentials, thoughtfully picked</span><span><SlidersHorizontal size={16} aria-hidden="true" />Checked against your preferences</span><span><ReceiptText size={16} aria-hidden="true" />No surprises at checkout</span></div></div>

      <div className="page-width shopping-layout">
        <section id="collection" className="collection" aria-labelledby="collection-heading">
          <div className="collection-heading"><div><span className="eyebrow">THE CLEARCART COLLECTION</span><h2 id="collection-heading">Everyday things,<br />chosen well.</h2></div><span className="collection-count">{products.length} good finds<br /><span>One considered collection.</span></span></div>
          <div className="collection-toolbar"><div className="category-filters" aria-label="Filter collection">{(['All', 'Travel', 'Desk', 'Audio'] as Collection[]).map((category) => <button key={category} type="button" aria-pressed={collection === category} onClick={() => setCollection(category)}>{category}{category === 'All' && <span>{products.length}</span>}</button>)}</div><span className="browse-note">Browse. Then let us build.</span></div>
          <div className="product-grid">{visibleProducts.map((product) => <article className="product-card" key={product.id}>
            <div className="product-visual"><ProductArt product={product} />{product.badge && <span className="product-badge">{product.badge === 'Recycled fabric' && <Leaf size={11} aria-hidden="true" />}{product.badge}</span>}</div>
            <div className="product-details"><div className="product-title"><h3>{product.name}</h3><strong>{money(product.priceCents)}</strong></div><p>{product.description}</p><div className="product-meta"><span>{product.weightGrams} g</span><span>{product.material}</span></div></div>
          </article>)}</div>
          <p className="collection-bottom-note">Good things come together. Describe a task and we’ll choose a complete basket.</p>
        </section>

        <aside id="your-basket" className="basket-panel" aria-labelledby={receipt ? 'receipt-heading' : 'basket-heading'}>
          <div className="basket-header"><div><ShoppingBasket size={19} aria-hidden="true" /><h2 id="basket-heading">Your basket</h2></div><span>{receipt ? `${receipt.lines.length} items` : quote ? `${quote.lines.length} items` : 'Made for you'}</span></div>
          <div className="basket-content">
            {receipt ? <>
              <div className="receipt-success"><span><Check aria-hidden="true" /></span><h3 id="receipt-heading" tabIndex={-1} ref={receiptHeading}>{receipt.mode === 'sandbox' ? 'Sandbox payment verified' : 'Sample order complete'}</h3><p>{receipt.mode === 'sandbox' ? 'Your PayPal Sandbox payment has been verified. Here’s your receipt.' : 'You’ve completed the sample flow. No real money moved.'}</p></div>
              <BasketLines lines={receipt.lines} products={products} />
              <div className="receipt-total"><span>Total · USD</span><strong>{money(receipt.amountCents)}</strong></div>
              <dl className="receipt-details"><div><dt>Order</dt><dd>{receipt.orderId}</dd></div><div><dt>{receipt.mode === 'sandbox' ? 'PayPal order' : 'Sample order reference'}</dt><dd>{receipt.providerOrderId}</dd></div><div><dt>Capture</dt><dd>{receipt.captureId}</dd></div><div><dt>Receipt</dt><dd>{receipt.id}</dd></div><div><dt>Completed</dt><dd>{new Date(receipt.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div></dl>
              <button type="button" className="primary-button" onClick={resetBasket}>Start another basket<ArrowRight size={17} aria-hidden="true" /></button>
            </> : quote ? <>
              <div className="basket-ready"><span><Sparkles size={15} aria-hidden="true" />A good fit for your day.</span><p>{quote.explanation}</p></div>
              <div className="applied-constraints" aria-label="Applied request preferences">{quote.constraints.lightweight && <span><Feather size={12} aria-hidden="true" />500 g or less per item</span>}{quote.constraints.leatherFree && <span><Leaf size={12} aria-hidden="true" />No leather</span>}<span><Check size={12} aria-hidden="true" />Within {money(quote.budgetCents)}</span></div>
              <BasketLines lines={quote.lines} products={products} />
              {quote.substitutions.length > 0 && <div className="substitutions"><h3>A thoughtful swap</h3>{quote.substitutions.map((substitution) => <p key={substitution}>{substitution}</p>)}</div>}
              <dl className="totals"><div><dt>Items subtotal</dt><dd>{money(quote.subtotalCents)}</dd></div><div><dt>Shipping</dt><dd>{money(quote.shippingCents)}</dd></div><div><dt>Demo tax</dt><dd>{money(quote.taxCents)}</dd></div><div className="grand-total"><dt>Total <span>USD</span></dt><dd>{money(quote.totalCents)}</dd></div></dl>
              <div className="budget-left"><CheckCircle2 size={15} aria-hidden="true" /><span>{money(quote.budgetCents - quote.totalCents)} left in your budget</span></div>
              <button ref={checkoutButton} className="primary-button checkout-button" type="button" disabled={Boolean(busy) || expired || Boolean(callback)} onClick={() => void startCheckout()}>{busy === 'checkout' ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <ShoppingBag size={17} aria-hidden="true" />}<span>{busy === 'checkout' ? 'Preparing checkout…' : config?.paymentMode === 'sandbox' ? 'Continue to PayPal Sandbox' : 'Try sample checkout'}</span><ArrowRight size={17} aria-hidden="true" /></button>
              <p className={`quote-expiry ${expired ? 'quote-expired' : ''}`}><Clock3 size={13} aria-hidden="true" />{expired ? 'This quote expired. Find a fresh basket to continue.' : `Quote valid for ${remainingMinutes} more minute${remainingMinutes === 1 ? '' : 's'}.`}</p>
              {expired && <button type="button" className="text-button" onClick={() => textarea.current?.focus()}>Update your request <ArrowUpRight size={13} aria-hidden="true" /></button>}
            </> : <div className="empty-basket"><div className="empty-illustration"><ShoppingBasket size={53} strokeWidth={1.3} aria-hidden="true" /><span><Sparkles size={15} aria-hidden="true" /></span></div><h3>A basket with your name on it.</h3><p>Tell us what you’re looking for.<br />Your picks and exact total will<br />appear right here.</p><span className="empty-divider" /><p className="empty-reassurance"><CheckCircle2 size={14} aria-hidden="true" />Nothing happens without your approval.</p></div>}

            {busy && <p className="busy-status"><LoaderCircle className="spin" size={15} aria-hidden="true" />{busy === 'capture' ? 'Verifying payment…' : busy === 'recommend' ? 'Finding your basket…' : busy === 'checkout' ? 'Preparing checkout…' : 'Loading your session…'}</p>}
            {error && <div className="error-box" role="alert"><strong>Let’s give that another try.</strong><p>{error}</p>{!config && <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload shopping session <ArrowRight size={14} aria-hidden="true" /></button>}</div>}
            {callback && <div className="verification-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void verifyPayment(callback)}>Retry verification<ArrowRight size={16} aria-hidden="true" /></button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => { clearCallbackUrl(); setCallback(null); setError(''); setStatus('Verification dismissed. A payment has not been confirmed here.'); }}>Dismiss verification</button></div>}
          </div>
          {!receipt && <div className="basket-bottom"><Leaf size={14} aria-hidden="true" /><span>A considered basket. A clearer checkout.</span></div>}
        </aside>
      </div>

      <section id="how-it-works" className="how-section page-width" aria-labelledby="how-heading"><div><span className="eyebrow">A SIMPLER WAY TO SHOP</span><h2 id="how-heading">From “I need” to “just right.”</h2><p>Three small steps. One less thing to think about.</p></div><ol className="how-steps"><li><span className="step-number">01</span><div><h3>Describe your day.</h3><p>A trip, a fresh desk, a thoughtful gift. Add your budget and the things that matter.</p></div><ChevronRight aria-hidden="true" /></li><li><span className="step-number">02</span><div><h3>Check your basket.</h3><p>See what fits, why it fits, and the complete cost. Shipping is already included.</p></div><ChevronRight aria-hidden="true" /></li><li><span className="step-number">03</span><div><h3>You give the go-ahead.</h3><p>Try the sample flow or approve on PayPal Sandbox. Your receipt follows verification.</p></div><CheckCircle2 aria-hidden="true" /></li></ol></section>
    </main>

    <footer className="site-footer page-width"><a className="wordmark footer-wordmark" href="#"><Leaf aria-hidden="true" size={22} />ClearCart<span className="brand-dot">.</span></a><p>A little more considered.</p><span>Sample catalog. Demo checkout. No real money moves.</span></footer>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</div>

    <dialog ref={dialog} className="approval-dialog" aria-labelledby="approval-title" aria-describedby="approval-description" onCancel={closeSample} onClose={() => { setSampleOrder(null); checkoutButton.current?.focus(); }}>
      <button className="dialog-close" type="button" aria-label="Cancel sample checkout" onClick={closeSample}><X size={20} aria-hidden="true" /></button>
      <span className="dialog-icon"><ShoppingBag size={25} aria-hidden="true" /></span><span className="eyebrow">SAMPLE CHECKOUT</span><h2 id="approval-title">One last look.<br />Then it’s your call.</h2><p id="approval-description">This is a sample order. No real money moves. Confirm only when you’re happy with your basket.</p>
      {quote && <div className="dialog-total"><span>{quote.lines.length} items · shipping included</span><strong>{money(quote.totalCents)} <small>USD</small></strong></div>}
      {error && <div className="error-box" role="alert"><p>{error}</p></div>}
      <button type="button" className="primary-button" disabled={Boolean(busy) || !sampleOrder} onClick={() => sampleOrder && void verifyPayment({ orderId: sampleOrder.orderId })}>{busy === 'capture' ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}<span>{busy === 'capture' ? 'Completing sample order…' : 'Confirm sample checkout'}</span></button>
      <button type="button" className="dialog-cancel" disabled={busy === 'capture'} onClick={closeSample}>Back to my basket</button>
    </dialog>
  </>;
}
