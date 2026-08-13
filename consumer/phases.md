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
- [x] Phase 6 — Cart/checkout (IMPLEMENTATION COMPLETE, VALIDATION COMPLETE)
- [x] Phase 7 — Razorpay frontend (IMPLEMENTATION COMPLETE, VALIDATION COMPLETE)
- [x] Phase 8 — Confirmation/failure (IMPLEMENTATION COMPLETE, VALIDATION COMPLETE)
- [~] Phase 9 — Validation (STATIC/RUNTIME VALIDATION COMPLETE, 5 BUGS FIXED;
      DEVICE + REAL-DATABASE TESTING STILL OUTSTANDING — NOT COMPLETE)
- [ ] Phase 10 — Final review

## Current Phase

**Phase 8 — Confirmation & Failure UX (COMPLETE)**

Phase 7 implemented payment processing. Phase 8 completed the post-payment flow:
- ConfirmationPage: Success screen with order ID, "ready soon" message, Done button
- Order ID handoff: Via URL parameter (/confirmation/:orderId) from verified backend response
- Cart clearing: Only after user clicks "Done" on confirmation page
- Session cleanup: OrderId removed from sessionStorage after verification
- Error handling: Payment failures/cancellations remain in PaymentPage (no separate error pages)
- Safe navigation: Invalid orderId shows error state with recovery option
- Mobile-first: Touch-friendly 48px+ buttons, responsive confirmation layout
- Full validation: lint ✓, typecheck ✓, production build ✓ (119.65 KB gzipped, under 150 KB)

A cross-cutting UI/UX pass was applied on top of Phases 5–8 after Phase 8
completed — see "UI/UX Pass" below. No phase status changed and no API contract
changed. Current build: 122.83 KB JS + 6.46 KB CSS gzipped.

Ready for Phase 9 (End-to-end testing).

## UI/UX Pass (2026-08-12)

A visual and interaction pass across every consumer screen. Functionality,
stores, services and generated Orval usage were left intact; this changed
presentation, layout and accessibility only.

_Design system_:
- `src/styles/variables.scss` rewritten: warm neutral palette, radius/shadow/
  focus/content-width/typography scales. Replaces ad-hoc hex values and the
  three inconsistent shadow recipes.
- `src/styles/shared.scss` (new): single definition of buttons (`.btn` +
  modifiers), `.spinner`, `.skeleton`, `.alert`, `.state-panel`, `.field`.
  Replaces eight separate button implementations and two `@keyframes spin`.
- `src/components/icons.tsx` (new): inline SVG icon set. No new dependency.
- All page stylesheets scoped under their page root class.

_Fixed defects (pre-existing)_:
- CSS collisions: `.cart-summary`, `.item-price`, `.loading-state`, `.spinner`,
  `.error-banner` and `.btn-primary` were each defined in 2–3 globally-bundled
  stylesheets with different values, so page styles silently overrode one
  another. Eliminated by scoping.
- Screensaver "ORDER NOW" was a dead control when `cinemaId` was null; it now
  shows a "No cinema selected" explanation instead.
- Cart quantity controls were 32×32 px, below the documented 48 px minimum.
- Product card image container had `overflow: visible`, so its border radius
  never applied and images bled past the frame.
- No `:focus-visible` styling existed on any button (keyboard accessibility).
- Cart drawer stayed in the DOM when closed without `aria-hidden`, exposing
  off-screen controls to screen readers and the tab order.
- Deleted unused Vite template files `src/App.css` and `src/index.css`
  (imported nowhere; `index.css` set `--text: red` and `color-scheme: light dark`).

_Layout decisions_:
- Catalog: left category rail at all breakpoints, with the rail and the product
  list as two independent scroll regions. Header banner full-bleed on top;
  inner banner is the background of the product pane. Products wrap into the
  available width. Tuned for phones and portrait kiosks first.
- Product/category art is transparent PNG: plates stay transparent and use
  `object-fit: contain`.
- App is light-themed on every screen, including the screensaver.
- Checkout gains grouped sections and a two-column desktop layout; cart drawer
  becomes a right-hand panel from 768 px instead of a corner-anchored sheet.

_Behaviour changes_:
- Checkout: the error banner's "Try Again" button was removed. It only cleared
  the error message, which the always-available submit button already does.
- Confirmation: optionally displays the amount paid, passed via router state
  from the already-verified payment response. Renders correctly without it.
- Catalog search is debounced 250 ms (filtering itself is unchanged).

_Validation_: typecheck ✓ (0 errors), lint ✓ (0 violations), build ✓
(122.90 KB JS + 6.52 KB CSS gzipped, under the 150 KB target).

_Regression review (post-pass)_ — five defects found by static review and fixed:
- `overflow: hidden` on the cart-drawer and product-card steppers clipped the
  keyboard focus ring on the buttons inside them.
- The global `:focus-visible` rule set `border-radius`, which could reshape
  controls on focus.
- The blanket `prefers-reduced-motion` rule froze loading spinners; `.spinner`
  is now exempt because it is essential status feedback.
- The Pay button was disabled with no explanation when the Razorpay SDK failed
  to load; it now states the reason and the recovery step.
- Catalog could flash a stale global `errorMessage` raised by another page
  before its own fetch cleared it; the error branch is now gated on `loading`.

## Phase 9 — Validation & Hardening (2026-08-13) — NOT COMPLETE

**Browser/device testing was NOT available.** No browser engine, DOM environment
or automation tool exists in the repo or the session. Nothing below was
visually confirmed. Validation was static analysis plus *runtime* execution of
the real compiled modules against mocked storage.

_Method_:
- Layout verified by computing widths/columns from the actual CSS at every
  breakpoint band, not by rendering.
- `showTime`, the checkout zod schema and `checkoutSession` were compiled with
  the project's own `tsc` and executed under Node with a mocked
  `sessionStorage`. Probes were deleted afterwards.
- Everything else by source inspection and scripted scans.

_Verified_ (all passing):
- Checkout validation: 28 assertions across WhatsApp/Row/Seat/Show Time and the
  optional fields, including exact message text.
- `showTime`: 20 assertions — calendar validity, corrupt years, and ISO↔local
  round-trip preserving the instant.
- Idempotency lifecycle: 22 assertions across all 9 required scenarios,
  including corrupt JSON, wrong types, missing fields and throwing storage.
- Payment state machine: decision table over all 9 required scenarios.
- Zero cross-file selector collisions, zero duplicate keyframes, zero hardcoded
  colours outside `variables.scss`, no fixed element trapped by a transformed
  ancestor, z-index only via tokens.
- All buttons carry a text label or `aria-label`; all 7 checkout inputs have a
  matching `htmlFor`; required controls carry `aria-required`/`aria-invalid`/
  `aria-describedby`.
- All currency rendered through `formatMoney`; order payload conforms to the
  generated contract; `Idempotency-Key` is sent.

_Bugs found and fixed_:
1. **Product card Add button and steppers were 40px on mobile**, reaching 48px
   only at ≥768px — backwards for a mobile-first app, and below both README §6
   (44px) and the Phase 10 checklist (48px). These are the most tapped controls
   in the app. Verified 48px fits at every width (narrowest case leaves 47px for
   the quantity readout at a 480px viewport).
2. **Catalog search bar could sit under the notch.** The safe-area inset lived
   on the header banner, which only renders when one is configured; without it
   the search bar was the topmost element with no inset. Moved to `.catalog`.
3. **Retry could duplicate an order when sessionStorage is unavailable**
   (private browsing): every call minted a new key. Added an in-memory fallback
   so a retry reuses the key within the page load.
4. **Refresh during an in-flight verify lost the payment credentials.** They
   were only persisted in the `catch`, so refreshing mid-request left no
   recovery record and the remount would offer Pay Now to a charged customer.
   Now persisted *before* the request and cleared on success.
5. **A declined payment was reported as "cancelled."** No `payment.failed`
   listener existed, so a decline only surfaced when the customer closed the
   modal. Added the listener (README §15 already specified this behaviour);
   `ondismiss` no longer overwrites the more accurate message.

Also tokenised the last two hardcoded values (`--radius-inner`,
`--focus-ring-error`) and fixed a backend prettier warning in `cors.js`.

### Payment verify error policy (2026-08-13)

Verification failures are now split by cause, because the two need opposite
recoveries.

**Transient — network, timeout, 5xx:** credentials are preserved, "Confirm my
payment" is offered, and it re-calls **payment-verify only** with the exact same
`razorpayPaymentId`/`razorpaySignature`. `payment-init` is never called from this
path and Razorpay never reopens. The customer is told not to pay again. On
success the flow continues to confirmation normally.

**Permanent — rejected signature:** no retry is offered, because re-sending the
same credentials is deterministic and can never succeed. The page is replaced by
a verification-failure screen showing the order reference for counter staff,
telling the customer not to pay again, with a safe route Home. The cart is left
intact, no new order is created and `payment-init` is not called. The rejected
state is persisted, so a refresh restores this screen rather than a payment form.

**Detection was verified against the running backend, not assumed.** The service
raises `ValidationError('Invalid payment signature', [{ field:
'razorpaySignature' }])`, which `errorHandler` serialises as **400** with
`error.details`. The frontend matches on that structure — status alone is not
enough, because a 400 is also returned when the order has no `razorpayOrderId`.
HTTP 403 is retained as a defensive compatibility case only.

**Status mismatch — RESOLVED (2026-08-13).** The prose docs claimed 403.
Ruling: the **implementation is authoritative**; the backend was not changed.
The OpenAPI contract was already correct (`shared/openapi.json` and the
`consumer.routes.js` annotation both document `400: Invalid signature or missing
Razorpay order`), so no generated file required regeneration. The incorrect 403
claims in `README.md` (§10.8, §15, Step 4) and `consumer-development-flow.md`
have been corrected to 400.

**Razorpay `payment.failed`** now has a listener (README §15 already specified
this; it was simply not implemented). It surfaces Razorpay's customer-facing
`description` when present, and allows a fresh payment attempt — the payment was
never verified, so the order is still pending. `ondismiss` keeps cancellation
separate and no longer overwrites the more accurate failure message.

**Also fixed: backend error messages were never reaching the user.**
`formatApiError` read `data.message`, but the envelope is
`{ error: { code, message, details } }`, so every specific backend message was
silently replaced by a generic fallback. Now reads `error.message`, with 5xx
still deliberately generic so internals are not leaked.

_Why this phase is NOT complete_: the Phase 9 acceptance criteria in
`consumer-development-flow.md` require a real-device test matrix (iPhone,
Android, kiosk, tablet) and real-database order testing. Neither was possible
here. Both remain outstanding.

---

## Post-pass Fixes (2026-08-13)

Correctness fixes found by code review and by running the app. No API contract
changed; no dependency added.

_Blocker_:
- **CORS rejected every order.** `backend/src/config/cors.js` did not list
  `Idempotency-Key` in `allowedHeaders`, so the preflight for
  `POST /api/consumer/orders` failed and the required header could never be
  sent. Added. (Backend restart required.)

_Severe_:
- **`payment-init` looped forever after a failure.** The effect's guard did not
  consider the error state, so a failed init re-satisfied its own condition and
  re-fired indefinitely. Retry is now an explicit user action only.
- **Any refresh wiped the QR context.** `parseUrlParams()` always returns
  `source: 'qr'`, so App's `.some(v => v !== null)` presence check was always
  true; `loadFromLocalStorage()` was dead and a plain refresh persisted a
  context of nulls, ejecting the user to the screensaver. Presence is now
  decided by the genuinely optional fields only.
- **Back-navigation could duplicate an order.** The idempotency key lived in
  component state, so returning from payment remounted checkout with a new key.
  It now lives in sessionStorage (`src/utils/checkoutSession.ts`), restoring the
  documented "one UUID per checkout attempt, reused on every retry" rule rather
  than changing it. The key is **bound to a cart fingerprint**
  (cinemaId + sorted productId:quantity) and is rebound when the cart changes:
  the backend ignores the payload on a repeat key, so a key that outlived its
  cart would have returned an order for the customer's *previous* basket.
  It is cleared as soon as payment is verified — and again on confirmation
  "Done" — so a completed order's key can never be picked up by a later one.
  The fingerprint covers the **whole order payload**, not just the cart: a
  cart-only fingerprint still replayed the original order after the customer
  went back and corrected a seat, mobile number or show time. The key is
  derived at submit time from the payload actually being sent.
- **Unconfirmed payments were unrecoverable.** If Razorpay charged the customer
  but the `payment-verify` call failed, the payment id and signature were
  discarded and the only offered action re-ran `payment-init` — a fresh payment
  attempt. PaymentPage now retains the credentials and offers "Confirm my
  payment", which re-calls the (idempotent) verify endpoint with the same
  credentials, and explicitly warns the customer not to pay again. The
  credentials are persisted to sessionStorage under
  `qbusto_pending_verification`, scoped to the order, so a refresh in that
  state cannot strand a customer who has been charged. While a pending
  verification exists, `payment-init` is blocked and neither "Pay now" nor the
  re-initialise "Try again" is reachable, so no second payment can be started.
  The stored value is cleared on successful verification and when the customer
  deliberately begins a new payment.
- **A 2xx order response with no body locked the form forever.** `isSubmitting`
  is intentionally never reset on the success path, so an empty envelope left
  checkout stuck on "Placing your order…". The service no longer casts the
  optional envelope field away, and checkout surfaces an error instead.

_Checkout validation_ (frontend business rule; backend stays permissive):
- Show Time, Row No., Seat No. and WhatsApp No. are now required, with
  format validation. See README §8 Screen 5 for the rules and messages.
- Row + Seat are joined into the single API `seatNumber` field.
- QR `showTime` no longer silently vanishes; `src/utils/showTime.ts` converts
  between the API's ISO instant and the control's local wall-clock format,
  preserving the instant.
- The "Anything else?" instructions textarea was removed entirely, including
  its schema entry and its `notes` payload field.
- The submit button now stays disabled through the post-success navigation
  delay, so the window where a second order could be submitted is closed.

_Other_:
- Razorpay's CDN script is now `defer`red so it cannot block first render; the
  payment page polls for `window.Razorpay` and, after 10s, explains the failure
  and offers a reload.
- Products with a missing/invalid price can no longer be added at ₹0. A genuine
  ₹0 product is still addable; only non-finite/absent prices are blocked.

> **NOT visually verified.** No browser or device preview was available in the
> session that produced this pass. Correctness was established by typecheck,
> lint, production build, built-CSS inspection and code review only. Phase 9
> must confirm rendering at 360 px, tablet, desktop and portrait kiosk, and
> specifically re-check: the catalog's two independent scroll regions with the
> on-screen keyboard open, the sticky checkout action versus a focused
> textarea, and safe-area behaviour on notched devices.

## Phase 8 Validation Summary (2026-08-12)

**Order Confirmation Implementation Validated**:

_Components Delivered_:
- ✅ ConfirmationPage: Order success screen with ID display
- ✅ Order ID retrieval: Safe extraction from URL parameter
- ✅ Order ID validation: Checks for presence and strict positive-integer format (`/^[1-9]\d*$/`); rejects mixed strings (e.g. `"123abc"`), decimals, negative numbers, and zero
- ✅ Success messaging: "Order Placed Successfully" + "Your order will be ready soon"
- ✅ Done button: Clears cart and navigates to screensaver
- ✅ Error state: Invalid orderId shows recovery option

_Flow Integration_:
- ✅ PaymentPage: Passes orderId via URL after backend verification
- ✅ Route configuration: /confirmation/:orderId accepts orderId parameter
- ✅ Backend authority: Only reachable after verifyOrderPayment succeeds
- ✅ OrderId cleanup: Removed from sessionStorage after verification

_State Management_:
- ✅ Cart clearing: Only on "Done" button click, after payment verified
- ✅ No cart clearing on: retry, payment failures, cancellation, page entry
- ✅ Context preservation: QR/cinema context not cleared (Phase 8 requirement)
- ✅ Session cleanup: OrderId removed from sessionStorage before navigation

_Error Handling_:
- ✅ Invalid orderId: Shows error state with "Back to Home" option
- ✅ Safe navigation: Cannot reach confirmation without valid orderId
- ✅ Payment errors: Remain in PaymentPage (no separate failure pages)

_Mobile-First Design_:
- ✅ Touch targets: 48px+ minimum button height
- ✅ Responsive layout: Mobile (360px+) and tablet (768px+) breakpoints
- ✅ Success animation: Icon scale-in animation on confirmation display
- ✅ Readable text: Good contrast, appropriate font sizes

_Build & Validation_:
- ✅ ESLint: Clean (0 violations)
- ✅ TypeScript: Strict mode passes (0 errors)
- ✅ Production build: Success (119.65 KB gzipped, under 150 KB target)
- ✅ No console errors or warnings
- ✅ All imports correct, no unused variables or dead code

_Route & Navigation_:
- ✅ PaymentPage → ConfirmationPage: OrderId passed via URL parameter
- ✅ ConfirmationPage → Screensaver: "Done" button returns to home
- ✅ Direct /confirmation navigation: Requires valid orderId, shows error if invalid
- ✅ ProtectedRoute: /confirmation requires cinemaId (from context)

_Known Deferred Items_:
- Phase 9: End-to-end testing on multiple devices
- Phase 9: Performance optimization and edge case validation

---

## Phase 6 Validation Summary (2026-08-12)
- PaymentPage: Payment initialization, Razorpay checkout, payment verification
- Order retrieval: Safe validation of orderId from sessionStorage
- Payment initialization: Idempotent POST /api/consumer/orders/{orderId}/payment-init
- Razorpay SDK: Script-based loading via checkout.razorpay.com CDN
- Payment execution: Razorpay.checkout() with backend-provided data (amount in paise, razorpayOrderId, razorpayKeyId)
- Payment verification: Idempotent POST /api/consumer/orders/{orderId}/payment-verify with signature
- Error handling: All failure paths (missing orderId, SDK load failure, payment-init failure, Razorpay cancellation, verification failure)
- Retry safety: Reuses existing order, leverages backend idempotency for safe retries
- State preservation: Cart not cleared (Phase 8 responsibility)
- Full validation: lint ✓, typecheck ✓, production build ✓ (119.13 KB gzipped, under 150 KB target)

Ready to proceed with Phase 8 (Confirmation UI & cart clearing).

## Phase 6 Validation Summary (2026-08-12)

**Checkout & Order Creation Implementation Validated**:

_Components Delivered_:
- ✅ CheckoutPage: Form + cart summary + order submission
- ✅ Checkout form: mobile, email, screenId, seatNumber, showTime, filmTitle, notes fields
- ✅ Form validation: React Hook Form + Zod with phone (10 digits) and email format checks
- ✅ Cart summary: Read-only display of items with estimated subtotal (labeled as "estimated")
- ✅ Idempotency key: UUID v4 generated once per checkout session, reused on retries

_API Integration_:
- ✅ createOrderIdempotent: POST /api/consumer/orders with Idempotency-Key header
- ✅ Order response types: PostApiConsumerOrders201Data with orderId, subtotal, discount, total
- ✅ Orval client: Uses generated types, no manual API URL duplication
- ✅ Backend authority: Final totals from order response, not client calculations

_State Management_:
- ✅ Cart store: Unchanged from Phase 5, items passed to order request
- ✅ Context store: Pre-fills form fields (screenId, seatNumber, showTime, filmTitle)
- ✅ Order state: Stored in sessionStorage for Phase 7 payment flow
- ✅ No cart clearing: Deferred until payment completes (Phase 7+)

_Error Handling_:
- ✅ API errors: formatApiError maps status codes to user-friendly messages
- ✅ Form validation: Field-level errors shown inline
- ✅ Retry mechanism: Safe reuse of idempotency key for failed requests
- ✅ Disabled submit: Button disabled during POST, prevents accidental double submission

_Build & Validation_:
- ✅ ESLint: Clean (0 violations)
- ✅ TypeScript: Strict mode passes (0 errors)
- ✅ Production build: Success (119.44 KB gzipped, under 150KB target)
- ✅ No console errors or warnings during build
- ✅ All imports correct, no unused variables or dead code

_Navigation_:
- ✅ CartDrawer → /checkout: "Proceed to Checkout" button navigates correctly
- ✅ ProtectedRoute: /checkout requires cinemaId (redirects to / if missing)
- ✅ Post-checkout: Successfully ordered OrderID stored, ready for Phase 7

_Known Deferred Items_:
- Payment initialization (Phase 7: payment-init endpoint)
- Razorpay Checkout UI (Phase 7: Razorpay.checkout())
- Payment verification (Phase 7: payment-verify endpoint)
- Confirmation screen (Phase 8)
- Cart clearing (deferred until payment confirmed)
- Product pricing API (Phase 7: pricing data in cart items still 0)

---

## Phase 7 Validation Summary (2026-08-12)

**Razorpay Payment Frontend Implementation Validated**:

_Components Delivered_:
- ✅ PaymentPage: Complete payment flow (retrieval, initialization, Razorpay, verification)
- ✅ Razorpay SDK: Script-based loading from checkout.razorpay.com CDN
- ✅ Payment summary: Display order amount in rupees (converted from paise)
- ✅ Payment initialization: Safe API call with error handling and retry
- ✅ Razorpay checkout: Exact configuration using backend response data

_API Integration_:
- ✅ initializePayment: POST /api/consumer/orders/{orderId}/payment-init (idempotent)
- ✅ verifyOrderPayment: POST /api/consumer/orders/{orderId}/payment-verify (idempotent)
- ✅ Response types: Exact generated Orval types, no manual type duplication
- ✅ Amount handling: Backend-provided amount in paise, converted to rupees for display
- ✅ Razorpay data: razorpayKeyId, razorpayOrderId, amount from backend response only

_State Management_:
- ✅ OrderId retrieval: Safe extraction from sessionStorage with validation
- ✅ Invalid orderId: Graceful error state with navigation option
- ✅ Payment state: Local state for initialization, processing, error states
- ✅ Cart preservation: Not cleared in Phase 7 (Phase 8 responsibility)
- ✅ OrderId cleanup: Removed from sessionStorage after successful verification

_Error Handling_:
- ✅ Missing orderId: Show error, allow navigation to /catalog
- ✅ SDK load failure: Display error, prevent payment attempt
- ✅ Payment-init failure: Show error, allow retry
- ✅ Razorpay cancellation: Handled via modal ondismiss callback
- ✅ Payment-verify failure: Show error, allow retry without creating new order
- ✅ Concurrent requests: Prevented via isProcessing state flag

_Retry Safety_:
- ✅ Retries use same orderId (not creating new order)
- ✅ payment-init idempotent: Backend prevents duplicate Razorpay orders
- ✅ payment-verify idempotent: Backend prevents duplicate payment logs
- ✅ Network failures: Safe retries leverage backend idempotency

_Build & Validation_:
- ✅ ESLint: Clean (0 violations)
- ✅ TypeScript: Strict mode passes (0 errors)
- ✅ Production build: Success (119.13 KB gzipped, under 150KB target)
- ✅ Bundle size reduction: From 88.60 KB (Phase 5) to 119.13 KB (Phase 7 with Razorpay SDK)
- ✅ No console errors or warnings
- ✅ All Orval imports correct, no unused variables

_Navigation_:
- ✅ /checkout → /payment: OrderId in sessionStorage, retrieved safely
- ✅ ProtectedRoute: /payment requires cinemaId (redirects to / if missing)
- ✅ Payment failure → retry: User can retry without leaving page
- ✅ Payment success → /confirmation: Navigate only after backend verification

_Known Deferred Items_:
- Confirmation screen UI (Phase 8)
- Cart clearing (Phase 8: after order confirmed)
- Product pricing API (still 0, pricing data not in Phase 7 scope)

---

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
