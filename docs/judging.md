# Judging and running ClearCart

ClearCart is a functional desktop/mobile browser app with a Node server. The official PayPal AI rules accept complete repository setup and run instructions as judging access; public deployment is optional. This build uses a single Node 24+ process and a local SQLite ledger.

## Fresh-clone setup

Install Node.js 24 or later and Git, then run:

```sh
git clone https://github.com/mosesfawole/clearcart.git
cd clearcart
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000/** in one browser. With no credentials configured, both mode badges explicitly say sample. The complete interactive sample flow works without any provider account, subscription or paid hosting. It performs no external AI call or PayPal transaction.

To use your own free Gemini and PayPal sandbox accounts, stop the server, copy `.env.example` to `.env.local`, fill in its provider fields using the instructions below, and restart `npm start`. Keep `APP_URL=http://127.0.0.1:3000` and open that exact origin.

PowerShell:

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux:

```sh
cp .env.example .env.local
```

The production build does not require credentials. Server-side provider configuration is read at runtime. `.env.local` and `data/` are ignored by Git; never add either to the public repository.

## Run a shopping task

1. Start with **Travel light**: “A lightweight travel kit under $75, no leather.” Keep budget $75 and both preferences selected. Choose **Find my basket**.
2. Review the three products: Everyday Daypack $27, Steel Water Bottle $18 and Compact Travel Charger $24. Subtotal $69, shipping $5, demonstration tax $0, total **$74 USD**.
3. In sample mode, choose **Try sample checkout**, inspect the approval dialog and choose **Confirm sample checkout**; expect a clearly labeled **sample receipt**. In configured sandbox mode, choose **Continue to PayPal Sandbox**, review and approve on PayPal's sandbox site; expect **Sandbox payment verified** only after the server verifies the completed capture.
4. Try **Desk refresh** with budget $65, then **A thoughtful gift** with budget $40. Each successful basket must stay within the complete budget including shipping. The model can vary valid selections; catalog prices and final totals are always computed on the server.
5. Try the travel request with a $50 total budget. ClearCart must explain that the complete requested basket does not fit. It must not exceed the budget or initiate checkout for an invalid basket.

Quotes expire after 15 minutes. Keep approval and return in the same browser and tab, with cookies available. Opening an old checkout in another browser/device or clearing its cookie intentionally prevents access to the original owner's order. If verification encounters a transient provider/network error, use **Retry verification** for the same order.

The three exact starter requests use shared category lists: travel includes a bag, bottle and charger; desk includes a notebook and lamp; gift includes a bottle and notebook. In Gemini mode, successful model output supplies product preferences within that starter scope. Editing the request to ask for extra items uses the custom interpretation; those extra categories must also fit the complete budget. The app never removes a custom requested category merely to make a basket affordable.

## Genuine Gemini and PayPal sandbox

[Provider setup](provider-setup.md) explains obtaining a free Gemini key and a PayPal sandbox merchant app. Leave paid Gemini billing disabled; the model must be available within your own project's free quota. Gemini receives the public fictional catalog and request text. Do not enter personal/payment details in that request; Google lists free-tier data as used to improve its products.

Use both merchant sandbox fields, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, for the real sandbox adapter. Create a **separate Personal sandbox buyer** in PayPal Developer → Testing Tools → Sandbox Accounts, with fake funds sufficient for the $74 test. Use that generated buyer email/password on `sandbox.paypal.com`; the merchant Business account is the seller, not the buyer. No real money or physical goods move.

With all provider fields set, the app must show **Gemini assistant** and **PayPal Sandbox**. Provider failures appear as errors; they do not silently become successful sample transactions. The PayPal API endpoint is permanently sandbox-only.

The entrant's existing merchant secret and buyer password are not public. The setup above supports a full genuine integration using the reviewer's own free test accounts. If entrant-provided test access is needed, use the hackathon's private testing/access instructions; never post provider secrets, test passwords or personal account credentials in a public README, issue or video. Private shared access is not supplied by this repository.

## Checks and limitations

```sh
npm test
npm run typecheck
npm run build
```

The controlled test suite covers basket totals and constraints, input validation, session ownership, payment evidence and duplicate callbacks. Genuine provider evidence is recorded separately in [evidence.md](evidence.md).

Catalog products, stock, USD pricing, flat $5 shipping and zero tax are fictional demonstration data. There is no real fulfillment or international tax calculation. SQLite files persist on the machine where the server runs. Do not deploy this unchanged build to multiple processes, serverless functions or an ephemeral filesystem if you require retained orders/receipts. Local DNS troubleshooting is environment-specific and not part of the application.

Free repository access must remain available through the judging end, **15 December 2026, 17:00 CET**, as required by the [official rules](https://paypalaihackathon.devpost.com/rules).
