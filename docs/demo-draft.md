# Demo draft — 2 minutes 40 seconds

Record only after genuine Gemini and PayPal sandbox calls work. A sample-only video is a development preview, not the qualifying integration demo. Verify exact submission requirements before upload.

| Time | Screen/action | Narration |
|---|---|---|
| 0:00–0:20 | Request and budget visible | “Finding several things within a budget usually means comparing products and adding up costs. ClearCart lets a shopper describe the task and review a checked basket before approving checkout.” |
| 0:20–0:55 | Type travel-kit request, set $75, lightweight/no-leather | “I need a lightweight travel kit, no leather, under $75. Gemini interprets the request. The server checks the owned catalog, materials, stock and the complete budget.” |
| 0:55–1:15 | Show three items and exact $74 total | “These three items cost $69. Shipping is $5 and this demonstration uses zero tax, so the exact total is $74. The AI cannot set prices or raise this budget.” |
| 1:15–1:55 | Continue to PayPal Sandbox, buyer approves, app verifies capture | “The buyer approves on PayPal's sandbox page. ClearCart creates and captures an actual fake-money sandbox order, then verifies the completed capture's identity, USD currency and exact amount before issuing this receipt.” |
| 1:55–2:20 | Explain verified receipt and retry evidence | “The saved quote and stable payment request IDs protect the flow on retries. Our controlled tests verify that duplicate callbacks produce one receipt and that a mismatched or declined capture does not become a paid order.” |
| 2:20–2:40 | Architecture and honest scope | “ClearCart combines useful AI intent interpretation with accessible shopping and a meaningful PayPal integration. This MVP uses a small fictional catalog; the next step is merchant data and measured user feedback. The repository includes a clearly labeled sample mode and complete local setup.” |

Prepare a backup recording of the same genuine flow. Do not show credentials, buyer passwords or personal information. Do not claim time savings until measured. Use test evidence for failures that cannot be safely triggered live; distinguish a controlled test from a live integration run.

## Before recording
- Free Gemini response confirmed for the exact model/account.
- PayPal Sandbox create, buyer approval, capture and retrieval confirmed.
- Paid receipt matches $74, currency and provider identifiers.
- One retry returns the same receipt; failed capture remains unpaid.
- Keyboard navigation, narrow viewport and useful error messages checked.
- Public repo has MIT license, setup instructions and .env.example; secrets ignored.
- Public YouTube video under three minutes; all required submission fields and judge access checked.
