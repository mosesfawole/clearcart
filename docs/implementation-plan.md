# ClearCart Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task; delegate independent research and review. Steps use checkbox syntax.

**Goal:** Deliver one runnable shopping-request-to-receipt flow with real-provider adapters and a transparent sample mode.

**Architecture:** The server owns catalog constraints, quotes and order truth. Browser components display plans and obtain buyer approval. External calls have bounded timeouts, stable payment IDs and explicit failures.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, Node 24 SQLite; direct Gemini and PayPal REST calls.

**Spec:** docs/design.md

## Global constraints
- No paid services, production payments, credentials in source, or automatic purchasing.
- Prices and budgets use integer USD cents. Demo shipping is $5; demo tax is zero.
- Quotes expire after 15 minutes and belong to an HTTP-only session.
- Model intent never supplies trusted price, payment status or permission.
- No-key sample mode is labeled throughout and is not a qualifying integration demo.

## Task 1: Authoritative basket
Files: src/lib/catalog.ts, src/lib/basket.ts, tests/basket.test.ts.
Interface: recommendBasket({categories, preferredProductIds}, budgetCents, constraints) → Basket with authoritative lines/totals or a descriptive failure.
- [x] Write tests for a $74 travel kit within $75, preference substitution, no-leather/lightweight constraints, total including shipping, and impossible budget.
- [x] Run `npm test -- tests/basket.test.ts` and observe failure before implementation.
- [x] Implement catalog matching and reject invalid values with schemas; compute all totals from owned catalog.
- [x] Run the same tests; inspect literal totals and error behavior.

## Task 2: Intent and checkout
Files: src/lib/intent.ts, src/lib/paypal.ts, src/lib/store.ts, src/lib/checkout.ts, src/lib/http.ts; tests/checkout.test.ts.
Interfaces: interpretRequest(text) → Intent; payment gateway create(Order), capture(Order) → verified provider order; store persists session-owned quotes and orders.
- [x] Write tests proving one persisted receipt after repeated capture, mismatched amount/currency/custom-ID rejection, and session ownership rejection.
- [x] Run tests and observe missing behavior.
- [x] Implement fixed sandbox HTTP gateway, structured Gemini interpreter and explicit sample adapter. Use stable PayPal-Request-Id and verify retrieved captured order against stored cents and currency.
- [x] Run tests with a controlled gateway double at the external HTTP boundary and real persistence in a temporary directory.

## Task 3: Accessible storefront and routes
Files: src/app/layout.tsx, page.tsx, globals.css; src/app/api/config/route.ts, recommend/route.ts, checkout/route.ts, capture/route.ts.
- [x] Connect the storefront to server routes; request inputs are schema-validated and write routes reject cross-origin requests.
- [x] Display catalog, editable constraints, checked basket, approval/cancellation, errors and verified receipt. Keep sample/sandbox status visible.
- [x] Run `npm run typecheck` and `npm run build`.
- [x] Launch locally and complete a browser sample checkout; inspect narrow-screen layout and keyboard labels.

## Task 4: Review and delivery
Files: README.md, LICENSE, docs/project-state.md, local environment file.
- [x] Independently review correctness and integration contracts; fix actionable findings and rerun covering tests.
- [x] Document exact setup, free access, sample versus real behavior, and unverified external checks.
- [x] Verify unit/integration tests, types, production build and browser flow; open the app here.

Live provider checkpoint — 3 November 2026: Gemini interpretation, PayPal sandbox order creation, Personal buyer approval, completed $74.00 USD capture and matching saved receipt are verified. See docs/evidence.md. The public repository passed fresh-clone validation and the 95-second captioned video is public on YouTube. User feedback and final Devpost entry remain delivery work.
