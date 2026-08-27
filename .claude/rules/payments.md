---
paths:
  - backend/src/services/cashfree.client.js
  - backend/src/services/paymenttransition.service.js
  - backend/src/services/paymentwebhook.service.js
  - backend/src/services/paymentgatewayconfig.service.js
  - backend/src/controllers/paymentwebhook.controller.js
  - backend/src/controllers/paymentgatewayconfig.controller.js
  - backend/src/controllers/consumer.controller.js
  - backend/src/routes/webhook.routes.js
  - backend/src/routes/paymentgatewayconfig.routes.js
  - backend/src/routes/consumer.routes.js
  - backend/src/utils/credentials.js
  - backend/src/validators/paymentgatewayconfig.validators.js
  - backend/src/config/env.js
  - backend/models/paymentgatewayconfig.js
  - backend/models/order.js
  - backend/models/payment-webhook-event.js
  - consumer/src/utils/paymentState.ts
  - consumer/src/utils/paymentAttempt.ts
  - consumer/src/utils/formatApiError.ts
  - consumer/src/pages/PaymentPage.tsx
  - dashboard/src/components/cinemas/CinemaPaymentGatewayModal.tsx
  - dashboard/src/components/cinemas/CinemaDetailsDrawer.tsx
---

# Payments — Cashfree (migrated from Razorpay, complete)

QBusto has fully migrated from Razorpay to **Cashfree**. No Razorpay code,
dependency or configuration remains anywhere in the repository.

Consumer endpoints, all idempotent (coupon preview is read-only and needs no
idempotency key):

```
POST /api/consumer/orders                                    (Idempotency-Key header required)
POST /api/consumer/cinemas/:cinemaId/coupons/validate         (preview a coupon before ordering)
POST /api/consumer/orders/:orderId/payment-init
POST /api/consumer/orders/:orderId/payment-verify
POST /api/webhooks/cashfree                                   (raw body, HMAC-authed, no JWT)
```

**The single most important piece of this system:**
`backend/src/services/paymenttransition.service.js` → `applyPaidTransition()`.
It is a **compare-and-set** (`UPDATE … WHERE payment_status_id = pending`)
called by **four independent discovery paths** — this seam is
**provider-agnostic and survived the migration untouched**:

1. Browser `payment-verify` — takes no identity from the request; Cashfree's
   hosted checkout hands the browser no cryptographic credential, so it asks
   Cashfree directly, server-to-server, "was this order paid".
2. Webhook (`PAYMENT_SUCCESS_WEBHOOK`)
3. Pull reconciliation (`cashfree.client.fetchOrderPayments`, timeout via
   `CASHFREE_TIMEOUT_MS`, default 4s) — triggered on re-hitting `payment-init`
   or `payment-verify`, **not** a cron
4. `payment-init` itself, when an order **with real items** discounted to
   **exactly zero** — there is nothing left to ask Cashfree to collect (its
   own create-order API refuses `order_amount` 0 outright, verified live), so
   the order is confirmed paid immediately, with no gateway order ever
   created. The response carries `paymentStatus: 'paid'` (`gatewayOrderId`/
   `paymentSessionId` both `null`) and the Consumer skips straight to the
   confirmation screen instead of rendering a Pay button for ₹0.
   **`POST /api/consumer/orders` requires `items` to be non-empty**
   (`backend/src/validators/consumer.validators.js`, `min(1)`) — this is load
   -bearing, not incidental: an empty cart would otherwise also reach ₹0 and
   get auto-confirmed by this same path with nothing in it and no payment
   taken. Found and fixed as a BLOCKER in an adversarial security review; see
   memory.md §8.16.

Whichever lands first wins; the others are harmless no-ops. It also calls
`fulfilment.confirmOnPayment()` (another CAS, `initiated → confirmed`), which
is what makes the order appear on the Kitchen display — exactly once. Verified
live under 5-way concurrent webhook delivery: exactly one transition, one
kitchen ticket, every time.

**Other invariants:**
- `orders.gateway_order_id` (renamed from `razorpay_order_id`) has a
  **filtered UNIQUE index**; init uses CAS on `WHERE gateway_order_id IS NULL`
  → one gateway order per QBusto order, ever. The gateway order id is
  **deterministic** (`qbusto_order_<orderId>`), not random, so Cashfree's own
  `x-idempotency-key` is a second independent guard on the same invariant.
- Webhook dedup = `payment_webhook_events.event_id` (renamed from
  `razorpay_webhook_events`) **UNIQUE constraint** — Cashfree sends no
  dedicated event-id header, so the key is derived: `${event}:${cfPaymentId ||
  gatewayOrderId}`.
- `PAYMENT_FAILED_WEBHOOK` / `PAYMENT_USER_DROPPED_WEBHOOK` are **recorded but
  never mutate order state** — a failed/dropped attempt must stay retryable.
  Only staff can set `failed`.
- **PENDING is a distinct, load-bearing state.** A UPI collect not yet
  approved/declined must never be treated as a safely-retryable failure.
  `reconcilePaymentFromGateway` reports `gatewayPending: true` whenever any
  attempt is still outstanding (deliberately not amount-filtered), and
  `payment-verify`'s 409 carries it through so the frontend keeps the payment
  attempt alive instead of offering a second charge.
- Webhook signature: `HMAC-SHA256(CASHFREE_SECRET_KEY, timestamp + rawBody)`,
  **base64**, compared with `crypto.timingSafeEqual`. Three differences from
  the old Razorpay algorithm that would silently break verification if reused
  naively: the timestamp is signed material (not just a header), the digest is
  base64 not hex, and there is **no separate webhook secret** — the API secret
  key does double duty.
- **No refund API integration.** `refunded` is a staff-only DB status flip;
  actual refunds happen in the Cashfree Dashboard.
- **No expiry job.** An abandoned order sits `pending` indefinitely.
- Payment statuses: `pending → {paid,failed}`, `failed → {pending,paid}`,
  `paid → refunded`. Order statuses: `initiated → confirmed → preparing →
  ready → delivered`, plus `rejected`.
- **`CASHFREE_NOTIFY_URL`/`CASHFREE_RETURN_URL` are both optional and, in this
  environment, both unset.** `RETURN_URL` being unset is fine — the Consumer
  recovers via `sessionStorage`, not the URL. `NOTIFY_URL` unset means webhook
  delivery depends entirely on a webhook being registered directly in the
  Cashfree Dashboard (Developers → Webhooks) instead — confirm this exists for
  the production account before go-live; see
  [pre-production-checklist.md](../../docs/pre-production-checklist.md).
- **Cashfree has ZERO involvement in coupons/discounts, by design.**
  `reconcilePaymentFromGateway` and the webhook both require the collected
  amount to equal `order.total` **exactly** — no exceptions, no offer
  reasoning, no "short by a known amount is OK" branch. An earlier design
  tried the opposite (mirroring coupons into Cashfree's own offer system via
  `order_meta.offer_filters` and accepting a short payment as evidence of a
  valid redemption) and was **deliberately reverted**: it meant a third party
  could ultimately decide what a customer owed, which a demo offer observed
  in Cashfree's own sandbox (`testRetoolTPAPUPIoffer`, redeemable despite
  existing nowhere in the merchant's own Offers dashboard) showed is not safe
  to trust. See [coupons.md](./coupons.md) for what replaced it.

## Environment — Cashfree-specific boot guards

Validated by Joi in `backend/src/config/env.js`, which **throws at boot** on
misconfiguration. Everything reads from this module, not `process.env` — no
exceptions; the Razorpay-era `process.env.RAZORPAY_KEY_ID`/`_SECRET` direct
read in `consumer.service.js` no longer exists.

Boot guards worth knowing: production + missing `CASHFREE_APP_ID`/
`CASHFREE_SECRET_KEY` → **throw**; production + `CASHFREE_ENVIRONMENT` not
`prod`/`production` → **throw** (a production deploy pointed at the Cashfree
sandbox would look completely healthy while taking no real money); non-prod +
`CASHFREE_ENVIRONMENT=prod`/`production` → warn (charges real cards); only one
of the credential pair set → warn.

Key vars: `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENVIRONMENT`,
`CASHFREE_NOTIFY_URL` (optional), `CASHFREE_RETURN_URL` (optional),
`CASHFREE_FALLBACK_CUSTOMER_PHONE`, `CASHFREE_TIMEOUT_MS`,
`CREDENTIALS_ENCRYPTION_KEY` (64 hex chars / 32 bytes — required to
encrypt/decrypt any `payment_gateway_config` row; see "Per-cinema Cashfree
credentials" below). `CASHFREE_APP_ID`/`_SECRET_KEY`/`_ENVIRONMENT` are now
the **fallback** used only when a cinema has no active
`payment_gateway_config` row, not the sole credential source. There is **no
separate webhook secret** — Cashfree signs with the resolved cinema's
`CASHFREE_SECRET_KEY`-equivalent itself. Never commit values.

## Per-cinema Cashfree credentials

Cashfree APP_ID/SECRET_KEY are **not** only a single global env-var pair any
more. Each cinema may run its own Cashfree merchant account, stored in
`payment_gateway_config` (one **active** row per cinema, enforced by a
filtered unique index; replacing a credential deactivates the old row rather
than overwriting it, so which credential a cinema was on at any point stays
recoverable).

- `gateway_secret_encrypted` is **AES-256-GCM ciphertext**, never plaintext —
  encrypted/decrypted only by `backend/src/utils/credentials.js`. The key,
  `CREDENTIALS_ENCRYPTION_KEY` (64 hex chars / 32 bytes), lives **outside the
  database entirely**, so a DB leak alone cannot recover a working credential.
- `environment` (`test`/`sandbox`/`prod`/`production`, mirroring
  `CASHFREE_ENVIRONMENT`'s own vocabulary) is its own column, not folded into
  the still-unused `gateway_url` column.
- Resolution order, in `cashfree.client.resolveCredentials(cinemaId)`: that
  cinema's active `payment_gateway_config` row **first**; the global
  `CASHFREE_*` env vars **only as a fallback**, logged loudly every time that
  fallback fires. The webhook has the harder version of this problem —
  verifying a signature requires knowing which cinema's secret to check
  against, before the body can be trusted at all — solved by reading
  `data.order.order_id` out of the **unverified** body purely as a lookup key
  (never as a fact), then resolving credentials from the QBusto order it
  points to; an order that cannot be found falls back to the global secret so
  a genuinely-unknown gateway order is still recorded as `unknown_gateway_order`
  (200) rather than refused as unverifiable (400).
- A wrong/revoked credential surfaces to the customer as the same clean 503
  ("Payment provider temporarily unavailable") a not-configured cinema gets —
  `cashfree.client.isAuthError()` catches Cashfree's 401/403 specifically so a
  bad `payment_gateway_config` row never leaks a raw provider stack trace to
  a customer-facing endpoint. Verified live by intentionally corrupting a
  cinema's stored secret.
- **Mandatory at cinema creation.** `POST /api/cinemas` requires
  `gatewayId`/`secretKey`/`environment` and creates the cinema plus its
  `payment_gateway_config` row in one transaction — a cinema is never left
  created-but-unable-to-take-payment because a second, separate request
  happened to fail. Replacing credentials on an *existing* cinema stays a
  separate action: `Cinemas → (cinema) → Payment gateway`, backed by
  `PUT/DELETE /api/payment-gateway-config` (Settings module permission).
  `secretKey` is accepted on write and never appears in any response —
  `hasSecret` is the only way to confirm one is on file.
