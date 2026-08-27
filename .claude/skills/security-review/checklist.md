# Security review checklist

## From memory.md §8.16 (found live, real BLOCKER + HIGH)

1. **Every write endpoint has real server-side validation.** A `validate()`
   Joi middleware must be wired in front of the controller for every route
   that accepts a body, and its schema must match what the swagger
   annotation / `openapi.json` claims (`required`, `minItems`, `min`, etc).
   The §8.16 BLOCKER was exactly this gap: `items` was documented as
   `required, minItems: 1` in the OpenAPI contract but nothing enforced it,
   so `items: []` reached `buildOrderLines()` unchecked.
2. **Degenerate input reaching a terminal/side-effecting state.** Trace
   whether an empty array, zero/negative amount, or zero quantity could
   reach `applyPaidTransition()` or `fulfilmentService.confirmOnPayment()`
   without being independently rejected first. The §8.16 case: an empty
   cart discounted to ₹0 by the same path a legitimately fully-covered
   coupon order uses, and got auto-confirmed with no payment taken.
3. **Independently-capped values summing past a bound.** If two discount
   amounts, quantities, or other bounded values are combined
   (`productDiscountPaise + couponDiscountPaise`, etc.), confirm the *sum*
   is also capped, not just each value individually — this pushed
   `totalPaise` negative in the §8.16 HIGH finding before a
   `Math.min(sum, subtotalPaise)` fix.
4. **Frontend-only guards with no backend twin.** `CLAUDE.md`'s own rule is
   "frontends hold no business rules" — any client-side check
   (disabled-button condition, Zod/Yup schema) should have an independent
   backend enforcement of the same constraint. Flag any that don't.

## Payment invariants (shared with `payment-invariant-auditor`)

5. Every `pending → paid` transition goes through `applyPaidTransition()`
   (`backend/src/services/paymenttransition.service.js`) — a
   compare-and-set, never an unconditional write.
6. No gateway signal (webhook or otherwise) ever sets `failed` — only the
   staff-only `PUT /api/orders/:id/payment-status` endpoint may.
7. `backend/src/routes/webhook.routes.js` is mounted with `express.raw()`,
   never through `express.json()`, and mounted before any global JSON
   parser.
8. Amount verification (reconciliation and webhook) requires an **exact**
   match to `order.total` in paise — no offer-reasoning branch, no
   tolerance for "short by a known coupon amount."
9. Secrets live only in `payment_gateway_config.gateway_secret_encrypted`
   (AES-256-GCM via `backend/src/utils/credentials.js`) — never logged,
   never duplicated into a second column.
10. Out-of-scope resources return **404, never 403** — check any new
    tenant-scoped read/write for this.
