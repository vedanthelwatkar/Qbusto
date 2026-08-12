# Consumer App Development Flow

**This is the SINGLE SOURCE OF TRUTH for Consumer Ordering App implementation.**

Before starting any Consumer app work, read:
1. `consumer/README.md` (requirements, API contracts, architecture)
2. This file (implementation phases, progress tracking, decisions)

Do not skip phases. Do not invent alternate architecture. Continue from the current phase listed below.

---

## Progress Ledger

- [x] Phase 0A — Initial Consumer README created (2026-08-11)
- [x] Phase 0B — Contract contradictions resolved (2026-08-12)
- [x] Phase 0C — Exact backend source values verified (2026-08-12, sources: qr, seat_qr, kiosk, counter)
- [x] Phase 0D — QR/context contract finalized (2026-08-12)
- [ ] Phase 0E — Razorpay flow finalized (IN PROGRESS - this session)
- [ ] Phase 1 — Consumer backend APIs
- [ ] Phase 2 — Payment validation & testing
- [ ] Phase 3 — OpenAPI generation
- [ ] Phase 4 — Frontend foundation
- [ ] Phase 5 — Screensaver & catalog
- [ ] Phase 6 — Cart & checkout
- [ ] Phase 7 — Razorpay frontend integration
- [ ] Phase 8 — Confirmation & failure UX
- [ ] Phase 9 — Comprehensive validation
- [ ] Phase 10 — Final code review & polish

---

## Final Decisions (Non-Negotiable)

These decisions are documented and locked. Future work must comply:

### Authentication & Scope
- ✅ **No consumer authentication.** Customers are anonymous.
- ✅ **Public consumer endpoints are SEPARATE from staff/admin endpoints** (e.g., `/api/consumer/orders` ≠ `/api/orders`).
- ✅ **Staff endpoints remain authenticated.** No security compromise.

### Order Source Values (Backend-Defined)
Exact values from `backend/src/constants.js`:

```javascript
const ORDER_SOURCES = {
  QR: 'qr',           // General QR (cinema entrance)
  SEAT_QR: 'seat_qr', // Seat-specific QR
  KIOSK: 'kiosk',     // Kiosk/counter ordering
  COUNTER: 'counter', // Manual counter entry (staff only)
};
```

**These are the ONLY valid values.** Do not invent alternatives.

### Razorpay Payment Flow (THE ONLY FLOW)

1. **POST /api/consumer/orders** → Backend creates local order (idempotent by Idempotency-Key header), returns:
   - orderId
   - items
   - subtotal, discount, total (in rupees)
   - NO Razorpay data yet

2. **POST /api/consumer/orders/{orderId}/payment-init** → Backend creates Razorpay order (idempotent), returns:
   - razorpayOrderId
   - razorpayKeyId (public)
   - amount (in paise, calculated server-side)
   - currency

3. **Frontend opens Razorpay.checkout()** with razorpayOrderId + razorpayKeyId + amount

4. **POST /api/consumer/orders/{orderId}/payment-verify** → Backend verifies signature (idempotent), updates order state

**No other payment endpoints.** No single-call order+payment endpoint. No `/payment` wrapper.

**Security:** Backend signature verification is mandatory. Frontend callback alone NEVER changes order state.

**Idempotency:**
- POST /api/consumer/orders: Idempotent via Idempotency-Key header (UUID)
- POST /api/consumer/orders/{orderId}/payment-init: Idempotent via pessimistic lock + razorpayOrderId check
- POST /api/consumer/orders/{orderId}/payment-verify: Idempotent via paymentStatus check

### Idempotency & Concurrency Strategy (Non-Negotiable)

**Local Order Creation Idempotency (CRITICAL):**
- ✅ **Idempotency-Key header (UUID v4) required** on POST /api/consumer/orders
- ✅ **Frontend generates UUID when entering checkout form** (once per checkout session)
- ✅ **Same key returns same orderId** (no duplicate orders on network retry)
- ✅ **Must persist key ↔ orderId association** in database or cache
- ✅ **Prevents duplicate orders** if network fails after backend commits but before response reaches frontend

**Payment Initialization Concurrency (CRITICAL):**
- ✅ **Pessimistic row locking** on order load (SELECT ... FOR UPDATE or equivalent)
- ✅ **Check razorpayOrderId before API call** (if already set, return existing)
- ✅ **Compare-and-set fallback** (UPDATE only if NULL, check rows affected)
- ✅ **Idempotent retry**: Same orderId always returns same razorpayOrderId (or winner's if lost race)
- ✅ **Honest about Razorpay orphans**: True simultaneous requests (exact millisecond) may create 2 Razorpay orders, but only 1 local order and only 1 can be verified/paid → acceptable

**Payment Verification Idempotency (CRITICAL):**
- ✅ **Check paymentStatus before verification** (if already "paid", return success)
- ✅ **No duplicate payment_status_logs** (only one log entry per order)
- ✅ **Idempotent retry**: Same signature always returns success without duplicate updates

### Money Handling
- ✅ **Backend calculates all prices server-side** (paise arithmetic, not floating-point).
- ✅ **Frontend cart total is display-only.** Backend recalculates at order creation.
- ✅ **Frontend must NEVER trust cart totals.** `amount` in POST response is authoritative.

### QR / Context Contract

Three entry scenarios with exact parameter requirements documented in `consumer/README.md` section 9:

1. **Seat QR** → cinemaId, screenId, seatNumber, showTime, filmTitle, source=seat_qr (prefilled)
2. **General QR** → cinemaId, source=qr (prefilled, other fields optional)
3. **Kiosk** → cinemaId, source=kiosk (baked into kiosk config, not QR params)

**Invalid/missing context:** User selects/enters information, source defaults to `qr`.

### Architecture (Lightweight)

- ✅ **React + Vite + TypeScript**
- ✅ **Zustand** (state management, already installed)
- ✅ **Axios** (HTTP client, already installed)
- ✅ **Orval** (API client generation, already installed)
- ✅ **React Hook Form + Zod** (forms + validation, lightweight)
- ✅ **Lucide React** (icons, optional)
- ✅ **Custom Sass/CSS** (styling, no design system needed)

**Do NOT add:**
- ❌ Ant Design (dashboard-only library)
- ❌ Material-UI, Bootstrap, Tailwind (unnecessary)
- ❌ Redux, MobX, Recoil (Zustand is sufficient)
- ❌ React Query, SWR, Apollo (overkill for this app)
- ❌ Storybook, Enzyme, or heavy testing frameworks (not Phase 9+)

### Device & Responsive
- ✅ **Mobile-first, portrait priority** (360px+) — PRIMARY design target
- ✅ **Vertical kiosk screens** (tall displays) — SECONDARY target
- ✅ **Desktop / larger screens** — TERTIARY (clean and usable, not over-optimized)
- ✅ **No separate desktop design system**: Use the same responsive UI naturally across all sizes with sensible max-widths
- ✅ **Desktop must not look stretched, broken, or awkwardly laid-out**: visually clean, balanced, professional
- ✅ **Touch-friendly** (48px touch targets, no hover-only affordances)
- ✅ **Landscape fallback** (works, but secondary)

### UI Philosophy
- ✅ **Modern, clean, food-focused**
- ✅ **Fast, lightweight, minimal**
- ✅ **No dashboard patterns, no complex sidebars**
- ✅ **Simple screensaver → product catalog → cart → payment → confirmation**

### Permissions & Backend Authority
- ✅ **Frontend permission checks are UX-only.** Backend is authoritative.
- ✅ **Backend validates availability, pricing, discounts, cinema/product/user data.**
- ✅ **Frontend shows valid transitions / options only; backend enforces rules.**

---

## Phase Breakdown

### Phase 0E — Razorpay Flow Finalization

**Status:** IN PROGRESS (this session)

**Deliverables:**
- [x] Consumer README updated with single, definitive Razorpay flow
- [x] API contract (10.7, 10.8, 10.9) finalized
- [x] Order creation response documented (including razorpayKeyId)
- [x] Payment verification response documented
- [x] Zustand examples fixed (immutable state)
- [x] QR/context contract finalized (section 9)
- [x] Frontend architecture simplified
- [x] This development flow file created

**Next Phase:** Phase 1 (Consumer Backend)

---

### Phase 1 — Consumer Backend APIs

**Status:** NOT STARTED

**Goal:** Build/finalize unauthenticated consumer endpoints that the frontend depends on.

**Required Endpoints:**

1. **GET /api/consumer/cinemas/{id}** (HIGH)
   - Validate cinema exists and is active
   - Return: id, name, code, city
   - Auth: None
   - Source: New endpoint (wraps existing cinema model)

2. **GET /api/consumer/cinemas/{cinemaId}/categories** (HIGH)
   - List active categories for this cinema
   - Filter by cinema via cinema_product links
   - Return: id, name, imageUrl, description
   - Auth: None
   - Pagination: Yes (limit, page)

3. **GET /api/consumer/cinemas/{cinemaId}/products** (HIGH)
   - List active products at this cinema
   - Filter by: categoryId, search, availability
   - Validate product is active, cinema_product link exists, product_pricing for today exists
   - Return: id, name, description, imageUrl, basePrice
   - Auth: None
   - Pagination: Yes

4. **GET /api/consumer/cinemas/{cinemaId}/products/{id}** (HIGH)
   - Single product detail with pricing
   - Same availability checks as list endpoint
   - Return: id, name, description, imageUrl, basePrice
   - Auth: None

5. **GET /api/consumer/cinemas/{cinemaId}/banners** (HIGH)
   - List active banners by type (H, I)
   - Filter by: cinema, type, active status, date validity
   - Return: id, imageUrl, type, sequence
   - Auth: None

6. **GET /api/consumer/cinemas/{cinemaId}/screens/{id}** (MEDIUM)
   - Validate screen exists and belongs to cinema
   - Return: id, name, cinemaId
   - Auth: None

7. **POST /api/consumer/orders** (CRITICAL)
   - Create local order only (DB transaction)
   - IDEMPOTENT by Idempotency-Key header (UUID)
   - Validate cinema, products, availability, pricing
   - Calculate amounts server-side (paise arithmetic)
   - Create order + items + logs (all in transaction)
   - Return: orderId, items, subtotal, discount, total
   - Does NOT create Razorpay order (separate step)
   - Auth: None
   - Requires: Idempotency-Key header (UUID v4)
   - See `consumer/README.md` section 10.7 for full spec

8. **POST /api/consumer/orders/{orderId}/payment-init** (CRITICAL - NEW)
   - Initialize payment for existing local order
   - IDEMPOTENT: safe to retry (returns same razorpayOrderId)
   - Concurrency-minimized: uses pessimistic lock + compare-and-set
   - Load order, verify paymentStatus=pending
   - If razorpayOrderId already set: return it (idempotent)
   - Else: create Razorpay order via API, try to store razorpayOrderId
   - If store succeeds: return razorpayOrderId
   - If store fails (lost race): reload and return winner's razorpayOrderId
   - Return: razorpayOrderId, razorpayKeyId, amount (paise)
   - Auth: None
   - Rare edge case: true simultaneous requests may create 2 Razorpay orders, but only 1 is used (acceptable)
   - See `consumer/README.md` section 10.7bis for full spec

9. **POST /api/consumer/orders/{orderId}/payment-verify** (CRITICAL)
   - Verify Razorpay payment signature
   - IDEMPOTENT: safe to retry
   - Update order paymentStatus = "paid" if signature valid
   - Return: Updated order with paymentStatus: paid
   - Auth: None
   - See `consumer/README.md` section 10.8 for full spec

**Implementation Notes:**

**Three-Phase Order + Payment Flow:**
- Phase 1 (POST /api/consumer/orders): Create local order in DB transaction. Return orderId + totals. NO Razorpay call. IDEMPOTENT via Idempotency-Key header.
- Phase 2 (POST /api/consumer/orders/{orderId}/payment-init): Create Razorpay order. Store razorpayOrderId. IDEMPOTENT via razorpayOrderId check + pessimistic lock.
- Phase 3 (POST /api/consumer/orders/{orderId}/payment-verify): Verify signature. Mark order paid. IDEMPOTENT via paymentStatus check.

**Idempotency Strategy (LOCAL ORDERS - CRITICAL):**
- POST /api/consumer/orders: Idempotent via Idempotency-Key header (UUID v4)
  - Frontend generates UUID when entering checkout form
  - Same UUID on retry returns existing orderId (no duplicate orders)
  - Must persist idempotency key ↔ orderId association in database or cache
  - Prevents duplicate order creation if network fails after backend commits but before response reaches frontend

**Idempotency Strategy (PAYMENT INITIALIZATION):**
- payment-init: Idempotent via razorpayOrderId NULL check + pessimistic database lock
  - If razorpayOrderId already set, return it (no duplicate Razorpay order)
  - If NULL: Lock order row, check again, then create Razorpay order if still NULL
  - Compare-and-set fallback: If another concurrent request wins, return their razorpayOrderId
  - Rare edge case (true simultaneous requests at exact millisecond): May create 2 Razorpay orders, but only 1 is used → acceptable

**Idempotency Strategy (PAYMENT VERIFICATION):**
- payment-verify: Idempotent via paymentStatus check
  - If already "paid", return success (no duplicate payment_status_log)
  - Prevents double-crediting if frontend retries after network failure

**Prevents duplicate charges** if frontend retries after network failures

**File Structure:**
- Create new file: `backend/src/routes/consumer.routes.js` (no authenticate middleware)
- Create new controller: `backend/src/controllers/consumer.controller.js`
- Create new validators: `backend/src/validators/consumer.validators.js`
- Reuse existing services (Cinema, Product, ProductPricing, Order) where possible
- Extract money helpers as shared utilities if needed

**Razorpay Integration:**
- Fetch PaymentGatewayConfig by cinema (cinema-specific credentials)
- Use RAZORPAY_KEY_SECRET environment variable as fallback (Phase 1)
- Document that production will need decryption utility for gateway_secret_encrypted
- Call Razorpay API only in payment-init endpoint (not in order creation)
- Store razorpayOrderId on order row immediately after Razorpay success
- Use HMAC-SHA256 for signature verification (server-side only, never trust frontend)

**Money & Calculations:**
- All amounts in paise (integers), never floating-point
- Reuse selectPricing() + unitDiscountPaise() from order.service
- Backend recalculates total from stored order (not from frontend)

**Error Handling:**
- 404: Resource not found (idempotent)
- 409: Order in wrong state or unavailable (conflict)
- 503: Razorpay API unavailable (retryable)
- 403: Signature verification failed (not retryable, user error)

**No JWT authentication on these endpoints.**

**Testing Strategy (Phase 2):**

**Endpoint Tests (POST /api/consumer/orders) - IDEMPOTENCY CRITICAL:**
- Valid order creation returns orderId + items + totals
- Idempotency-Key header is required (400 if missing)
- First request with UUID: Creates order, returns orderId
- Second request with same UUID: Returns same orderId (no new order created) ✅ CRITICAL
- Third request with same UUID: Returns same orderId ✅ CRITICAL
- Request with different UUID: Creates new order, returns different orderId
- Cinema validation (inactive cinema rejected with 409)
- Product validation (inactive/unlinked/unavailable product rejected)
- Pricing validation (no pricing for today rejected)
- Availability validation (outside time window rejected)
- Duplicate products in items rejected (400)
- Quantity limits enforced (max 50 total)
- Order created in DB with correct amounts (in paise)
- Idempotency key persisted and associated with orderId in database

**Payment-Init Tests (POST /api/consumer/orders/{orderId}/payment-init) - CONCURRENCY CRITICAL:**
- First call creates Razorpay order, returns razorpayOrderId
- Second call with same orderId returns same razorpayOrderId (idempotent) ✅ CRITICAL
- Third call returns same razorpayOrderId (idempotent) ✅ CRITICAL
- Order in wrong state (not pending) rejected with 409
- Invalid orderId returns 404
- Razorpay API failure returns 503 (retryable)
- razorpayOrderId stored correctly on order row
- Concurrent requests to same orderId (2+ simultaneous): Both receive razorpayOrderId (may be same or different depending on race, but consistent) ✅ CRITICAL
- Pessimistic lock prevents multiple Razorpay calls in normal cases
- Edge case (true simultaneous at exact millisecond): May create 2 Razorpay orders, but both return same razorpayOrderId to frontend

**Payment-Verify Tests (POST /api/consumer/orders/{orderId}/payment-verify):**
- Valid signature verifies successfully, marks order paid
- Invalid/tampered signature rejected with 403
- Order in wrong state (not pending) rejected with 409
- First verification updates paymentStatus to paid
- Second call with same data returns success (idempotent, no duplicate log)
- razorpayPaymentId stored in payment_status_logs
- Invalid orderId returns 404
- razorpayOrderId NULL returns error

**Concurrency & Retry Tests (CRITICAL):**
- Concurrent order creation (different Idempotency-Keys): Both succeed, different orderIds ✅ CRITICAL
- Concurrent order creation (same Idempotency-Key): Both return same orderId, only 1 order in DB ✅ CRITICAL
- Concurrent payment-init calls (same orderId): Both receive razorpayOrderId, only 1 used ✅ CRITICAL
- Concurrent payment-verify calls (same orderId): Both return success, only one payment_status_log ✅ CRITICAL
- Network failure during order creation + retry with same key: Returns existing orderId ✅ CRITICAL
- Network failure during payment-init + retry: Returns existing razorpayOrderId ✅ CRITICAL
- Network failure during payment-verify + retry: Returns existing paid status ✅ CRITICAL
- Multiple retries with exponential backoff: All succeed idempotently
- Race condition test: Verify Razorpay orphan order is acceptable (won't charge without local order verification)

**Edge Cases:**
- Product deactivated after order created (order still valid, reflects pricing at creation time)
- Pricing changed after order created (order total unchanged)
- Order timeout/expiry scenarios

**Acceptance Criteria:**
- All endpoints documented in Swagger/OpenAPI
- All endpoints tested against real SQL Server
- Razorpay integration verified in sandbox
- No SQL injection, XSS, or tenant isolation issues

---

### Phase 2 — Payment Validation & Testing

**Status:** NOT STARTED

**Goal:** Verify Razorpay flow, idempotency, and payment state transitions are correct and secure.

**Test Checklist:**

**Order Creation (Phase 1):**
- [ ] Order created with correct subtotal, discount, total (in paise)
- [ ] Order status initialized as "initiated"
- [ ] Payment status initialized as "pending"
- [ ] razorpayOrderId is NULL (not created yet)
- [ ] order_status_logs entry created
- [ ] payment_status_logs entry created

**Payment Initialization (Idempotent):**
- [ ] Razorpay order created with correct amount (in paise)
- [ ] Razorpay order ID stored on order row
- [ ] First call creates Razorpay order
- [ ] Second call returns same razorpayOrderId (idempotent)
- [ ] Razorpay API failure returns 503, order remains with razorpayOrderId=NULL
- [ ] Retry after failure succeeds

**Payment Verification (Idempotent):**
- [ ] Valid Razorpay signature verifies successfully
- [ ] Invalid/tampered signature rejected (403)
- [ ] Order state transitions: pending → paid (only after verification)
- [ ] First verification creates payment_status_logs entry
- [ ] Second call returns success without duplicate log (idempotent)
- [ ] Order remains in "pending" if verification fails (400/403 responses)
- [ ] No money leaves customer account unless backend verification succeeds

**Razorpay Secret Handling:**
- [ ] RAZORPAY_KEY_SECRET read from environment (Phase 1 approach)
- [ ] PaymentGatewayConfig fetched by cinema (if used for future decryption)
- [ ] Razorpay secret NEVER logged or exposed in responses
- [ ] HMAC-SHA256 verification uses server-side secret only

**Concurrent & Retry Scenarios:**
- [ ] Concurrent payment-init: First succeeds, second sees razorpayOrderId and returns it
- [ ] Concurrent payment-verify: First marks paid, second sees paid status and returns success
- [ ] Network failure scenarios: Retries are idempotent (no duplicates)

**Real Database Testing Required:**
- Create temporary test orders with unique cinema/product combinations
- Verify database state at each step:
  - After order creation: order + order_items + status_logs
  - After payment-init: razorpayOrderId stored
  - After payment-verify: payment_status_logs with razorpayPaymentId, paymentStatus=paid
- Test with Razorpay sandbox credentials
- Clean up all test data and verify database is clean
- Verify no orphan Razorpay orders left behind

---

### Phase 3 — OpenAPI Generation

**Status:** NOT STARTED

**Goal:** Generate and commit consumer API types for Orval.

**Tasks:**
1. Update `backend/shared/openapi.json` to include `/api/consumer/*` endpoints
2. Run `npm run gen:spec` in backend
3. Verify OpenAPI spec is valid
4. Run `npm run gen:api` in consumer
5. Commit generated consumer API client
6. Never manually edit generated files

**Acceptance Criteria:**
- OpenAPI spec includes all consumer endpoints (GET + POST verified)
- Generated Orval client has correct types for all endpoints
- Response types match documented shapes
- Request types match documented schemas

---

### Phase 4 — Frontend Foundation

**Status:** NOT STARTED

**Goal:** Scaffold consumer app structure, configure Orval, set up state management.

**Tasks:**
1. Create directory structure (see `consumer/README.md` section 17)
2. Configure Orval for consumer API client
3. Create Zustand stores:
   - `cart.store.ts` (items, add/remove/update)
   - `context.store.ts` (cinema, screen, seat, show, film, source)
   - `ui.store.ts` (cartOpen, paymentLoading, error)
4. Create service wrappers:
   - `catalog.service.ts` (fetch categories, products, banners)
   - `orders.service.ts` (create order, verify payment)
   - `validation.service.ts` (form validation)
5. Set up global styles:
   - Color palette (cinema branding)
   - Typography scales
   - Responsive breakpoints
   - Safe area support
6. Create App.tsx with basic routing
7. Create utility helpers:
   - `formatMoney()` for prices
   - `formatPhone()` for mobile
   - URL param parsing for QR context
   - Error mapper for API responses

**Acceptance Criteria:**
- App compiles and runs locally
- Zustand stores are initialized and accessible
- Orval client is imported and type-safe
- No console errors on startup
- Mobile viewport responds correctly (360px+)

---

### Phase 5 — Screensaver & Catalog

**Status:** NOT STARTED

**Goal:** Build product listing UI and screensaver.

**Screens:**

1. **ScreensaverPage.tsx**
   - Full-screen visual (image or SVG)
   - "ORDER NOW" button
   - Tap/click → navigate to /catalog

2. **CatalogPage.tsx**
   - Fetch categories on mount
   - Display category tabs / list
   - Fetch header banner on mount
   - Display products in grid (1-2 columns based on width)
   - Search/filter products
   - Display inner banners between sections
   - Show product cards (image, name, price, add button)
   - Sticky cart button at bottom

3. **ProductCard component**
   - Image (lazy load)
   - Product name
   - Price (from cart estimate OR from backend pricing)
   - Add button
   - Onclick: add to cart (via cart.store)

4. **CartDrawer component**
   - List items with quantity controls
   - Show subtotal (estimated, not final)
   - Show total (estimated, not final)
   - Remove item button
   - Proceed to checkout button

**API Calls:**
- GET /api/consumer/cinemas/{cinemaId}/categories
- GET /api/consumer/cinemas/{cinemaId}/products
- GET /api/consumer/cinemas/{cinemaId}/banners?type=H
- GET /api/consumer/cinemas/{cinemaId}/banners?type=I

**Acceptance Criteria:**
- Categories load and display
- Products load and display correctly
- Images lazy-load
- Add to cart updates cart.store
- Cart drawer shows correct items and quantity
- Mobile responsive (portrait 1-column, wider 2-column)
- Touch targets ≥ 48px
- No errors in console

---

### Phase 6 — Cart & Checkout

**Status:** NOT STARTED

**Goal:** Build checkout form and order summary.

**Screens:**

1. **CheckoutPage.tsx**
   - Display cart summary (read-only, for review)
   - Checkout form with fields:
     - Mobile (required or optional per backend)
     - Email (optional)
     - Seat number (optional, prefilled if from seat_qr)
     - Show time (optional, prefilled if from QR)
     - Film title (optional, prefilled if from QR)
     - Notes (optional)
   - Validation: Use React Hook Form + Zod
   - Submit button: "Review Order"

2. **Order Summary Page** (Optional, may skip)
   - Show all items
   - Show customer info
   - Show total (recalculated by backend, so display "Calculating..." until order created)
   - Confirm button: "Confirm and Pay"

**API Calls:**
- POST /api/consumer/orders (on submit)

**State:**
- Store customer info in local state or a temporary store
- Cart remains in cart.store
- Load context from context.store (cinema, screen, seat, show, film, source)

**Acceptance Criteria:**
- Form validation works
- Invalid phone format shows error
- Invalid email format shows error
- Submit creates order via API
- Loading state shown during POST
- Error messages display if order creation fails
- No cart total displayed as final (only summary)

---

### Phase 7 — Razorpay Frontend Integration

**Status:** NOT STARTED

**Goal:** Integrate Razorpay checkout flow.

**Flow:**

1. **Order created (POST /api/consumer/orders)**
   - Response includes: orderId, razorpayOrderId, razorpayKeyId, amount

2. **PaymentPage.tsx**
   - Display order details (read-only)
   - Display final total from order response
   - "Pay Now" button
   - Onclick: Open Razorpay.checkout()

3. **Razorpay Checkout**
   - Pass: razorpayKeyId, amount (in paise), orderId, customer email/mobile
   - Razorpay iframe opens
   - Customer completes payment

4. **Payment Verification**
   - On Razorpay callback (success or error), call POST /api/consumer/orders/{orderId}/payment-verify
   - Pass: razorpayPaymentId, razorpaySignature
   - If 200 → navigate to /confirmation
   - If 403 or error → show "Payment verification failed" + retry option
   - If network error → show error, allow retry

**JavaScript/TypeScript:**

```typescript
// PaymentPage.tsx
import Razorpay from 'razorpay/dist/razorpay';
import { useOrdersService } from '@/services/orders.service';

async function handlePayNow() {
  const options = {
    key: order.razorpayKeyId,
    amount: order.amount,
    currency: 'INR',
    order_id: order.razorpayOrderId,
    name: cinemaName,
    description: `Order #${order.orderId}`,
    email: order.customerEmail || '',
    contact: order.customerMobile || '',
    
    handler: async (response) => {
      // Call verification endpoint
      const result = await verifyPayment(order.orderId, response);
      if (result.success) {
        navigate('/confirmation');
      } else {
        setError('Payment verification failed');
      }
    },
  };

  const rzp = new Razorpay(options);
  rzp.open();
}
```

**API Calls:**
- POST /api/consumer/orders/{orderId}/payment-verify

**Acceptance Criteria:**
- Razorpay iframe opens
- Razorpay sandbox payment processes
- Backend verifies signature
- Order state updates to paymentStatus: paid
- Navigation to confirmation on success
- Error handling on verification failure
- No console errors

---

### Phase 8 — Confirmation & Failure UX

**Status:** NOT STARTED

**Goal:** Build success and failure screens.

**Screens:**

1. **ConfirmationPage.tsx** (Success)
   - Message: "Order Placed Successfully"
   - Order ID / reference
   - Helpful message: "Your order will be ready soon"
   - Button: "Done" (clears cart, navigates to screensaver)

2. **PaymentErrorPage or modal** (Failure)
   - Message: "Payment Failed"
   - Reason (if available from Razorpay)
   - Retry button (re-opens Razorpay)
   - Cancel button (back to checkout)

3. **GeneralErrorBoundary**
   - Catches unexpected errors
   - Shows helpful message
   - Reload button

**Acceptance Criteria:**
- Success screen shows order ID
- Failure screen shows error message and retry option
- "Done" button clears cart and returns to screensaver
- No sensitive data in error messages
- Errors are logged (optional Sentry)

---

### Phase 9 — Comprehensive Validation

**Status:** NOT STARTED

**Goal:** Test the complete end-to-end flow on real devices and environments.

**Test Matrix:**

| Device | Orientation | Screen Size | Test |
|--------|-------------|-------------|------|
| iPhone 12 | Portrait | 390px | Browse, add cart, checkout |
| iPhone 12 | Landscape | 844px | Same flow, responsive |
| Samsung A10 | Portrait | 360px | Same flow |
| Kiosk | Portrait | 1080x1920 | Same flow, touch |
| Tablet | Portrait | 768px | Same flow |

**Test Checklist:**

- [ ] Screensaver loads and displays
- [ ] Product listing loads and displays correctly
- [ ] Add to cart works
- [ ] Cart updates correctly
- [ ] Checkout form validation works
- [ ] QR params prefill correctly
- [ ] Order creation succeeds
- [ ] Razorpay checkout opens and displays correctly
- [ ] Razorpay sandbox payment processes
- [ ] Backend verifies signature
- [ ] Confirmation screen displays
- [ ] Tap targets are ≥ 48px on mobile
- [ ] Text is readable (good contrast)
- [ ] No horizontal scrolling required on portrait
- [ ] Images load in reasonable time
- [ ] Loading states display
- [ ] Error messages display clearly
- [ ] Performance: First paint < 2s on 4G
- [ ] Bundle size: < 150kb gzipped
- [ ] Razorpay signature verification works (valid + invalid)
- [ ] Duplicate payment attempts handled
- [ ] Payment after timeout handled
- [ ] Network failure during order creation handled
- [ ] Network failure during payment verification handled

**Real Database Testing:**
- Create 5-10 test orders with unique IDs
- Verify order rows, order_items, status_logs, payment_status_logs in database
- Verify Razorpay order creation (check Razorpay sandbox)
- Verify payment signature verification
- Clean up all test data
- Confirm database is clean

---

### Phase 10 — Final Code Review & Polish

**Status:** NOT STARTED

**Goal:** Code review, bugfix, and ship-readiness.

**Review Checklist:**

- [ ] No hardwritten API URLs (all via Orval generated client)
- [ ] No duplicate types (all from Orval)
- [ ] No client-side price calculations (backend is authoritative)
- [ ] No public access to staff APIs
- [ ] Razorpay KEY_SECRET never logged or exposed
- [ ] Payment signature verified server-side (never frontend)
- [ ] QR parameters parsed correctly
- [ ] Order sources are exact backend values (qr, seat_qr, kiosk, counter)
- [ ] Cart store uses immutable state updates
- [ ] No unnecessary dependencies added
- [ ] Mobile-first responsive design
- [ ] Touch targets ≥ 48px
- [ ] No hover-only affordances
- [ ] Keyboard accessible (tab navigation)
- [ ] Error messages are user-friendly (no stack traces)
- [ ] Loading states everywhere async work happens
- [ ] No console errors or warnings
- [ ] Linting passes: `npm run lint`
- [ ] Type checking passes: `npm run typecheck`
- [ ] Build succeeds: `npm run build`
- [ ] Bundle size acceptable (< 150kb gzipped)
- [ ] No dead code
- [ ] No temporary console.log() calls
- [ ] Generated files not manually edited
- [ ] All tests pass (if applicable)
- [ ] README updated (if needed)
- [ ] Comments are minimal (WHY, not WHAT)

**Final Commit:**
- Single commit or small number of focused commits
- Clear commit message describing feature
- No merge commits if avoidable

---

## Important Working Rule

**Before starting Consumer app work:**

1. Read `consumer/README.md` completely
2. Read this file (consumer-development-flow.md) completely
3. Check the Progress Ledger above
4. Continue from the CURRENT phase (not completed phases)
5. Do not skip phases
6. Do not invent alternate architecture or API flows
7. Follow the exact decisions in "Final Decisions" section

**If a decision contradicts the Final Decisions section, escalate before proceeding.**

---

## Quick Reference: Final Decisions (Copy into Prompts)

```
FINAL DECISIONS FOR CONSUMER APP:

✅ No consumer authentication
✅ Public consumer endpoints separate from staff endpoints
✅ Order sources: qr, seat_qr, kiosk, counter (only)
✅ Razorpay flow: POST /api/consumer/orders → Razorpay.checkout() → POST /api/consumer/orders/{id}/payment-verify
✅ Backend calculates all prices (paise arithmetic)
✅ Frontend cart total is display-only (backend recalculates)
✅ Backend signature verification mandatory (frontend callback alone never changes order state)
✅ Mobile-first, portrait priority
✅ React + Vite + TypeScript + Zustand + Axios + Orval
✅ NO Ant Design, Redux, React Query, or other heavy libraries
✅ Lightweight custom CSS/Sass for styling
✅ Simple architecture: pages, services, stores, components
✅ QR context: cinemaId ± screenId/seatNumber/showTime/filmTitle/source
✅ No order history, tracking, authentication, or consumer accounts
✅ Backend is authoritative for availability, pricing, discounts, validation
✅ Touch-friendly (48px targets), no hover-only interactions
```

---

**This document is authoritative. Update it only when decisions change. Commit this file alongside README changes.**

**Last Updated:** 2026-08-12
