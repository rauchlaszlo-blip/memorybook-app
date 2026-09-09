# PayPal payment foundation

This module uses PayPal Orders v2 with server-side OAuth 2.0.

Configuration:
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_ENVIRONMENT=sandbox|live` (defaults to `sandbox`)
- `PAYPAL_LIVE_ENABLED=true` is additionally required for live calls
- `PAYPAL_API_BASE_URL` may be overridden for controlled tests

Safety properties:
- deterministic `PayPal-Request-Id` values protect create/capture retries from duplicate actions;
- a purchase is finalized only when PayPal returns a completed capture whose order ID, amount and currency match the purchase;
- entitlement creation is idempotent because `book_entitlements.purchase_id` is unique;
- live PayPal calls are blocked unless explicitly enabled.

The HTTP route/UI wiring is intentionally a separate integration step.
