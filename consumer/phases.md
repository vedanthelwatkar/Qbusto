# Consumer App Development Phases

This file is the progress ledger and phase gate for the Consumer App.

Before starting any work:

1. Read this file first.
2. Do not skip ahead to a later phase.
3. Check the relevant specifications in `README.md` and `consumer-development-flow.md`.
4. Complete and validate the current phase before marking it complete.
5. Do not mark a phase complete just because code was written. Required validation for that phase must also be complete.
6. If implementation reveals a contradiction or architectural issue, stop and resolve it in the specification documents before continuing.

## Phase Progress

- [x] Phase 0A — Initial Consumer README created
- [x] Phase 0B — Contract contradictions resolved
- [x] Phase 0C — Exact backend source values verified
- [x] Phase 0D — QR/context contract finalized
- [x] Phase 1 — Consumer backend (IMPLEMENTATION COMPLETE, AWAITING VALIDATION)
- [ ] Phase 2 — Payment validation
- [ ] Phase 3 — OpenAPI/Orval
- [ ] Phase 4 — Frontend foundation
- [ ] Phase 5 — Screensaver/catalog
- [ ] Phase 6 — Cart/checkout
- [ ] Phase 7 — Razorpay frontend
- [ ] Phase 8 — Confirmation/failure
- [ ] Phase 9 — Validation
- [ ] Phase 10 — Final review

## Current Phase

**Phase 1 — Consumer backend**

Do not begin Phase 2 or any later phase until Phase 1 is implemented and its required validation is complete.

## Locked References

The following files are the source of truth for Consumer App development:

- `consumer/phases.md` — phase progress and development gate
- `consumer/README.md` — product requirements, API contracts, architecture, and technical decisions
- `consumer/consumer-development-flow.md` — detailed implementation flow and phase guidance

If these files conflict, stop and resolve the contradiction before implementing.

## Locked Phase 1 Decisions

Phase 1 must follow the finalized consumer API and payment design:

### Public consumer API

Consumer endpoints are unauthenticated and separate from staff APIs.

Required endpoints include:

- `GET /api/consumer/cinemas/{id}`
- `GET /api/consumer/cinemas/{cinemaId}/categories`
- `GET /api/consumer/cinemas/{cinemaId}/products`
- `GET /api/consumer/cinemas/{cinemaId}/products/{id}`
- `GET /api/consumer/cinemas/{cinemaId}/banners`
- `GET /api/consumer/cinemas/{cinemaId}/screens/{id}`
- `POST /api/consumer/orders`
- `POST /api/consumer/orders/{orderId}/payment-init`
- `POST /api/consumer/orders/{orderId}/payment-verify`

### Order creation idempotency

`POST /api/consumer/orders` requires an `Idempotency-Key` header.

- The frontend generates one UUID for a checkout attempt.
- The same key retried must return the same local order.
- A database-backed idempotency key association is required.
- The implementation must prevent duplicate local orders caused by network retries.

### Payment flow

The payment flow is:

1. Create local order.
2. Initialize payment using the existing `orderId`.
3. Open Razorpay Checkout on the frontend in a later frontend phase.
4. Verify the Razorpay signature on the backend.

`POST /api/consumer/orders/{orderId}/payment-init` must be idempotent.

If `razorpayOrderId` already exists, return the existing payment initialization data rather than creating another local order.

The backend remains authoritative for payment state.

A local order must never be marked as paid without successful server-side Razorpay signature verification.

### Razorpay consistency

Do not claim that database transactions and Razorpay API calls are globally atomic.

External Razorpay calls cannot be rolled back by Sequelize transactions.

The implementation must follow the documented two-phase design and handle retries safely.

### Money and pricing

- Backend calculates all prices.
- Use paise/integer calculations where specified in the consumer contract.
- Frontend must never be trusted for totals.
- Consumer order creation must reuse the same pricing and availability rules as existing order logic where appropriate.
- Consumer catalog pricing must use the same underlying pricing rules so displayed and charged prices do not drift.

### Authentication

There is no consumer login or authentication.

Consumer APIs are public and must not use staff authentication middleware.

Staff APIs and consumer APIs must remain separate.

## Phase Completion Rule

Before changing a phase from `[ ]` to `[x]`:

1. Confirm all required implementation for that phase is complete.
2. Run the relevant validation and tests.
3. Fix real defects found during validation.
4. Update specifications if implementation required an approved contract change.
5. Update this file only after the phase is genuinely complete.
6. Report exactly what was implemented, what was validated, and any intentionally deferred items.

Do not automatically start the next phase after completing the current one unless explicitly instructed.
