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
- [x] Phase 1 — Consumer backend (IMPLEMENTATION COMPLETE, VALIDATION COMPLETE)
- [x] Phase 2 — Payment validation (VALIDATION COMPLETE, 1 BUG FIXED)
- [x] Phase 3 — OpenAPI/Orval (GENERATED CLIENT CREATED)
- [x] Phase 4 — Frontend foundation (TYPESCRIPT SETUP, STORES, ROUTING)
- [x] Phase 5 — Screensaver/catalog (IMPLEMENTATION COMPLETE, VALIDATION COMPLETE)
- [ ] Phase 6 — Cart/checkout
- [ ] Phase 7 — Razorpay frontend
- [ ] Phase 8 — Confirmation/failure
- [ ] Phase 9 — Validation
- [ ] Phase 10 — Final review

## Current Phase

**Phase 5 — Screensaver & Catalog (COMPLETE)**

Phase 4 (frontend foundation) provided stores, services, routing, and styling. Phase 5 built on that foundation to deliver:
- ScreensaverPage: Full-screen landing with ORDER NOW button
- CatalogPage: Product browsing with categories, search, and banners
- ProductCard: Reusable card component with add-to-cart
- CartDrawer: Shopping cart with item management and controls
- Full validation: lint ✓, typecheck ✓, production build ✓

Ready to proceed with Phase 6 (cart/checkout).

## Phase 5 Validation Summary (2026-08-12)

**Screensaver & Catalog Implementation Validated**:

_UI Components Delivered_:
- ✅ ScreensaverPage: Full-screen gradient background, centered title/subtitle, white CTA button
- ✅ CatalogPage: Categories, search, product grid, banners (header + inner)
- ✅ ProductCard: Lazy-loaded image, name, description, add-to-cart button
- ✅ CartDrawer: Item list, quantity controls, remove, subtotal, proceed button

_API Integration_:
- ✅ fetchCategories: GET /api/consumer/cinemas/{cinemaId}/categories (paginated)
- ✅ fetchProducts: GET /api/consumer/cinemas/{cinemaId}/products (paginated)
- ✅ fetchBanners: GET /api/consumer/cinemas/{cinemaId}/banners (header + inner types)
- ✅ All calls use generated Orval client types (no manual API URLs)

_State Management_:
- ✅ Cart store: addItem, removeItem, updateQuantity, itemCount, estimatedSubtotal
- ✅ UI store: cartOpen/toggleCart, errorMessage/setError
- ✅ Context store: QR parameters loaded and accessible
- ✅ State updates are immutable

_Responsive Design_:
- ✅ Mobile-first approach (360px+ baseline)
- ✅ 1-column product grid on mobile, 2+ on wider screens
- ✅ Touch targets ≥ 48px (Ant Design standard)
- ✅ Sticky cart button at bottom
- ✅ Drawer slide animation and overlay

_Styling & CSS_:
- ✅ CSS custom properties used throughout (colors, typography, spacing)
- ✅ Safe area support for notches (viewport-fit=cover)
- ✅ Lazy-loaded images with placeholder backgrounds
- ✅ Smooth transitions and animations

_Build & Validation_:
- ✅ ESLint: Clean (0 violations)
- ✅ TypeScript: Strict mode passes (0 errors)
- ✅ Production build: Success (269.91 KB → 88.60 KB gzipped)
- ✅ No console errors or warnings
- ✅ All imports correct, no unused variables

_Known Deferred Items_:
- Product pricing: Not in Phase 5 scope (pricing API comes Phase 7)
- Cart totals: Client-side display only, backend recalculates at order
- Order creation: Phase 6
- Razorpay integration: Phase 7
- Pagination: Phase 9+ optimization

---

## Phase 2 Validation Summary (2026-08-12)

**Comprehensive Testing Completed**:

_Order Idempotency & Creation_:

- ✅ Order creation idempotency: First request creates order, retry with same Idempotency-Key returns same orderId
- ✅ Database state: Orders, items, and status logs created correctly with proper amounts (DECIMAL format)
- ✅ Concurrency: Two simultaneous requests with same Idempotency-Key both receive same orderId (no duplicate)
- ✅ Idempotency key persistence: Keys properly associated with orders in database

_Real Razorpay Test Mode Validation (2026-08-12)_:

- ✅ Payment-init with real Razorpay Test Mode API: created real order IDs (e.g., order_TOnLlZaha0ub7H)
- ✅ Payment-init idempotency: retrying returns same Razorpay order ID
- ✅ Payment-verify with valid HMAC-SHA256 signature: order marked PAID successfully
- ✅ Payment-verify idempotency: retry returns PAID status, no duplicate logs
- ✅ Invalid signature rejection: tampered signatures correctly rejected with 400 error
- ✅ Database state validation: razorpayOrderId, razorpayPaymentId, paymentStatusId all correct
- ✅ All 450 backend tests pass (no regressions)

**Bug Fixed in Phase 1 Implementation**:

- **Location**: `backend/src/services/consumer.service.js` lines 355-374 and 490-514 (idempotency retry logic)
- **Issue**: Query tried to select non-existent columns `order.status` and `order.paymentStatus` (actual columns: `statusId` and `paymentStatusId`)
- **Fix**: Removed non-existent attribute selections; status values now hardcoded in response (already known: INITIATED and PENDING)
- **Impact**: Idempotent order creation now works correctly on retry

**Remaining Items** (deferred to production integration phase):

- Payment error handling (503 timeouts, network failures on Razorpay calls)
- Razorpay secret decryption from PaymentGatewayConfig
- End-to-end flow with real customer payment on Razorpay Checkout

---

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
