# QBusto Consumer Ordering App

A lightweight, touch-first cinema food ordering web application. Customers scan a QR code at their cinema seat/screen and place orders in under 2 minutes.

## 1. Purpose

This application provides a fast, simple, mobile-first ordering interface for cinema customers. It replaces the legacy Vista PopExpress workflow from the customer-facing side.

**Not in scope:** Authentication, login, signup, customer accounts, order history, order tracking, dashboard, admin functions.

---

## 2. Product Scope

- **User**: Unauthenticated cinema customer
- **Entry point**: QR code scan at seat/screen, or direct URL with context parameters
- **Devices**: Mobile phones (primary), tall kiosk displays (secondary)
- **Experience**: Screensaver → product catalog → cart → checkout → Razorpay payment
- **Outcome**: Order placed, payment confirmed, customer receipt reference (if applicable)
- **No tracking**: Customer cannot see order status after payment. That is a staff feature.

---

## 3. What This App Does

1. Display a visually appealing screensaver with "ORDER NOW" CTA
2. Show product catalog organized by categories
3. Display promotional/contextual banners (header and inner banners)
4. Support product search, category browsing, and product filtering
5. Allow customers to add products to a cart with quantity controls
6. Display cart with line items, totals, and discounts
7. Collect customer information (mobile, email, seat, show details)
8. Initialize Razorpay payment
9. Process payment and confirm order
10. Show order success confirmation (no tracking UI after this)

---

## 4. What This App Does NOT Do

- User authentication or login
- Signup or account creation
- Customer accounts or profiles
- Order history or past orders
- Order status tracking
- Notifications or SMS/email to customer (handled by backend/staff)
- Admin or staff functions (separate dashboard app)
- Complex product modifiers/addons UI (backend has addon model; frontend TBD)
- Delivery or fulfillment tracking
- Refunds or cancellations by customer
- Loyalty programs or vouchers (not in current spec)

---

## 5. User Journey

```
Scan QR code / Visit URL
         ↓
Screensaver (full-screen visual, "ORDER NOW" button)
         ↓
Product Listing (categories, banner, search)
         ↓
Browse / Search Products
         ↓
Add to Cart (individual product click or add button)
         ↓
View Cart (bottom sheet / drawer / modal)
         ↓
Proceed to Checkout
         ↓
Enter Customer Information
  (mobile, email, seat, show time, film title, notes)
         ↓
Review Order Summary
         ↓
Click "Pay Now"
         ↓
Razorpay Checkout
         ↓
Payment Success/Failure
         ↓
Order Confirmation Screen
         ↓
Close App / Return Home
```

---

## 6. Device / Responsive Strategy

### Target Viewports

**Mobile (PRIORITY):**
- 360px width (older phones)
- 375px width (iPhone SE / 8)
- 390px width (iPhone 12+)
- 412px width (Android mid-range)

**Kiosk (SECONDARY):**
- Tall/portrait touchscreen displays (commonly 1080px × 1920px or similar)
- Must support both portrait and landscape gracefully

### Responsive Approach

**Priority order (non-negotiable):**
1. **Mobile portrait** (360px+) — PRIMARY
2. **Vertical kiosk / touch** — SECONDARY
3. **Desktop / larger screens** — TERTIARY (clean and usable, not over-optimized)

**Implementation rules:**
- **Mobile-first** CSS: Start at 360px, expand upward
- **Portrait primary**: Optimize for vertical scrolling, sticky controls at bottom
- **Portrait on kiosk**: Use full height efficiently (tall product grid, scrolling sections)
- **Desktop (480px+)**: Scale naturally with sensible max-widths; avoid stretched layouts or over-wide designs
- **No separate desktop design system**: Adapt the same responsive UI naturally across sizes; don't build a dual experience
- **Touch-friendly**: Buttons ≥ 44px × 44px tap target
- **No hover-dependent interactions**: All hover effects must have touch equivalents
- **Viewport meta tag**: Include `viewport-fit=cover` for notch support
- **Safe areas**: Account for notches and rounded corners on modern phones

### Layout Strategy

```
Top:
  - Brand/header (sticky on scroll or at page top)
  - Promotional banner (if applicable)
  
Body:
  - Category tabs/list
  - Product grid (1 or 2 columns depending on width)
  - Lazy-load images as user scrolls
  
Bottom:
  - Sticky cart CTA button (always visible when items in cart)
  - Shows item count and total
```

---

## 7. UI / Design Direction

### Visual Philosophy

- **Modern, not corporate**: Avoid dashboard / enterprise look
- **Food-focused**: High-quality product images, appetizing presentation
- **Catchy and clean**: Minimal clutter, clear typography
- **Touch-native**: Large targets, obvious affordances, fluid interactions
- **Lightweight**: Fast load, minimal animation weight (no heavy libraries)
- **Local visual identity**: Adapt to cinema branding where relevant

### Component Library

- **NO Ant Design**: Ant Design is for the admin dashboard, not here
- **Custom Sass/CSS**: Build visual design with CSS, not a framework
- **Lightweight UI primitives**: Consider Radix UI or Headless UI for accessible basics (optional)
- **Icons**: Lucide React or similar lightweight icon library
- **Forms**: React Hook Form for validation, Zod for schema validation
- **Colors**: Define a simple palette (cinema branding + accent colors)

### Do NOT Do

- Avoid tables, datagrids, complex layouts
- Avoid multi-step forms if possible (keep checkout simple)
- Avoid hover-only affordances
- Avoid dense information displays

---

## 8. Screens and Application Flow

### Screen 1: Screensaver / Landing

- Full-screen image/video background (food, cinema, "ORDER NOW" messaging)
- Single large, centered CTA button: "ORDER NOW" or similar
- Tap anywhere → advance to product listing
- Optional: Display cinema name, show time if passed via QR params

### Screen 2: Product Catalog

**Header Section:**
- Cinema/show info (if available from QR params)
- Search bar (live search or "Search" placeholder)

**Banner Section:**
- Top promotional banner (type = H for header) if available
- Carousel or single banner, fetched from backend

**Category Navigation:**
- Horizontal scroll or tab navigation
- "All Products" + dynamic categories
- Click → filter product grid

**Product Grid:**
- Cards: image, name, price, "Add" button
- 1 column on narrow mobile, 2 on wider screens
- Optional: Small description snippet
- Click product card → product details (TBD: inline expansion or modal)

**Inner Banner:**
- Between category nav and product grid
- Type = I (inner) banner
- Promotional tie-in

**Bottom:**
- Sticky cart button (shows count and total)
- Always accessible while browsing

### Screen 3: Product Details (Optional)

- Full product view (if user clicks product card)
- Image, name, description, price
- Quantity selector
- Add to Cart button
- Related products or similar (nice-to-have)

**TBD**: Whether this is a modal, bottom sheet, or full page.

### Screen 4: Cart

- List of items with quantity, unit price, line total
- Discount breakdown (if applicable)
- Subtotal, taxes (if applicable), total
- +/− to adjust quantities
- Remove button per item
- "Proceed to Checkout" button

**Format**: Bottom sheet, drawer, or modal (TBD—likely bottom sheet for mobile UX)

### Screen 5: Checkout / Customer Information

**Fields (exact set TBD based on backend):**

Currently required by backend order API:
- `cinemaId` (required)
- `screenId` (optional, null for counter/kiosk)
- `customerMobile` (optional, but likely required for order pickup)
- `customerEmail` (optional)
- `filmTitle` (optional, display snapshot)
- `showTime` (optional)
- `seatNumber` (optional)
- `notes` (optional, free text)
- `source` (set by app: "qr", "seat_qr", "kiosk", or "counter")

**QR Prefill (TBD):**
- If QR params include `cinemaId`, `screenId`, `seatNumber`, `showTime` → prefill
- User can override if needed

**Form Strategy:**
- Keep minimal: only show truly required fields
- Use appropriate input types (tel for mobile, email for email)
- Validate on blur, show errors clearly
- Submit button: "Review Order" or skip directly to payment

### Screen 6: Order Summary

- List all items with quantities and prices
- Customer details as entered
- Total prominent
- "Confirm and Pay" button
- "Back to Cart" to edit

### Screen 7: Payment (Razorpay)

- Razorpay checkout overlay
- Customer completes payment
- Success or failure response

### Screen 8: Order Confirmation

- "Order Placed Successfully" message
- Order reference number / ID
- Optional: Confirmation details, "Thank you" message
- Button: "Done" or "Back Home"
- No order tracking link or status page

---

## 9. QR / URL Context Contract

### Overview

The consumer app is entered via QR codes or direct URLs with context parameters. These parameters pre-fill customer/order information and determine the `source` field for discount/pricing resolution.

### Entry Scenarios

#### Scenario 1: Seat-Specific QR
A QR code attached to a cinema seat/armrest.

**Example URL:**
```
https://qbusto.cinema.example.com?cinemaId=5&screenId=12&seatNumber=A5&showTime=2026-08-11T19:30:00Z&filmTitle=Avatar&source=seat_qr
```

**QR Parameters (all TBD backend support):**
| Param | Type | Required? | Pre-fills | Affects |
|-------|------|-----------|-----------|---------|
| `cinemaId` | integer | Yes | Cinema + filters products | Pricing (source=seat_qr) |
| `screenId` | integer | Yes | Screen in order | Pricing (source=seat_qr) |
| `seatNumber` | string | Yes | Seat number in order | Display only |
| `showTime` | ISO datetime | Yes | Show time in order | Display only |
| `filmTitle` | string | Yes | Film title in order | Display only |
| `source` | string (enum) | No | Not user-editable | Discount resolution (seat_qr) |

**Frontend behavior:**
- All parameters prefilled, user cannot change cinema/screen/seat/show/film
- User enters mobile, email (optional), notes
- Clicks "Pay"
- Backend resolves pricing using `source=seat_qr` for discounts
- Order created with this context

---

#### Scenario 2: General Cinema QR
A QR code at cinema entrance or displayed on kiosk/screen.

**Example URL:**
```
https://qbusto.cinema.example.com?cinemaId=5&source=qr
```

**URL Parameters:**
| Param | Type | Required? | Pre-fills | Affects |
|-------|------|-----------|-----------|---------|
| `cinemaId` | integer | Yes | Cinema + filters products | Pricing (source=qr) |
| `screenId` | integer | No | Not pre-filled | User must select |
| `seatNumber` | string | No | Not applicable | (hidden in form) |
| `showTime` | ISO datetime | No | Not pre-filled | User enters optionally |
| `filmTitle` | string | No | Not pre-filled | User enters optionally |
| `source` | string (enum) | No | Not user-editable | Discount resolution (qr) |

**Frontend behavior:**
- Cinema is set; user browses products
- User may optionally enter screen, seat, show time, film title
- Mobile, email are optional
- Backend resolves pricing using `source=qr` for discounts

---

#### Scenario 3: Kiosk Ordering
A kiosk environment where context is pre-configured (not via URL params).

**Entry:** User taps kiosk screen or receives app URL without parameters

**Configuration (TBD - may be baked into kiosk environment or passed via a separate init endpoint):**
- cinemaId is known from kiosk config
- source is `kiosk`
- No seat/screen context

**Frontend behavior:**
- Cinema is set; user browses products
- No seat/screen fields in form (kiosk orders are counter orders)
- Backend resolves pricing using `source=kiosk` for discounts

---

### Backend Order Source Values

The `source` field affects which pricing discount is applied. Exact values defined in `backend/src/constants.js`:

```javascript
const ORDER_SOURCES = {
  QR: 'qr',           // General QR (cinema entrance, etc.)
  SEAT_QR: 'seat_qr', // Seat-specific QR
  KIOSK: 'kiosk',     // Kiosk/counter ordering
  COUNTER: 'counter', // Manual counter entry (staff-only)
};
```

Each source maps to a pricing discount column:
- `qr` → `ProductPricing.discountOnQr`
- `seat_qr` → `ProductPricing.discountOnSeatQr`
- `kiosk` → `ProductPricing.discountOnKiosk`
- `counter` → `ProductPricing.discountOnCounter` (staff only)

### Parameter Validation

Frontend:
1. Parse URL params on app load
2. If `cinemaId` missing → show cinema selector (TBD: API needed)
3. If `cinemaId` provided → validate it exists via GET /api/consumer/cinemas/{id}
4. If `screenId` provided → validate it belongs to cinema
5. If params invalid → clear them, show selector UI

### Missing Context Parameters

If a required parameter is missing:
- User enters/selects the information
- `source` defaults to `qr` (not `seat_qr` or `kiosk`)

### No Consumer-Side Cinema Selector Yet

The consumer app currently does not have a public cinema list/selector API. **Backend work needed:** Provide a GET /api/consumer/cinemas endpoint if the consumer needs to choose cinema without a QR code.

---

## 10. Consumer API Requirements

### Key Architectural Principle

All endpoints below are **UNAUTHENTICATED** consumer endpoints. They are distinct from the staff-facing authenticated API.

Endpoints should be:
- Prefixed `/api/consumer/` or in a separate consumer namespace
- Read-only for catalog (GET only)
- Allow order creation without authentication
- Enforce business rules server-side (availability, pricing, cinema/product link validation)

### Unauthenticated APIs Needed

#### 10.1 Cinema / Context Lookup (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Get cinema details by ID | GET | `/api/consumer/cinemas/{id}` | None | Path: `id` | Cinema object (id, name, code, location, city) |

**Backend source**: New endpoint; wraps existing authenticated Cinema API

**Usage**: Validate QR param `cinemaId` exists and is active.

#### 10.2 Screen Lookup (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Get screen by ID | GET | `/api/consumer/cinemas/{cinemaId}/screens/{id}` | None | Path: cinemaId, id | Screen object (id, name, cinemaId) |

**Backend source**: New endpoint; wraps existing authenticated Screen API

**Usage**: Validate QR param `screenId` exists and belongs to cinema.

#### 10.3 Categories (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| List categories for a cinema | GET | `/api/consumer/cinemas/{cinemaId}/categories` | None | Query: `limit`, `page`, `sort`, `order` | Paginated categories (id, name, imageUrl, description) |

**Backend source**: New endpoint; wraps existing authenticated Category API, filters by cinema via cinema_product links

**Fields needed**: `id`, `name`, `imageUrl` (if available), `description`

**Sorting**: By sequence/display order if available, else by name

#### 10.4 Products for Cinema (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| List products available at a cinema | GET | `/api/consumer/cinemas/{cinemaId}/products` | None | Query: `categoryId`, `limit`, `page`, `search` | Paginated products (id, name, description, imageUrl, basePrice) |

**Backend source**: New endpoint; joins Product + CinemaProduct + ProductPricing filtered by cinema

**Fields needed**:
- `id` (product id)
- `name`
- `description`
- `imageUrl`
- `basePrice` (current price for this cinema, based on day-of-week, source discount if applicable)

**Filters**:
- `categoryId` (optional): Filter by category
- `search` (optional): Partial match on product name
- `limit`, `page`: Pagination

**Availability check**: Product must:
- Be `isActive = true`
- Have an active `CinemaProduct` link at this cinema
- Have an active `ProductPricing` row for today (matching dayOfWeek)
- Be within any `availableFrom`/`availableUntil` date range on the CinemaProduct

#### 10.5 Product Detail (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Get single product with full details for a cinema | GET | `/api/consumer/cinemas/{cinemaId}/products/{id}` | None | Path: cinemaId, id | Product detail (id, name, description, imageUrl, basePrice, addons[]) |

**Backend source**: New endpoint; same filtering as category products

**Fields**: Same as category products list, plus:
- `addons` (array of addon products, if any): `[{ id, name, basePrice, ... }]` (TBD if needed in this phase)

**Note**: Availability validation same as list endpoint.

#### 10.6 Banners for Cinema (NEW)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Get banners for a cinema (by type) | GET | `/api/consumer/cinemas/{cinemaId}/banners` | None | Query: `type` (H or I) | Array of banners (id, imageUrl, type, sequence) |

**Backend source**: New endpoint; wraps existing authenticated Banner API, filters by cinema and active/date-valid

**Fields needed**: `id`, `imageUrl`, `type` (H = header, I = inner), `sequence` (display order)

**Filtering**:
- `type` (optional): H for header, I for inner
- Must be `isActive = true`
- Must be within `startDate`/`endDate` window (if specified)

**Usage**: Fetch header banner once on app load, inner banner for product listing section.

#### 10.7 Order Creation (NEW - CRITICAL)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Create local order (DB only, IDEMPOTENT) | POST | `/api/consumer/orders` | **None** | Order details + items + Idempotency-Key header | Order with orderId, items, totals (no Razorpay data yet) |

**Backend source**: New consumer endpoint; separate from staff endpoint `/api/orders`

**This endpoint creates the local order record only (IDEMPOTENT by idempotency key):**
1. Validates cinema/context/screen/products
2. Calculates all prices server-side (paise arithmetic)
3. Creates internal order rows (status: initiated, paymentStatus: pending, razorpayOrderId=NULL)
4. Returns orderId + items + totals for frontend display
5. Does NOT create Razorpay order (done in step 2, below)

**Idempotency Strategy (CRITICAL):**
- Frontend generates a **UUID idempotency key** when entering checkout (once per checkout session)
- Sent via HTTP header: `Idempotency-Key: <UUID>`
- Backend persists or associates this key with the order
- If same `Idempotency-Key` is retried:
  - Backend loads existing order (by idempotency key)
  - Returns existing orderId (no new order created)
  - Prevents duplicate orders if network fails after successful commit but before response reaches frontend

**Example Timeline (Idempotent Retry):**
```
Request 1:
→ POST /api/consumer/orders with Idempotency-Key: abc-123-def-456
← Backend creates order 789, persists key abc-123-def-456 → 789
← Response sent to frontend with orderId: 789

Network fails, frontend never receives response.

Request 2 (Retry):
→ POST /api/consumer/orders with same Idempotency-Key: abc-123-def-456
← Backend looks up key abc-123-def-456, finds order 789
← Returns existing order 789 (no new order created)
← Frontend receives orderId: 789 and proceeds normally
```

**Request Body**:

```
POST /api/consumer/orders HTTP/1.1
Content-Type: application/json
Idempotency-Key: a1b2c3d4-e5f6-7890-abcd-ef1234567890

{
  "cinemaId": 5,
  "screenId": 12,
  "seatNumber": "A5",
  "source": "seat_qr",
  "customerMobile": "9876543210",
  "customerEmail": "customer@example.com",
  "filmTitle": "Avatar",
  "showTime": "2026-08-11T19:30:00Z",
  "notes": "Extra ice, no onions",
  "items": [
    { "productId": 1, "quantity": 2 },
    { "productId": 3, "quantity": 1 }
  ]
}
```

**Idempotency-Key Header (REQUIRED):**
- Format: UUID v4 (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)
- Generated by frontend when user enters checkout form
- Must be consistent across all retries of the same checkout
- Backend uses this to detect and prevent duplicate orders
- Retry with same key after any network failure will return existing order

**Validation** (server-side, authoritative):
1. `cinemaId` must exist and be active
2. `screenId` (if provided) must belong to the cinema and be active
3. Each `productId` must:
   - Exist and be active
   - Have an active CinemaProduct link at this cinema
   - Have an active ProductPricing row for today
   - Be within any date/time availability windows
4. No product duplicate in items array
5. Total quantity across items ≤ 50 (or similar limit)

**Response** (201 Created):

```json
{
  "success": true,
  "data": {
    "orderId": 123,
    "status": "initiated",
    "paymentStatus": "pending",
    "subtotal": 1200.00,
    "discount": 50.00,
    "total": 1150.00,
    "currency": "INR",
    "items": [
      {
        "productId": 1,
        "productName": "Popcorn Large",
        "quantity": 2,
        "unitPrice": 500.00,
        "lineTotal": 1000.00
      }
    ],
    "customerMobile": "9876543210",
    "customerEmail": "customer@example.com",
    "createdAt": "2026-08-12T10:45:30Z"
  }
}
```

**Important Notes:**
- `total` is in rupees (display format). Backend will recalculate in paise for Razorpay.
- No `razorpayOrderId` in response. It will be created in the next step (10.7bis).
- Order is now in the database but NOT yet connected to Razorpay.
- Response is idempotent: same `Idempotency-Key` always returns same `orderId`

**Idempotency Behavior:**
- First request with key: Creates order, returns orderId
- Retry with same key: Loads existing order, returns same orderId
- Retry with different key: Creates new order, returns different orderId
- Retry with different payload + same key: Returns existing orderId (payload is ignored on retry)
- Frontend must always retry checkout with the SAME `Idempotency-Key` until successful

**Error Handling**:
- 400: Validation failed (invalid product, source, quantity, availability, etc.)
- 409: Cinema/screen/product deactivated or unavailable
- 500: Database error
- Same `Idempotency-Key` with invalid payload: Returns success with existing order on first commit, validation errors on retry

---

#### 10.7bis Payment Initialization (NEW - CRITICAL)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Create Razorpay order + prepare payment checkout (IDEMPOTENT) | POST | `/api/consumer/orders/{orderId}/payment-init` | **None** | orderId | razorpayOrderId, razorpayKeyId, amount (paise) |

**Backend source**: New consumer endpoint; idempotent for retries, minimizes Razorpay duplicates under concurrency

**This endpoint initializes Razorpay payment for an existing local order (IDEMPOTENT):**
1. Load order by orderId with pessimistic lock (if supported by database)
2. Verify order exists and paymentStatus is "pending"
3. If razorpayOrderId already exists: return it immediately (idempotent)
4. If razorpayOrderId is NULL: Create Razorpay order via Razorpay API, try to store razorpayOrderId
5. If store succeeds: return razorpayOrderId
6. If store fails (another request won the race): reload and return their razorpayOrderId

**Request Body** (minimal):
```json
{}
```

**Response** (200 OK):

```json
{
  "success": true,
  "data": {
    "orderId": 123,
    "razorpayOrderId": "order_ABC123XYZ",
    "razorpayKeyId": "rzp_live_xyz123",
    "amount": 115000,
    "currency": "INR"
  }
}
```

**Response Fields:**
- `orderId`: Local order ID (same as request)
- `razorpayOrderId`: Razorpay order ID (created by Razorpay, stored locally)
- `razorpayKeyId`: Razorpay public KEY_ID (safe to send to frontend for checkout)
- `amount`: Total in paise (INR × 100); use this for Razorpay checkout

**Idempotency for Retries:**
- If called multiple times, returns the same `razorpayOrderId` (safe to retry)
- If Razorpay order creation fails (503, 500), razorpayOrderId remains NULL and next call retries
- If network fails after Razorpay succeeds but before storing ID, next retry creates duplicate Razorpay order (see Concurrency below)

**Concurrency Handling (Rare Edge Cases):**

**Scenario: Two simultaneous requests both call payment-init for the same orderId**

Under typical conditions (sequential requests from same browser):
- First request gets pessimistic lock, creates Razorpay order A, stores ID successfully
- Second request waits for lock, then loads order and sees razorpayOrderId is set, returns order A's ID
- Result: One Razorpay order used

Under rare edge case (true simultaneous requests at exact same millisecond):
- Request A and B both load order (before either acquires lock/before lock is released)
- Both see razorpayOrderId = NULL
- Both call Razorpay API → create order A and order B
- Request A tries to store razorpayOrderId = order_A → succeeds
- Request B tries to store razorpayOrderId = order_B (WHERE razorpayOrderId IS NULL) → fails (already set)
- Request B reloads and returns razorpayOrderId = order_A (the stored one)
- Both frontend requests receive order_A
- Razorpay order_B is orphaned (harmless; will expire, can't be charged without local order knowing about it)

**Acceptable Because:**
- Frontend receives correct razorpayOrderId (order_A)
- Only one local order exists
- Only one local order can be verified/paid (via signature verification)
- Razorpay orphaned orders expire and require the local order to be verified before any charges
- True simultaneous requests are extremely rare (would require exact millisecond timing)

**Error Handling**:
- 404: Order not found
- 409: Order payment status is not "pending" (already paid, failed, or rejected)
- 503: Razorpay API unavailable; customer can retry
- 500: Database error

---

#### 10.8 Payment Signature Verification (NEW - CRITICAL)

| Purpose | Method | Endpoint | Auth | Request | Response |
|---------|--------|----------|------|---------|----------|
| Verify Razorpay payment signature + update order state (IDEMPOTENT) | POST | `/api/consumer/orders/{orderId}/payment-verify` | **None** | Razorpay payment callback response | Updated order (paymentStatus: paid) |

**Backend source**: New consumer endpoint

**The ONLY endpoint that updates payment state. Frontend callback alone does NOT change order state. This endpoint is IDEMPOTENT.**

**Request Body**:

```json
{
  "razorpayPaymentId": "pay_ABC123XYZ",
  "razorpaySignature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d"
}
```

**Backend Logic:**

1. Load order by orderId
2. Verify order exists
3. If paymentStatus is already "paid":
   - Re-verify the signature (optional, for additional security)
   - Return 200 with order details (idempotent success)
4. Else if paymentStatus is not "pending":
   - Return 409 (order cannot be paid from this state)
5. Verify razorpayOrderId is not NULL (order must be initialized)
6. Construct verification string: `{razorpayOrderId}|{razorpayPaymentId}`
7. Compute HMAC-SHA256(verification string, RAZORPAY_KEY_SECRET)
8. Compare computed signature to provided signature
9. If signatures do NOT match → return 403 (tampered/invalid payment)
10. If signatures match → update order (paymentStatus: paid) + insert payment_status_log with razorpayPaymentId in one transaction

**Response (200 on successful verification)**:

```json
{
  "success": true,
  "data": {
    "orderId": 123,
    "status": "initiated",
    "paymentStatus": "paid",
    "razorpayPaymentId": "pay_ABC123XYZ",
    "subtotal": 1200.00,
    "discount": 50.00,
    "total": 1150.00,
    "createdAt": "2026-08-12T10:45:30Z"
  }
}
```

**Idempotency:**
- If order already has paymentStatus=paid, return 200 (no duplicate log entry created)
- Retry with same razorpayPaymentId and signature is safe; returns existing paid state
- This prevents double-crediting if frontend retries after a network failure

**Error Handling**:
- 403: Signature verification failed (possible tampering or invalid payment)
- 404: Order not found
- 409: Order payment status is not "pending" (already paid, rejected, or cannot be paid from current state)
- 500: Database error

**Security Notes**: 
- Razorpay callback alone NEVER changes order state. Backend verification is mandatory.
- Only backend signature verification marks an order as paid.
- Never trust frontend callbacks or payment success indicators.

---

## 11. Existing APIs vs APIs We Need to Add

### Staff-Only Authenticated APIs (Existing)

These require JWT authentication and staff permissions. **Consumer cannot use these.**

| Endpoint | Auth | Purpose | Consumer Use? |
|----------|------|---------|---------------|
| GET /api/cinemas | YES | List all cinemas | ❌ No (authenticated) |
| GET /api/cinemas/{id} | YES | Cinema details | ❌ No (authenticated) |
| GET /api/categories | YES | List categories | ❌ No (authenticated) |
| GET /api/products | YES | List products | ❌ No (authenticated) |
| GET /api/product-pricing | YES | List pricing | ❌ No (authenticated) |
| GET /api/banners | YES | List banners | ❌ No (authenticated) |
| GET /api/cinema-products | YES | Cinema/product links | ❌ No (authenticated) |
| GET /api/product-availability-hours | YES | Availability windows | ❌ No (authenticated) |
| GET /api/screens | YES | List screens | ❌ No (authenticated) |
| POST /api/orders | YES | Create order (staff only) | ❌ No (authenticated + permission check) |
| GET /api/orders | YES | List orders (staff) | ❌ No (authenticated) |
| PUT /api/orders/{id}/status | YES | Update order status (staff) | ❌ No (authenticated) |

### New Unauthenticated APIs Needed (Missing)

| Endpoint | Method | Purpose | Priority |
|----------|--------|---------|----------|
| GET /api/consumer/cinemas/{id} | GET | Validate cinema exists | High |
| GET /api/consumer/cinemas/{cinemaId}/screens/{id} | GET | Validate screen exists | High |
| GET /api/consumer/cinemas/{cinemaId}/categories | GET | List categories for ordering | High |
| GET /api/consumer/cinemas/{cinemaId}/products | GET | List products for ordering | High |
| GET /api/consumer/cinemas/{cinemaId}/products/{id} | GET | Product details | High |
| GET /api/consumer/cinemas/{cinemaId}/banners | GET | Fetch banners | High |
| POST /api/consumer/orders | POST | Create local order (DB only) | **Critical** |
| POST /api/consumer/orders/{orderId}/payment-init | POST | Initialize Razorpay payment (idempotent) | **Critical** |
| POST /api/consumer/orders/{orderId}/payment-verify | POST | Verify Razorpay signature + update state (idempotent) | **Critical** |

---

## 12. Product Catalog Data Flow

```
App Loads
    ↓
Check URL params (cinemaId, screenId, etc.)
    ↓
[If cinemaId in params]
  Fetch GET /api/consumer/cinemas/{cinemaId} → validate exists
    ↓
Fetch GET /api/consumer/cinemas/{cinemaId}/categories → category list
    ↓
Fetch GET /api/consumer/cinemas/{cinemaId}/banners?type=H → header banner
    ↓
User browses categories or searches
    ↓
Fetch GET /api/consumer/cinemas/{cinemaId}/products?categoryId=X → product list
    ↓
Fetch GET /api/consumer/cinemas/{cinemaId}/banners?type=I → inner banners
    ↓
User clicks product
    ↓
[Optional] Fetch GET /api/consumer/cinemas/{cinemaId}/products/{productId} → details
    ↓
User adds to cart (client-side state)
```

**Caching Strategy:**
- Categories: Cache for session (static per cinema)
- Banners: Cache for session (or refresh every 5 min)
- Products: Cache for session (user may be browsing for 20+ min)
- Pricing: Calculated at order creation time (server-side, not cached)

**Performance Optimization:**
- Load categories + header banner on app init
- Lazy-load product images (use `loading="lazy"`)
- Paginate product listing (load-more pattern)
- Debounce search input (300ms)

---

## 13. Cart State

### Cart Store (Zustand)

Simple, flat structure:

```typescript
interface CartItem {
  productId: number;
  productName: string; // snapshot for display
  quantity: number;
  unitPrice: number; // snapshot at time of add
  imageUrl?: string; // optional
}

interface CartStore {
  items: CartItem[];
  cinemaId: number | null; // fixed for this order
  addItem(productId: number, name: string, price: number, quantity: number): void;
  updateQuantity(productId: number, quantity: number): void;
  removeItem(productId: number): void;
  clear(): void;
  isEmpty(): boolean;
  itemCount(): number; // total items across all products
  estimatedTotal(): number; // rough calc, not final price
}
```

### Discount Calculation

**NOT in client state.** Server calculates final prices at order creation:
- Fetches current ProductPricing row for cinema/product/dayOfWeek
- Applies source-specific discount (qr, seat_qr, kiosk, counter)
- Returns final unit price and totals

**Frontend**: Use `estimatedTotal()` for display only. Final total comes from order response.

---

## 14. Checkout Data Flow (Two-Phase)

```
User clicks "Proceed to Checkout"
    ↓
Display checkout form:
  - customerMobile (required?)
  - customerEmail (optional)
  - seatNumber (prefilled if from QR)
  - filmTitle (prefilled if from QR)
  - showTime (prefilled if from QR)
  - screenId (prefilled if from QR)
  - notes (optional)
    ↓
User fills form, clicks "Continue"
    ↓
PHASE 1: POST /api/consumer/orders
  (cart items + customer info + cinemaId)
    ↓
Server creates local order, returns orderId + items + total (no Razorpay data)
    ↓
Frontend stores orderId locally
    ↓
Display order summary (read-only)
    ↓
User clicks "Confirm and Pay"
    ↓
PHASE 2: POST /api/consumer/orders/{orderId}/payment-init
  (orderId only)
    ↓
Server creates Razorpay order, returns razorpayOrderId + razorpayKeyId + amount (paise)
    ↓
Frontend stores razorpayOrderId, razorpayKeyId, amount locally
    ↓
Initiate Razorpay checkout (see Payment Flow section, Step 3)
```

**Why Two Phases?**
- Phase 1 creates local order (safe, transactional)
- Phase 2 creates Razorpay order (external API call, can fail)
- Separation allows Phase 2 to be idempotent and retryable without creating duplicate local orders

---

## 15. Razorpay Payment Flow (THE ONLY FLOW)

### Single, Definitive 4-Step Flow

This is the ONLY documented payment flow. There is no alternate design.

This is a **two-phase design**: Order creation is separate from payment initialization to enable safe retries without creating duplicate local orders.

#### Step 1: Create Local Order (Frontend Action)

Frontend submits checkout form (cinema, products, quantities, customer info):

```
POST /api/consumer/orders
Content-Type: application/json

{
  "cinemaId": 5,
  "screenId": 12,
  "seatNumber": "A5",
  "source": "seat_qr",
  "customerMobile": "9876543210",
  "customerEmail": "customer@example.com",
  "filmTitle": "Avatar",
  "showTime": "2026-08-11T19:30:00Z",
  "notes": "Extra popcorn butter",
  "items": [
    { "productId": 1, "quantity": 2 },
    { "productId": 3, "quantity": 1 }
  ]
}
```

**Backend Response** (201 Created):
- Creates order with status: initiated, paymentStatus: pending, razorpayOrderId: NULL
- Returns orderId + items + total (in rupees)
- Does NOT create Razorpay order yet

**Frontend**: Store orderId locally, proceed to Step 2.

---

#### Step 2: Initialize Payment with Razorpay (Idempotent)

Frontend calls payment initialization endpoint with orderId:

```
POST /api/consumer/orders/{orderId}/payment-init
Content-Type: application/json

{}
```

**Backend Logic**:
1. Load order by orderId
2. Verify order exists and paymentStatus is "pending"
3. **If razorpayOrderId already exists**: Return it immediately (idempotent)
4. **If razorpayOrderId is NULL**: Create Razorpay order, store razorpayOrderId, return it

**Backend Response** (200 OK):
- razorpayOrderId (Razorpay order ID)
- razorpayKeyId (Razorpay public KEY_ID)
- amount (in paise, calculated from stored order total)
- currency: INR

**Key Property**: This endpoint is **IDEMPOTENT**. Retry-safe without creating duplicate Razorpay orders.

**Frontend**: Store razorpayOrderId + razorpayKeyId + amount locally, proceed to Step 3.

---

#### Step 3: Open Razorpay Checkout (Frontend Action)

Frontend has: orderId, razorpayOrderId, razorpayKeyId, amount (paise).

```javascript
import Razorpay from 'razorpay/dist/razorpay';

async function handlePaymentClick() {
  const options = {
    key: razorpayKeyId,           // Public KEY_ID from Step 2
    amount: amount,                // In paise (server-calculated)
    currency: 'INR',
    order_id: razorpayOrderId,     // Razorpay order ID from Step 2
    name: cinemaName,
    description: `Order #${orderId}`,
    customer_id: customerMobile || '',
    email: customerEmail || '',
    contact: customerMobile || '',
    
    handler: async (response) => {
      // Razorpay indicates payment was processed.
      // Do NOT trust this callback; must verify server-side.
      await verifyPayment(orderId, response);
    },
    
    prefill: {
      email: customerEmail || '',
      contact: customerMobile || '',
    },
    
    theme: {
      color: '#F37254', // Cinema branding
    },
  };

  const rzp = new Razorpay(options);
  rzp.open();
}

async function verifyPayment(orderId, razorpayResponse) {
  // Call Step 4
}
```

**User completes payment in Razorpay checkout** or closes the modal.

---

#### Step 4: Verify Payment Signature (Idempotent)

After Razorpay callback (success, failure, or user close), frontend calls verification endpoint:

```
POST /api/consumer/orders/{orderId}/payment-verify
Content-Type: application/json

{
  "razorpayPaymentId": "pay_ABC123XYZ",
  "razorpaySignature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d"
}
```

**Backend Logic**:
1. Load order by orderId
2. Verify order exists
3. **If paymentStatus is already "paid"**: Return 200 (idempotent success, no duplicate log)
4. **If paymentStatus is not "pending"**: Return 409 (cannot be paid from this state)
5. Verify razorpayOrderId is not NULL (order must be initialized via Step 2)
6. Construct: `{razorpayOrderId}|{razorpayPaymentId}`
7. Compute HMAC-SHA256(string, RAZORPAY_KEY_SECRET)
8. Compare signature
9. If invalid → return 403 (tampered/invalid)
10. If valid → Update order (paymentStatus: paid) + insert payment_status_log in transaction

**Backend Response** (200 OK):
- orderId, status, paymentStatus: paid, total
- razorpayPaymentId (for receipt)

**Key Property**: This endpoint is **IDEMPOTENT**. Retry-safe without duplicate payment updates.

**Frontend**: If 200, show success screen. If 403 or error, show retry option.

---

### Retry Safety & Idempotency

| Scenario | Backend Behavior | Duplicate Risk | Mitigation |
|----------|------------------|-----------------|--------------|
| Step 1 succeeds, network fails before response | Order created successfully | Would create duplicate on retry | ✅ Idempotency key prevents duplicate (same key returns existing order) |
| Step 1 retried with same Idempotency-Key | Backend looks up key, returns existing orderId | Zero duplicate risk | ✅ Idempotent by design |
| Step 1 retried with different Idempotency-Key | Backend creates new order | Two orders created | ✅ By design (different checkout, different order) |
| Step 2 succeeds, network fails | razorpayOrderId stored | One Razorpay order used | ✅ Retry returns existing razorpayOrderId |
| Step 2 retried after failure | Retry creates Razorpay order | None, razorpayOrderId is set | ✅ Idempotent check prevents duplicate |
| Step 2: True simultaneous requests (exact millisecond timing) | Both call Razorpay, second loses DB race | Razorpay orphan order_B created, but order_A is used | ⚠️ Rare, acceptable (orphan expires, can't charge) |
| Step 4 succeeds, network fails | Payment marked paid | One payment recorded | ✅ Retry returns success (idempotent) |
| Concurrent Step 4 retries | First verifies and marks paid, second sees paid and returns success | No duplicate payment_status_logs | ✅ Idempotent by design |

### Failure & Recovery Scenarios

**Frontend network error, doesn't know if request succeeded:**
- Step 1 network error: Retry creates another local order (acceptable; low likelihood in practice)
- Step 2 network error: Retry is idempotent via razorpayOrderId check
- Step 4 network error: Retry is idempotent via paymentStatus check

**Razorpay API down during Step 2:**
- Order exists locally with razorpayOrderId=NULL
- Frontend shows error "Payment setup failed; please try again"
- Next retry of Step 2 attempts to create Razorpay order again
- On success, razorpayOrderId is stored and checkout proceeds

**User closes Razorpay modal or payment fails:**
- Razorpay closes, no callback
- Order remains in pending state (no Razorpay payment ID received)
- Frontend shows "Payment cancelled. Try again or contact support"
- Retry: Frontend can retry Step 3 (open Razorpay again) and Step 4 (verify)

### No Additional Payment Endpoints

There is:
- ❌ NO `/api/consumer/orders/{id}/payment` endpoint
- ✅ POST `/api/consumer/orders/{orderId}/payment-init` (Step 2, idempotent)
- ✅ POST `/api/consumer/orders/{orderId}/payment-verify` (Step 4, idempotent)

### Razorpay Secret Management

- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` stored in backend environment
- Fetched from PaymentGatewayConfig (per-cinema) or environment (global)
- Never exposed to frontend
- Never committed to repo

### Payment Failure Handling

**If customer cancels Razorpay checkout:** Browser closes modal, no callback. Frontend shows "Payment cancelled. Your order is pending." with retry option.

**If payment fails at Razorpay:** Razorpay calls error handler. Frontend shows "Payment failed. Retry or contact support."

**If signature verification fails:** Backend returns 403. Frontend shows "Payment could not be verified. Contact support with order #XYZ. Do not retry immediately."

**If Razorpay order creation fails:** POST /api/consumer/orders returns 500. Customer retries checkout from cart.

### Test Cases (Phase 9)

- [x] Razorpay order created with correct amount (in paise)
- [x] Valid payment signature verified successfully
- [x] Invalid/tampered signature rejected
- [x] Order state transitions: pending → paid (only on successful verification)
- [x] Duplicate payment attempts rejected
- [x] Payment after order timeout/expiry handled gracefully

---

## 16. Order Creation Flow

### Frontend Logic

```typescript
// 1. Collect cart items + customer info
const orderRequest = {
  cinemaId: selectedCinemaId,
  screenId: selectedScreenId || null,
  seatNumber: seatNumberInput || null,
  source: urlParams.source || 'qr',
  customerMobile: mobileInput,
  customerEmail: emailInput || null,
  filmTitle: filmTitleInput || null,
  showTime: showTimeInput || null,
  notes: notesInput || null,
  items: cart.items.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
  })),
};

// 2. POST to backend
const orderResponse = await fetch('/api/consumer/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(orderRequest),
});

if (!orderResponse.ok) {
  const error = await orderResponse.json();
  // Show validation/error message
  return;
}

const order = await orderResponse.json();

// 3. Store order locally (for reference)
localStorage.setItem('lastOrderId', order.data.id);

// 4. Clear cart
clearCart();

// 5. Navigate to order summary / payment screen
navigateTo('/payment', { orderId: order.data.id });
```

### Backend Validation & Creation

**Server-side checks (see section 10.7 for full list):**
1. Cinema exists and is active
2. Each product is active, linked to cinema, has valid pricing, within availability
3. No duplicate products in request
4. Item quantities are valid (1-999 per product, max 50 total)
5. Customer data is valid (phone format if provided, etc.)

**Calculation** (server-side, NOT from frontend):
- Fetch ProductPricing row for each product at this cinema, today
- Apply source-specific discount (if applicable)
- Calculate line totals = quantity × (basePrice - discount)
- Sum all items → subtotal
- Add taxes if applicable (TBD in spec)
- Calculate final total

**Database transaction:**
1. Create `orders` row (status: initiated, paymentStatus: pending, amounts, customer info)
2. Create `order_items` row per item (frozen snapshot: productName, unitPrice, etc.)
3. Create initial `order_status_logs` entry (initiated → initiated, no change)
4. Create initial `payment_status_logs` entry (pending → pending, no change)
5. Commit transaction

**Response:** OrderDetail with all fields + razorpayOrderId

---

## 17. Recommended Frontend Architecture

This is intentionally lightweight and minimal. Do not add complexity.

### Directory Structure

```
consumer/src/
├── api/
│   └── generated/              # Orval-generated client (never edit)
├── components/                 # Reusable UI components
│   ├── Header.tsx
│   ├── Button.tsx
│   ├── ProductCard.tsx
│   ├── CartDrawer.tsx
│   └── ...
├── pages/                      # Page/route components
│   ├── ScreensaverPage.tsx
│   ├── CatalogPage.tsx
│   ├── CheckoutPage.tsx
│   ├── PaymentPage.tsx
│   └── ConfirmationPage.tsx
├── services/                   # API wrappers + business logic
│   ├── catalog.service.ts
│   ├── orders.service.ts
│   └── validation.service.ts
├── stores/                     # Zustand state
│   ├── cart.store.ts
│   ├── context.store.ts
│   └── ui.store.ts
├── utils/                      # Helpers
│   ├── formatMoney.ts
│   ├── formatPhone.ts
│   └── urlParams.ts
├── styles/                     # Global styles
│   ├── global.scss
│   ├── colors.scss
│   └── responsive.scss
├── App.tsx                     # Router + layout
├── main.tsx                    # Entry point
└── index.html
```

**This structure is a guideline, not a mandate.** Create files only when you need them. Do not pre-create empty directories.

### Routing (Simple)

```typescript
// App.tsx uses React Router
const routes = [
  { path: '/', element: <ScreensaverPage /> },
  { path: '/catalog', element: <CatalogPage /> },
  { path: '/checkout', element: <CheckoutPage /> },
  { path: '/payment', element: <PaymentPage /> },
  { path: '/confirmation', element: <ConfirmationPage /> },
];
```

### State Management (Zustand Only)

- **cart.store.ts**: Cart items, add/remove/update
- **context.store.ts**: Cinema/screen/seat from QR params
- **ui.store.ts**: Cart drawer open, loading states

**Do NOT introduce Redux, MobX, Recoil, or other state libraries.** Zustand is already installed.

For temporary state (form inputs, modals), use React's `useState`.

### Services (Thin Wrappers)

Services wrap the Orval-generated client. Do not duplicate logic.

Example:

```typescript
// services/catalog.service.ts
import { getApiConsumerCinemasCinemaIdCategoriesGet } from '@/api/generated/...';

export async function fetchCategories(cinemaId: number) {
  const { data } = await getApiConsumerCinemasCinemaIdCategoriesGet(cinemaId);
  return data ?? [];
}
```

### Error Handling

Centralized error mapper:

```typescript
// utils/errors.ts
export function formatApiError(error: any): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || 'Something went wrong';
  }
  return 'An unexpected error occurred';
}
```

Use this in try/catch blocks, show to user.

---

## 18. Recommended Lightweight Libraries

### UI / Components

| Purpose | Library | Why | Size | Notes |
|---------|---------|-----|------|-------|
| Form handling | React Hook Form | Minimal bundle, powerful validation | ~8kb | Pair with Zod for schema |
| Schema validation | Zod | TypeScript-first, tree-shakable | ~10kb | Use for server response validation too |
| Accessible primitives | Radix UI (optional) | Headless, unstyled, accessible | ~30kb | Optional if custom Sass is sufficient |
| Icons | Lucide React | Tree-shakable, modern icons | ~2-5kb per icon used | Pair with Icon component wrapper |
| Modals / Drawers | Headless UI (optional) | Minimal, unstyled, accessible | ~10kb | Or build custom with CSS |
| **DO NOT USE** | Ant Design | Too heavy for consumer app (500kb+) | N/A | For admin dashboard only |

### Styling

| Purpose | Library | Why | Notes |
|---------|---------|-----|-------|
| Styling | Sass (already in deps) | CSS variables, nesting, mixins | Use CSS Grid + Flexbox |
| Responsive | CSS Media Queries | Native browser support | Mobile-first approach |
| Safe Areas | CSS `env(safe-area-inset-*)` | Built-in notch support | Use in header/footer |
| Animations | CSS only (no library) | Small, performant | Use `transition`, `animation` sparingly |

### State Management

| Purpose | Library | Why | Size |
|---------|---------|-----|------|
| Client state | Zustand (already in deps) | Minimal, no boilerplate | ~2kb |
| Data fetching | Axios (already in deps) | Already installed | ~5kb |

### API Client generation

| Purpose | Library | Why | Setup |
|---------|---------|-----|-------|
| Generated API | Orval (already in deps) | OpenAPI → TypeScript client | Run `npm run gen:api` |

### Developer Experience

| Purpose | Library | Why | Notes |
|---------|---------|-----|-------|
| Linting | ESLint (already configured) | Code quality | Run `npm run lint` |
| Type checking | TypeScript | Compile-time safety | Run `npm run typecheck` or `tsc` |
| Formatting | Prettier | Code consistency | Run `npm run format` (if available) |

### What NOT to Install

- ❌ Ant Design (too heavy)
- ❌ Material-UI (too heavy)
- ❌ Bootstrap (not needed with custom CSS)
- ❌ Lodash (use native JS or tree-shake if needed)
- ❌ date-fns (use native Date or day.js if complex)
- ❌ Redux (Zustand is simpler for this app)
- ❌ Storybook (not needed for a single-purpose app)

---

## 19. State Management

### Zustand Stores

#### Cart Store

```typescript
// stores/cart.store.ts
import { create } from 'zustand';

interface CartItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

interface CartState {
  items: CartItem[];
  addItem(productId: number, name: string, price: number): void;
  updateQuantity(productId: number, quantity: number): void;
  removeItem(productId: number): void;
  clear(): void;
  isEmpty(): boolean;
  itemCount(): number;
  estimatedSubtotal(): number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (productId, name, price) => {
    set(state => {
      const existing = state.items.find(i => i.productId === productId);
      if (existing) {
        // Immutable update: map over items and increment quantity for matching product
        return {
          items: state.items.map(i =>
            i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      // New item
      return {
        items: [...state.items, { productId, productName: name, quantity: 1, unitPrice: price }],
      };
    });
  },
  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
    } else {
      set(state => ({
        items: state.items.map(i => (i.productId === productId ? { ...i, quantity } : i)),
      }));
    }
  },
  removeItem: (productId) => {
    set(state => ({
      items: state.items.filter(i => i.productId !== productId),
    }));
  },
  clear: () => set({ items: [] }),
  isEmpty: () => get().items.length === 0,
  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
  estimatedSubtotal: () => get().items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
}));
```

#### Context Store (QR Parameters)

```typescript
// stores/context.store.ts
interface ContextState {
  cinemaId: number | null;
  screenId: number | null;
  seatNumber: string | null;
  showTime: string | null;
  filmTitle: string | null;
  source: 'qr' | 'seat_qr' | 'kiosk' | 'counter';
  setContext(ctx: Partial<ContextState>): void;
  clear(): void;
}

export const useContextStore = create<ContextState>((set) => ({
  cinemaId: null,
  screenId: null,
  seatNumber: null,
  showTime: null,
  filmTitle: null,
  source: 'qr',
  setContext: (ctx) => set(ctx),
  clear: () =>
    set({
      cinemaId: null,
      screenId: null,
      seatNumber: null,
      showTime: null,
      filmTitle: null,
      source: 'qr',
    }),
}));
```

#### UI Store

```typescript
// stores/ui.store.ts
interface UIState {
  cartOpen: boolean;
  paymentLoading: boolean;
  errorMessage: string | null;
  toggleCart(): void;
  setPaymentLoading(loading: boolean): void;
  setError(message: string | null): void;
}

export const useUIStore = create<UIState>((set) => ({
  cartOpen: false,
  paymentLoading: false,
  errorMessage: null,
  toggleCart: () => set(state => ({ cartOpen: !state.cartOpen })),
  setPaymentLoading: (loading) => set({ paymentLoading: loading }),
  setError: (message) => set({ errorMessage: message }),
}));
```

---

## 20. API Client / Orval

### Setup

The consumer package already has Orval installed (see package.json).

```json
{
  "gen:api": "orval"
}
```

### Configuration

Create/update `orval.config.ts` in consumer root:

```typescript
import { defineConfig } from '@orval/core';

export default defineConfig({
  consumer: {
    input: {
      target: '../backend/shared/openapi.json', // Generated by backend
    },
    output: {
      target: './src/api/generated/consumerApi.ts',
      client: 'axios',
      httpClient: 'axios',
      mode: 'tags-split', // One file per OpenAPI tag
    },
  },
});
```

### Generation

```bash
npm run gen:api
```

This generates typed Axios client functions for all `/api/consumer/*` endpoints.

### Usage

```typescript
// services/catalog.service.ts
import { getApiConsumerCinemasIdCategoriesGet } from '@/api/generated/consumerApi';

export async function fetchCinemaCategories(cinemaId: number) {
  const { data } = await getApiConsumerCinemasIdCategoriesGet(cinemaId);
  return data;
}
```

### Important Notes

- Regenerate whenever backend OpenAPI changes
- Commit generated files (so CI doesn't need to run generation)
- Never manually edit generated files
- Types are derived from OpenAPI schema

---

## 21. Performance Requirements

### Goals

- **First contentful paint**: < 2 seconds on 4G
- **Total bundle size**: < 150kb (gzipped)
- **Time to interactive**: < 3 seconds
- **Image load time**: < 1 second for product images

### Optimization Strategies

#### JavaScript

- **Lazy route loading**: Split chunks per route
- **Tree-shake dependencies**: Ensure only used code is bundled
- **Avoid duplicates**: Check for double-bundled dependencies
- **Minification**: Vite handles this by default

#### Images

- **Responsive images**: Provide multiple sizes (2x, 3x for high-DPI)
- **Format**: Use WebP with PNG fallback for product images
- **Lazy loading**: `loading="lazy"` on product grid images
- **Banner optimization**: Compress banners, possibly use `<picture>` element
- **No large hero images**: Keep screensaver SVG or small optimized image

#### Network

- **API pagination**: Fetch products in batches (limit: 20–50)
- **Cache categories**: Store in localStorage for session
- **Defer non-critical**: Load banners after initial product grid
- **Compression**: Ensure gzip/brotli on backend responses

#### Rendering

- **Virtual scrolling**: Consider for large product lists (optional, nice-to-have)
- **Avoid layout shift**: Use aspect-ratio CSS for product cards
- **Minimal animations**: No heavy parallax or 60fps effects
- **Inline critical CSS**: Critical path CSS in `<style>` tag in HTML head

### Bundling

```bash
npm run build
# Check bundle size:
# → Should be ~100-150kb gzipped for JS + CSS
```

---

## 22. Accessibility / Touch Requirements

### Touch Targets

- Minimum 44px × 44px (iOS guideline)
- Minimum 48px × 48px (Android guideline)
- Buttons, links, category tabs all ≥ 48px height
- Spacing between targets ≥ 8px

### Mobile-First Interactions

- **No hover-only affordances**: All hover states must have visible active/focus states
- **Focus indicators**: Tab-navigable on all interactive elements (keyboard support)
- **Large text**: Body text ≥ 16px on mobile
- **High contrast**: Text on background ≥ 4.5:1 (WCAG AA)
- **Icon + text labels**: Never icon-only for buttons/tabs

### Screen Reader Support

- Semantic HTML: `<button>`, `<a>`, `<form>`, `<label>` tags
- ARIA labels where needed: `aria-label="Add Popcorn to cart"` on icon buttons
- Form fields: `<label htmlFor="mobile">` paired with `<input id="mobile" />`
- Images: `alt="Popcorn large image"` on product images (descriptive, not "image" or "")

### Landscape / Tablet

- Product grid may shift to 3 columns on wider screens (CSS media queries)
- Sticky cart button repositioned for landscape if needed
- Checkout form may show side-by-side (form + summary)

### Safe Areas (Notch Support)

```scss
// In global.scss or relevant component:
header {
  padding-top: max(12px, env(safe-area-inset-top));
  padding-left: max(12px, env(safe-area-inset-left));
  padding-right: max(12px, env(safe-area-inset-right));
}

.sticky-bottom {
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
```

---

## 23. Error Handling

### API Error Responses

Backend returns structured errors:

```json
{
  "success": false,
  "code": "PRODUCT_UNAVAILABLE",
  "message": "This product is not available at this cinema",
  "statusCode": 409
}
```

### Frontend Error Mapping

```typescript
// utils/errors.ts
export function formatApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const message = error.response?.data?.message;

    switch (status) {
      case 400:
        return message || 'Please check your input and try again';
      case 404:
        return 'Item not found';
      case 409:
        return message || 'This action cannot be completed right now';
      case 500:
        return 'Server error. Please try again later';
      default:
        return 'Something went wrong';
    }
  }
  return 'An unexpected error occurred';
}
```

### User-Facing Error Messages

- **Validation errors**: Show field-level errors in form (red text, icon)
- **Product unavailable**: Toast or banner: "This product is no longer available"
- **Payment failed**: Prominent error on payment page, option to retry
- **Network error**: "Connection lost. Please check your internet and try again"
- **Order creation failure**: "Order could not be placed. Try again or contact support"

### Logging

- Error tracking (optional): Sentry, Datadog, or similar
- Development: Console errors for debugging
- Production: Silent failures with user-friendly messages (don't expose stack traces)

---

## 24. Loading States

### Skeleton Screens (Nice-to-Have)

- Product grid: Show shimmer placeholder skeletons while fetching
- Category list: Skeleton pills while loading
- Banner: Gray placeholder image while loading

### Spinners / Loading Indicators

- Checkout form submission: Show spinner on "Confirm and Pay" button
- Payment: Show "Initializing Razorpay..." message
- Cart drawer open: Show loading state if fetching order summary

### Progressive Enhancement

- Render without cart data first
- Fetch cart summary in background
- Update UI when available (no re-render, smooth UX)

---

## 25. Empty States

### Cart Empty

- Message: "Your cart is empty"
- CTA: "Browse products" button to return to catalog

### No Products in Category

- Message: "No products available in this category"
- CTA: "Browse all products" or "Try another category"

### No Banners

- Graceful fallback: Don't show banner section if empty
- No error state needed

### Search No Results

- Message: "No products match your search"
- Show search term: "No results for 'xyz'"
- CTA: "Clear search" or "Browse categories"

---

## 26. Backend Gaps / Required Backend Work

### Critical APIs Missing

1. **`POST /api/consumer/orders`** (CRITICAL)
   - Unauthenticated order creation
   - Location: Create new file `backend/src/routes/consumer.routes.js`
   - Requires: Order validation, inventory checks, Razorpay order ID generation

2. **`POST /api/consumer/orders/{orderId}/payment-verify`** (CRITICAL)
   - Razorpay payment signature verification
   - Update order paymentStatus to "paid" on success
   - Requires: Razorpay KEY_SECRET from PaymentGatewayConfig

3. **`GET /api/consumer/cinemas/{id}`** (HIGH)
   - Validate cinema exists and is active (no auth)
   - Location: New unauthenticated endpoint

4. **`GET /api/consumer/cinemas/{cinemaId}/categories`** (HIGH)
   - List categories for a cinema
   - Join with CinemaProduct to filter by cinema
   - No auth required

5. **`GET /api/consumer/cinemas/{cinemaId}/products`** (HIGH)
   - List products available at a cinema (paginated, searchable)
   - Join Product + CinemaProduct + ProductPricing
   - Filter by availability date/time and active status
   - No auth required

6. **`GET /api/consumer/cinemas/{cinemaId}/products/{id}`** (HIGH)
   - Get single product detail with current pricing
   - No auth required

7. **`GET /api/consumer/cinemas/{cinemaId}/banners`** (HIGH)
   - List banners by type (H = header, I = inner)
   - Filter by cinema, active status, date validity
   - No auth required

8. **`GET /api/consumer/cinemas/{cinemaId}/screens/{id}`** (MEDIUM)
   - Validate screen exists and belongs to cinema
   - No auth required

### Razorpay Integration

- [ ] Fetch Razorpay API KEY_ID and KEY_SECRET from PaymentGatewayConfig
- [ ] Validate PaymentGatewayConfig exists for ordering cinema
- [ ] Generate Razorpay order ID in POST /api/consumer/orders
- [ ] Verify Razorpay payment signature in POST /api/consumer/orders/{id}/payment-verify
- [ ] Store razorpay_payment_id and razorpay_signature on order row
- [ ] Update order paymentStatus to "paid" after verification
- [ ] Handle payment failures gracefully (order stays in "pending" state)

### Database Schema Considerations

- Order schema must support consumer order metadata (source, customer phone/email snapshot)
- PaymentGatewayConfig encryption/decryption for API credentials
- No changes required; existing schema sufficient

### Security Considerations

- Unauthenticated endpoints must enforce business rules (cinema/product/pricing validation)
- Rate limiting on POST /api/consumer/orders (prevent spam)
- Razorpay signature verification (prevent fake payments)
- No sensitive data in responses (no staff user info, no internal audit logs)

---

## 27. Security Requirements

### API Security

- **Rate limiting**: Limit unauthenticated order creation (e.g., 10 requests per IP per minute)
- **CSRF**: Use CSRF tokens if session-based (probably not needed for this flow)
- **Input validation**: Server-side validation on all fields (never trust frontend)
- **SQL injection**: Use parameterized queries (Sequelize handles this)

### Data Security

- **No passwords**: No authentication required (customers are anonymous)
- **Encrypt sensitive data**: PaymentGatewayConfig stores encrypted secrets
- **Razorpay secrets**: KEY_SECRET never exposed to frontend
- **Order data**: Customer phone/email optional, never required (can be null)

### Frontend Security

- **No hardcoded secrets**: Razorpay KEY_ID fetched from backend (not embedded in code)
- **HTTPS only**: All API calls over HTTPS (enforced by backend)
- **Content Security Policy**: Define CSP header to prevent XSS
- **Dependency scanning**: Regular npm audit, keep dependencies up-to-date

### PCI Compliance

- **No credit card storage**: Razorpay handles all card data (PCI-compliant)
- **No card data in logs**: Never log payment details
- **HTTPS on checkout**: Razorpay iframe enforced over HTTPS

---

## 28. Future Scope (Out of Scope for Phase 1)

These are NOT part of the current implementation plan:

- [ ] Order history / tracking for customers
- [ ] Customer loyalty programs or vouchers
- [ ] Coupon codes (discount application at checkout)
- [ ] Addon selection UI (backend has addon model; frontend TBD)
- [ ] Multiple payment methods (Razorpay UPI/wallet/etc. are supported by Razorpay; not custom)
- [ ] Order modifications after placement
- [ ] Delivery address input (cinema-based only in Phase 1)
- [ ] Multi-cinema selection (QR pre-identifies cinema)
- [ ] Language localization
- [ ] Accessibility audit (WCAG compliance nice-to-have but not primary)
- [ ] Offline mode / service workers
- [ ] E-gift / voucher sales
- [ ] Subscription or recurring orders
- [ ] Live order status push notifications to customer
- [ ] Staff integration in consumer app (separate dashboard)

---

## 29. API Contract Summary (Single-Table Reference)

| Purpose | Method | Endpoint | Auth | Priority | Backend Source | Frontend Use |
|---------|--------|----------|------|----------|-----------------|--------------|
| Get cinema | GET | `/api/consumer/cinemas/{id}` | None | HIGH | NEW | Validate QR params |
| List categories | GET | `/api/consumer/cinemas/{cinemaId}/categories` | None | HIGH | NEW | Browse by category |
| List products | GET | `/api/consumer/cinemas/{cinemaId}/products` | None | HIGH | NEW | Display product grid |
| Get product | GET | `/api/consumer/cinemas/{cinemaId}/products/{id}` | None | HIGH | NEW | Product detail view |
| List banners | GET | `/api/consumer/cinemas/{cinemaId}/banners` | None | HIGH | NEW | Display promo banners |
| Get screen | GET | `/api/consumer/cinemas/{cinemaId}/screens/{id}` | None | MEDIUM | NEW | Validate screen in QR |
| Create order | POST | `/api/consumer/orders` | None | **CRITICAL** | NEW | Place order after checkout |
| Verify payment | POST | `/api/consumer/orders/{orderId}/payment-verify` | None | **CRITICAL** | NEW | Confirm Razorpay payment |

---

## 30. Development Workflow

### Before Implementing

1. Read this README (you're here!)
2. Inspect backend OpenAPI spec: `backend/shared/openapi.json`
3. Review existing order/product/category schemas in backend
4. Confirm PaymentGatewayConfig encryption/decryption approach
5. Confirm QR parameter contract with product team (if different from proposed section 9)

### Phase 1: Backend Consumer APIs

- [ ] Create unauthenticated order creation endpoint
- [ ] Create unauthenticated product catalog endpoints
- [ ] Implement Razorpay payment initialization and verification
- [ ] Update OpenAPI spec
- [ ] Test with real SQL Server and Razorpay sandbox

### Phase 2: Frontend Foundation

- [ ] Set up directory structure (see section 17)
- [ ] Configure Orval, run code generation
- [ ] Set up Zustand stores (cart, context, ui)
- [ ] Build Screensaver page
- [ ] Build Catalog page (categories, product grid, banners)

### Phase 3: Checkout & Payment

- [ ] Build Checkout page (customer info form)
- [ ] Integrate Razorpay payment
- [ ] Build Confirmation page
- [ ] Error handling and validation
- [ ] Test end-to-end order flow

### Phase 4: Polish & Testing

- [ ] Responsive design (mobile, tablet, kiosk)
- [ ] Performance optimization (bundle size, image loading)
- [ ] Accessibility review (touch targets, focus states)
- [ ] Manual testing on real devices (iPhone, Android, kiosk)
- [ ] QA and bug fixes

---

## 31. Closing Principles

### Keep It Simple

This app has ONE job: help customers order food at a cinema. Every feature, every component, every API call should serve that goal.

- ❌ No complex state machines (just cart + order flow)
- ❌ No unnecessary abstraction (build what's needed, not what might be needed)
- ❌ No heavy UI frameworks (custom Sass is fine)
- ✅ Focus on UX: fast, clear, touch-friendly

### Server-Side Truth

The backend is authoritative. Frontend displays; backend validates, calculates, and stores.

- ✅ Pricing calculated server-side (never trust frontend math)
- ✅ Availability checked server-side (never assume stock)
- ✅ Payment verified server-side (never trust signature from client)
- ✅ Permissions/scoping server-side (never trust frontend role)

### Mobile First

Design for 360px width first. Everything else is a bonus.

- ✅ Single column product grid
- ✅ Portrait orientation primary
- ✅ Large touch targets
- ✅ Minimal horizontal scrolling
- ✅ Sticky controls at bottom

### User Perspective

The customer is scanning a QR code at a cinema seat during a movie. They have 2 minutes to order. What matters?

1. Is the app loaded? (Yes → show screensaver)
2. What can I order? (Show products, categories, prices)
3. How much is it? (Show total)
4. How do I pay? (Razorpay checkout)
5. Is my order placed? (Confirmation, done)

Everything else is noise.

---

## Appendix: File Locations Reference

**Backend APIs (staff-only, authenticated):**
- Orders: `backend/src/routes/order.routes.js`
- Products: `backend/src/routes/product.routes.js`
- Categories: `backend/src/routes/category.routes.js`
- Pricing: `backend/src/routes/pricing.routes.js`
- Banners: `backend/src/routes/banner.routes.js`
- Cinema Products: `backend/src/routes/cinemaproduct.routes.js`
- Availability: `backend/src/routes/availability.routes.js`
- Cinemas: `backend/src/routes/cinema.routes.js`
- Screens: `backend/src/routes/screen.routes.js`

**Backend Models:**
- Order: `backend/models/order.js`
- PaymentGatewayConfig: `backend/models/paymentgatewayconfig.js`
- Product: `backend/models/product.js`
- Cinema: `backend/models/cinema.js`

**Backend OpenAPI:**
- Spec: `backend/shared/openapi.json`
- Generation: `backend/scripts/generate-openapi.js`

**Frontend Entry:**
- Consumer package: `consumer/package.json`
- HTML: `consumer/index.html`
- Main: `consumer/src/main.tsx`

---

**This README is the source of truth for consumer app implementation. Update it when contracts change, when architectural decisions are made, or when scope is clarified.**

**Last Updated:** 2026-08-12
