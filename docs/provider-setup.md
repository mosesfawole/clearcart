# Free provider setup

Use these official provider dashboards:
- PayPal: https://developer.paypal.com/dashboard/
- Gemini: https://aistudio.google.com/app/apikey

## PayPal sandbox
Sign in yourself. In Apps & Credentials, select Sandbox, create an app named ClearCart, and use the sandbox business/merchant account. Copy its Client ID and Secret into PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local. Do not use Live credentials.

Under Testing Tools → Sandbox Accounts, use/create a Personal sandbox buyer account separate from the business seller. Its fake email/password are used only when PayPal opens the sandbox approval screen. This moves fake sandbox funds. Do not paste those credentials into chat or commit them.

### Merchant cannot accept a sandbox payment

`PAYEE_ACCOUNT_LOCKED_OR_CLOSED` means the merchant account is locked or closed; the code alone does not establish a country restriction. Create a fresh **Business sandbox** test account, choosing **United States** to isolate regional setup, and associate a **Sandbox REST app** with that merchant. Replace `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env.local` with the new app's credentials, restart the server, and start a fresh checkout. Existing orders belong to their original merchant: retain the old unpaid order and use the new checkout's approval link. This uses generated test accounts and fake funds, without changing your real account's country. Source: https://developer.paypal.com/api/rest/reference/orders/v2/errors/ and https://developer.paypal.com/tools/sandbox/accounts/.

## Gemini free tier
Sign in yourself and create an API key for a project with free-tier access. Leave paid billing disabled. Paste the key into GEMINI_API_KEY in .env.local. The default model is gemini-3.5-flash-lite, which current official pricing lists with free standard input/output; actual quota is visible in your AI Studio project. Do not assume a fixed quota. If it is unavailable in your account, stop and check free model availability rather than enable paid billing.

The app sends only the public sample catalog and shopping request to Gemini. Do not enter personal or payment information into the shopping request. Google lists free-tier data as used to improve its products: https://ai.google.dev/gemini-api/docs/pricing.

## Local configuration
Credentials stay only in .env.local, which Git ignores. Restart the Next.js server after changing credentials. Blank keys enable a labeled keyword/sample-payment flow. Once keys are present, the app uses actual Gemini and/or PayPal sandbox calls; provider errors are shown, not silently reported as successful integrations.

```dotenv
APP_URL=http://127.0.0.1:3000
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
```

## Verified integration and judging
A working key or developer login alone is insufficient. One actual Gemini interpretation and a buyer-approved $74.00 USD PayPal sandbox capture with its matching saved receipt were verified on 3 November 2026; see [the evidence record](evidence.md). For a fresh setup, repeat that end-to-end check with your own test accounts. See [judging instructions](judging.md) for complete free local access. Keep the working project free and available through 15 December 2026, 17:00 CET. Source: https://developer.paypal.com/tools/sandbox/ and https://paypalaihackathon.devpost.com/rules.
