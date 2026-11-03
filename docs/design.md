# ClearCart project definition — 3 November 2026

Chosen project: ClearCart for PayPal AI. Solo, zero budget, global audience. The user selected the previously proposed accessible, constraint-checked shopping and sandbox-checkout concept and authorized proceeding.

## Problem and user
Shoppers at small online stores can struggle to express several product requirements and understand the final price. Baymard's US research reports checkout complexity and unclear costs as abandonment reasons; these figures are not global prevalence estimates (https://baymard.com/lists/cart-abandonment-rate). ClearCart tests whether a plain-language request plus visible, checked totals can make a small shopping task easier. Accessible controls help keyboard and screen-reader users without limiting the audience to one demographic.

## MVP
Must: a curated catalog; typed requests and explicit budget; visible material/weight filters; real Gemini intent interpretation when configured; independently enforced product, quantity, material and total constraints; immutable server quote; buyer approval; actual PayPal sandbox order/create/capture when configured; verified receipt; duplicate protection; usable errors; clearly labeled no-key sample mode; README and meaningful tests.

Should: real-user feedback and a measured comparison with manual browsing, one reliable backup recording, refined suggestions. Cut from this build: voice, real-money payments, production fulfillment, multi-merchant search, legal/tax calculation, refund workflows, accounts, autonomous purchasing, webhooks and international currency conversion.

## Architecture and alternatives
Use Next.js/TypeScript for UI and server routes, Gemini HTTP structured output for intent, Node 24 built-in SQLite for local quotes/orders, and PayPal REST Orders v2 with buyer redirect approval. A standalone API plus frontend would add setup without improving the local demo. A provider-only chatbot would leave pricing and payment truth too dependent on AI. Chosen design keeps intent interpretation separate from deterministic basket selection and payment verification.

Browser request → intent interpreter → catalog matcher with explicit constraints → persisted quote → buyer reviews → server creates sandbox order → buyer approves on PayPal → server captures and retrieves order → amount/currency/custom ID checked → one receipt persisted. Server prices use integer USD cents; no browser or model-supplied prices are accepted. Quotes belong to a random HTTP-only browser session and expire after 15 minutes. Orders use unique quote IDs and stable provider request IDs. Local SQLite retains receipts across restart. Single local Node process is the supported deployment.

Sample mode uses a documented keyword intent parser and simulated payment approval. It is development assistance, not evidence of working AI or PayPal integration. Adding a Gemini key enables actual model calls; adding both PayPal sandbox credentials enables real sandbox calls. Provider failures remain visible. No production PayPal endpoint exists in the code. Catalog, $5 shipping and zero demonstration tax are owned sample data, not real merchant promises.

## Build sessions and dates (CET)
3 Nov: runnable local end-to-end sample flow, tests and integration adapters. 4–5 Nov: user obtains free Gemini and PayPal sandbox credentials, verify real calls and buyer approval. 6–8 Nov: test failure cases, accessibility and brief user task comparison. 9 Nov: feature freeze. 10 Nov: record under-three-minute demo and prepare submission copy. 11 Nov: target submission and link/setup checks. Published deadline in prior intake: 12 Nov at 21:00 CET; recheck official rules before submission. Judging access must remain available 1–15 Dec. All tasks belong to the solo entrant, with Codex assisting implementation.

## Risks and evidence
Sandbox access unavailable (medium likelihood/high impact): check early, keep local sample development separate from qualification claims; reconsider event if unavailable. Free model quota unavailable (medium/high): avoid paid billing; verify quota and exact free model, use explicit sample mode only for development. Incomplete/duplicate capture (medium/high): stable request IDs, stored order, retrieval and exact amount checks; test with controlled gateway responses. Crowded commerce category (high/medium): show constrained substitution and clear approval, collect task evidence. Deadline pressure (medium/high): narrow catalog, early working flow, feature freeze and one-day submission buffer.

Success evidence: real sandbox order ID and verified capture; one receipt after repeated callback; rejection of forged/mismatched payment or invalid product IDs; a basket under the exact complete budget; keyboard-completable flow; measured task time and short user feedback if collected. No claimed usability improvements until measured.

## Project State
Selected: ClearCart. Design: small owned catalog, sample data, one USD sandbox flow. Credentials: not yet available; account tabs requested. Next: implement/test sample slice, then verify real provider flows when credentials are ready. Agentware remains a later separate build.
