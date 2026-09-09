# Payment foundations

## PayPal

Uses PayPal Orders v2 with server-side OAuth 2.0.

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

## SimplePay

Uses the SimplePay Online API v2 protocol. Requests and responses are signed with Base64-encoded HMAC-SHA384 over the exact raw JSON body.

Configuration:
- `SIMPLEPAY_MERCHANT_ID`
- `SIMPLEPAY_SECRET_KEY`
- `SIMPLEPAY_ENVIRONMENT=sandbox|live` (defaults to `sandbox`)
- `SIMPLEPAY_LIVE_ENABLED=true` is additionally required for live calls
- `SIMPLEPAY_API_BASE_URL` may be overridden for controlled tests

Safety properties:
- live SimplePay calls are blocked unless explicitly enabled;
- every synchronous SimplePay response signature is verified before its JSON is trusted;
- transaction ID, order reference, amount and currency are checked against the purchase before a start response is accepted;
- incoming IPN messages must pass raw-body HMAC-SHA384 signature verification and merchant-ID validation;
- only a signed `FINISHED` IPN with the transaction ID already stored from the validated start response may mark a purchase paid;
- entitlement creation is idempotent because `book_entitlements.purchase_id` is unique;
- the IPN acknowledgement is returned as compact JSON with `receiveDate` and its own `Signature` header value.

SimplePay HTTP integration routes:
- `POST /api/purchases/:purchaseId/simplepay/start` creates the signed provider transaction and returns its payment URL;
- `POST /api/payments/simplepay/ipn` verifies the exact raw request body and returns the exact signed acknowledgement body;
- `GET /api/purchases/:purchaseId/simplepay/status` exposes only the locally verified purchase state for the browser return flow.

The browser redirect never marks a purchase paid. Only a verified `FINISHED` IPN may finalize the purchase and create the entitlement. The SimplePay merchant/sandbox IPN configuration must point to `/api/payments/simplepay/ipn` when provider credentials are configured.

Real provider credentials and purchase pricing remain separate configuration steps. Purchase pricing must exist before either provider may start a payment.
