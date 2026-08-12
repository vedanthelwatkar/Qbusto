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

1. **POST /api/consumer/orders** → Backend creates order + Razorpay order, returns:
   - orderId
   - razorpayOrderId
   - razorpayKeyId (public)
   - amount (in paise, calculated server-side)
   - currency

2. **Frontend opens Razorpay.checkout()** with the above values

3. **POST /api/consumer/orders/{orderId}/payment-verify** → Backend verifies signature, updates order state

**No other payment endpoints.** No separate `/payment-init`. No `/payment` wrapper.

**Security:** Backend signature verification is mandatory. Frontend callback alone NEVER changes order state.

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
   - Create order + Razorpay order in single transaction
   - Validate cinema, products, availability, pricing
   - Calculate amounts server-side (paise arithmetic)
   - Call Razorpay API to create order
   - Return: orderId, razorpayOrderId, razorpayKeyId, amount, currency, items
   - Auth: None
   - See `consumer/README.md` section 10.7 for full spec

8. **POST /api/consumer/orders/{orderId}/payment-verify** (CRITICAL)
   - Verify Razorpay payment signature
   - Update order paymentStatus = "paid" if signature valid
   - Return: Updated order with paymentStatus: paid
   - Auth: None
   - See `consumer/README.md` section 10.8 for full spec

**Implementation Notes:**
- Create new file: `backend/src/routes/consumer.routes.js`
- Create new controller: `backend/src/controllers/consumer.controller.js` (or split per resource)
- Create new validators if needed: `backend/src/validators/consumer.validators.js`
- Reuse existing services (Cinema, Product, ProductPricing, Order) where possible
- Razorpay integration: Fetch PaymentGatewayConfig per cinema, call Razorpay API
- All money calculations in paise (integers), validate with CHECK constraints
- No JWT authentication on these endpoints

**Testing Strategy (Phase 2):**
- Validate cinema selection
- Validate product availability (date, time, cinema_product link, pricing)
- Verify Razorpay order creation with correct amount
- Verify payment signature verification (valid + invalid signatures)
- Test edge cases: product deactivated mid-order, pricing updated, screen offline

**Acceptance Criteria:**
- All endpoints documented in Swagger/OpenAPI
- All endpoints tested against real SQL Server
- Razorpay integration verified in sandbox
- No SQL injection, XSS, or tenant isolation issues

---

### Phase 2 — Payment Validation & Testing

**Status:** NOT STARTED

**Goal:** Verify Razorpay flow and payment state transitions are correct and secure.

**Test Checklist:**
- [ ] Razorpay order created with correct amount (in paise)
- [ ] Razorpay order ID stored on order row
- [ ] Valid Razorpay signature verifies successfully
- [ ] Invalid/tampered signature rejected (403)
- [ ] Order state transitions: pending → paid (only after verification)
- [ ] Duplicate payment attempts rejected or handled gracefully
- [ ] Payment after order timeout handled
- [ ] Razorpay API failure returns 500, customer can retry
- [ ] Order remains in "pending" if verification fails
- [ ] No money leaves customer account unless backend verification succeeds
- [ ] PaymentGatewayConfig fetched correctly (per-cinema or global)
- [ ] Razorpay secret never logged or exposed

**Real Database Testing Required:**
- Use temporary test orders with unique IDs
- Verify database state changes (order_status_logs, payment_status_logs rows created)
- Clean up all test data
- Confirm database is clean before shipping

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
