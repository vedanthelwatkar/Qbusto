# QBusto Database Architecture

## 1. Overview

QBusto is a cinema food ordering system. Customers scan a QR code at their seat or in the lobby, browse a menu, place an order, pay via Razorpay, and the kitchen prepares and delivers the food.

The database supports four applications:

- **Consumer** - customer-facing ordering website
- **Dashboard** - cinema/chain management panel
- **Kitchen** - kitchen display system (KDS)
- **Backend** - Node.js API serving all three frontends

The schema supports multiple cinema chains (multi-tenant), each operating independent cinema locations with their own screens, menu availability, pricing, and POS integrations.

---

## 2. Core Concepts

### Chain → Cinema → Screen

A **chain** is the top-level business entity (e.g., "Miraj Cinemas"). A chain operates multiple **cinemas** (physical locations). Each cinema has multiple **screens** (auditoriums where films are shown).

```
Miraj Cinemas (chain)
├── Miraj Cinemas Wadala (cinema, code "1074")
│   ├── Screen 1
│   ├── Screen 2
│   └── IMAX
├── Miraj Cinemas Gurdaspur (cinema, code "1038")
│   ├── Screen 1
│   └── Screen 2
└── ...50+ more locations
```

Every cinema has a unique `code` field (e.g., "1074") owned by QBusto. This code is used in QR URLs and display. It is distinct from the external POS cinema identifier, which lives on the POS integration configuration.

### Categories → Products (Chain-Scoped)

**Categories** are chain-scoped food groupings. Each chain manages its own set of categories:

- ALL TIME FAVOURITES
- SANDWICHES & BURGERS
- PIZZERIA & FRIES
- MOCKTAILS & SHAKES
- COMBOS

**Products** are individual menu items that belong to exactly one category within the same chain:

```
Category: ALL TIME FAVOURITES
├── MEGA SALTED POPCORN (200gm)
├── MEGA CHEESE POPCORN (200gm)
├── COKE 850 ML
├── THUMSUP 850 ML
└── SPRITE 850 ML
```

Both categories and products carry a `chain_id` FK, ensuring each chain has a completely independent catalog.

### Cinema Availability (Junction Tables)

Not every cinema sells every category or product. Two junction tables control availability:

**cinema_categories** - which categories appear at which cinema, and in what display order.

**cinema_products** - which products are available at which cinema and their display order.

POS item codes (e.g., Vista's "I000001624") are NOT stored on `cinema_products`. They live in the POS integration layer (`product_pos_mappings`) because POS identity is separate from product availability.

### Pricing

**product_pricing** - the price of a product at a specific cinema, optionally varying by day of the week:

```
Cinema "Wadala" + COKE 850 ML + day 0 (default) → base_price ₹420
Cinema "Wadala" + MEGA POPCORN + day 5 (Friday) → base_price ₹450 (weekend pricing)
```

Day-of-week values: 0 = default/all days, 1 = Monday ... 7 = Sunday.

Backend checks for day-specific price first, falls back to `day_of_week = 0`.

Pricing supports optional discounts (`discount_type` + `discount_value`). Selling price is always calculated in code, never stored.

### Source Discounts (Deferred - not in V1)

The legacy system offered per-channel discounts (5% off for QR orders, etc.). This feature is deferred from V1. The `source_discounts` table design exists in the deferred features section of `schema.md` but will not be implemented until client confirms it's needed.

---

## 3. Orders

### Order Lifecycle

An order represents a customer's food purchase at a cinema during a film screening.

```
Customer scans QR at seat D-16, Screen 1, Cinema "Wadala"
    ↓
Browses menu, adds COKE 850 ML (×1) and MEGA CHEESE POPCORN (×1)
    ↓
Order created: status=initiated, payment_status=pending
    ↓
Customer pays via Razorpay
    ↓
Payment confirmed: status=confirmed, payment_status=paid
    ↓
Kitchen sees the order on KDS
    ↓
Kitchen starts: status=preparing
    ↓
Kitchen finishes: status=ready
    ↓
Staff delivers to seat: status=delivered, delivered_at=now
```

### Two Independent State Machines

The order has two status dimensions tracked via master tables:

**Order status** (`order_statuses` master table - kitchen/operational lifecycle):

```
initiated → confirmed → preparing → ready → delivered
                ↓
             rejected
```

**Payment status** (`payment_statuses` master table - financial lifecycle):

```
pending → paid
    ↓       ↓
  failed  refunded
```

These are independent. An order can be:

- `status=delivered` + `payment_status=paid` (normal happy path)
- `status=rejected` + `payment_status=refunded` (order rejected, money returned)
- `status=confirmed` + `payment_status=paid` (paid but kitchen hasn't started yet)

### Status Master Tables

Both `order_statuses` and `payment_statuses` use the same pattern:

- `code` - stable machine-readable identifier (e.g., `'confirmed'`). Application logic depends on this.
- `name` - display-friendly label (e.g., "Ready for Pickup"). Can change without breaking logic.
- `id` - database identity only. NEVER hardcoded in application logic.

At application startup, the backend loads status tables into memory as a `{ code → id }` map. This avoids per-request lookups while remaining portable across environments.

### Status Transition History

Every status change is logged in audit tables:

**order_status_logs** - records each operational status transition:

```
Order #1003769:
  initiated → confirmed (system, payment verified)
  confirmed → preparing (user: kitchen_staff_42)
  preparing → ready (user: kitchen_staff_42)
  ready → delivered (user: kitchen_staff_42)
```

**payment_status_logs** - records each payment state transition:

```
Order #1003769:
  pending → paid (system, razorpay_payment_id: pay_ABC123)
```

Key properties:

- `previous_status_id` is NULL for the first entry (order creation)
- `changed_by_user_id` is NULL for system-generated transitions
- Status change + log insert happen in the SAME database transaction (prevents state/history divergence)

### Order Context

Each order captures display-level context at the time of ordering:

- **screen_id** - which screen/auditorium the customer is in
- **seat_number** - e.g., "D-16", "B-10"
- **film_title** - what movie is playing (display snapshot)
- **show_time** - when the screening starts (display snapshot)
- **source** - how the order was placed: `qr`, `seat_qr`, `kiosk`, or `counter`

External POS identifiers (Vista session IDs, Showbizz booking IDs, film codes) are stored separately in `order_pos_context`, not on the orders table.

### Order Items (Snapshots)

Each order contains one or more **order_items**. These store snapshots of the product at the time of purchase:

```
Order #1003769:
├── COKE 850 ML × 1 @ ₹420 - ₹21 discount = ₹399
└── MEGA CHEESE POPCORN × 1 @ ₹390 - ₹0 discount = ₹390
                                              Total: ₹789
```

Why snapshots? If "COKE 850 ML" is later renamed or repriced, historical orders must still show exactly what the customer purchased at the original price. The `product_name`, `unit_price`, and `discount` on each order item are frozen at the time of ordering.

Each order item also snapshots `pos_item_id` - the external POS code resolved at order time.

---

## 4. Users & Roles

Users are staff members who access the dashboard or kitchen display. Customers do not have accounts.

Every user belongs to a **chain** and optionally to a specific **cinema**:

```
owner          → manages the entire chain, cinema_id is NULL
chain_admin    → manages chain-wide operations, cinema_id is NULL
cinema_admin   → manages a specific cinema location
kitchen_staff  → operates the KDS at a specific cinema
```

The backend validates that a user's `cinema_id` belongs to their `chain_id`.

---

## 5. Banners

Banners are promotional images displayed in the consumer app, scoped per cinema. The `type` field (H/I) is kept for legacy compatibility; meanings are unconfirmed.

---

## 6. POS Integration Layer

QBusto integrates with external Point-of-Sale systems to post food sales to the cinema's ticketing infrastructure. The system supports multiple POS providers (Vista, Showbizz Central POS, future providers) through a provider-neutral adapter architecture.

### Design Principles

1. **Domain tables stay provider-neutral** - no Vista or Showbizz fields on `orders`, `products`, etc.
2. **POS identity is separate from availability** - a product being "sold at cinema X" is different from "what's its POS code?"
3. **One active POS per cinema** - enforced by a filtered unique index
4. **Credentials never in DB** - secrets live in environment variables or an external secrets manager
5. **POS operation audit log** - every POS API call is logged with request/response payloads (retries update the existing row)

### pos_integrations

Each cinema can be configured with one or more POS providers, but only ONE can be active at a time:

```
Cinema "Wadala":
  provider: "vista"
  external_cinema_id: "1074"     (Vista's Cinema_strID)
  is_active: true
  credential_ref: null           (uses env vars for Vista)
  config: {"timeout_ms": 30000}

Cinema "Gurdaspur":
  provider: "showbizz"
  external_cinema_id: "TH-1038"  (Showbizz's TheatreId)
  is_active: true
  credential_ref: "pos/showbizz/cinema-1038"
  config: {"api_base_url": "https://...", "transaction_type": "InCinemaFB"}
```

### screen_pos_mappings

Maps QBusto screens to the POS provider's screen/auditorium identifiers. Only needed for providers whose API requires screen IDs.

### product_pos_mappings

Maps QBusto products to the POS provider's item identifiers. Replaces the old `cinema_products.master_item_code` field.

### order_pos_context

Created once at order time and never modified. Stores external show/session identifiers needed for POS API calls. Orders without POS integration simply don't have this row.

### pos_transactions

Every POS API call is logged as a transaction record with idempotency key, status, payloads.

**Operations**: `book_items` (reserve items), `buy_item` (confirm purchase), `post_sale` (Vista equivalent), `cancel`, `refund`.

**Statuses** (remain as varchar - NOT a master table):

- `pending` - about to send or in-flight
- `success` - POS confirmed it processed the request
- `failed` - POS explicitly rejected (safe to retry)
- `unknown` - ambiguous outcome (network timeout, connection lost)

POS transaction statuses are integration/implementation states, not configurable business lifecycles. They do not need master tables.

---

## 7. Multi-Tenancy

QBusto is designed for multiple cinema chains operating independently on the same platform.

### How isolation works

- **Chain level**: `categories` and `products` have `chain_id` FK - each chain owns its catalog entirely.
- **Cinema level**: `cinemas` has `chain_id` FK - each cinema belongs to one chain.
- **Inherited**: screens, orders, banners, POS integrations all inherit chain scope through their parent cinema.
- **Global**: `order_statuses` and `payment_statuses` are system-wide tables shared across all chains (same lifecycle for all).
- **Junction tables**: `cinema_categories` and `cinema_products` link cinemas to categories/products. Application code validates both sides belong to the same chain.

### What's enforced where

| Enforcement                       | Where              |
| --------------------------------- | ------------------ |
| Category/product belongs to chain | DB (`chain_id` FK) |
| Cinema belongs to chain           | DB (`chain_id` FK) |
| User belongs to chain             | DB (`chain_id` FK) |
| Cinema ↔ category same chain      | Application code   |
| Cinema ↔ product same chain       | Application code   |
| User ↔ cinema same chain          | Application code   |

---

## 8. How the Consumer App Queries Data

When a customer scans a QR code at Cinema "Wadala" (code "1074"):

1. **Load categories**: Query `cinema_categories` where `cinema_id` matches and `is_active = 1`, ordered by `sequence`. Join to `categories` for names/images.

2. **Load products per category**: Query `cinema_products` where `cinema_id` matches and `is_active = 1`, joined to `products` where `category_id` matches. Ordered by `sequence`.

3. **Load prices**: For each product, query `product_pricing` where `cinema_id` and `product_id` match. First try `day_of_week = today's day number`, then fall back to `day_of_week = 0`.

4. **Place order**: Create an `orders` row with cinema context (screen, seat, film display info) and `order_items` rows with snapshot pricing and `pos_item_id`. Set `status_id` to the cached ID for `'initiated'`, `payment_status_id` to the cached ID for `'pending'`. Insert first `order_status_logs` and `payment_status_logs` entries.

5. **POS + Payment** (provider-specific sequencing):

   **Showbizz flow** (reserve → pay → confirm):
   - Create `order_pos_context`
   - `BookItems` via `pos_transactions` (operation `book_items`) - reserves items before payment
   - Customer pays via Razorpay
   - Verify signature, update `payment_status_id` → `paid`, log transition
   - `BuyItem` via `pos_transactions` (operation `buy_item`) - confirms the sale
   - Update `status_id` → `confirmed`, log transition

   **Vista flow** (pay → post):
   - Customer pays via Razorpay
   - Verify signature, update `payment_status_id` → `paid` + `status_id` → `confirmed`, log both transitions
   - Create `order_pos_context`
   - `post_sale` via `pos_transactions` - posts the completed sale

   **No active POS** (standalone):
   - Customer pays via Razorpay
   - Verify signature, update `payment_status_id` → `paid` + `status_id` → `confirmed`, log both transitions
   - No POS interaction

   In all cases: POS failure does NOT affect `payment_status_id` - the order remains paid regardless.

---

## 9. How the Kitchen Display Queries Data

The KDS at Cinema "Wadala" polls the backend:

```sql
SELECT o.*
FROM orders o
WHERE o.cinema_id = ?
  AND o.status_id IN (@confirmed_id, @preparing_id, @ready_id)
ORDER BY o.created_at ASC
```

The application caches the numeric IDs for `confirmed`, `preparing`, and `ready` at startup (from `order_statuses WHERE code IN (...)`). This avoids a JOIN and uses the composite index `orders(cinema_id, status_id, created_at)` directly.

Kitchen staff can then:

- Mark an order as `preparing` (started cooking) → logs `confirmed → preparing`
- Mark an order as `ready` (food prepared) → logs `preparing → ready`
- Mark an order as `delivered` (food handed to customer) → logs `ready → delivered`

Each status change inserts into `order_status_logs` with `changed_by_user_id` set to the kitchen staff user.

---

## 10. How the Dashboard Works

The dashboard is used by chain admins and cinema admins to:

- **Manage categories**: Create/edit chain-owned categories, assign them to cinemas via `cinema_categories`
- **Manage products**: Create/edit chain-owned products, assign them to cinemas via `cinema_products`
- **Set pricing**: Configure base prices and day-of-week overrides via `product_pricing`
- **Manage POS**: Configure POS integrations, map screens and products to external POS identifiers
- **Manage orders**: View order history, view status transition logs, handle refunds, monitor POS transaction status
- **Manage users**: Create staff accounts, assign roles
- **Manage banners**: Upload promotional images per cinema

---

## 11. Relationship Diagram

```
order_statuses (system-global)
  ├── orders.status_id
  ├── order_status_logs.previous_status_id
  └── order_status_logs.new_status_id

payment_statuses (system-global)
  ├── orders.payment_status_id
  ├── payment_status_logs.previous_status_id
  └── payment_status_logs.new_status_id

chains
  ├── cinemas
  │    ├── screens
  │    ├── cinema_categories → categories (chain-owned)
  │    ├── cinema_products → products (chain-owned)
  │    ├── product_pricing → products
  │    │    (source_discounts deferred from V1)
  │    ├── orders
  │    │    ├── order_items → products
  │    │    ├── order_status_logs → order_statuses, users
  │    │    ├── payment_status_logs → payment_statuses, users
  │    │    ├── order_pos_context → pos_integrations
  │    │    └── pos_transactions → pos_integrations
  │    ├── users
  │    ├── banners
  │    └── pos_integrations
  │         ├── screen_pos_mappings → screens
  │         └── product_pos_mappings → products
  ├── categories
  └── products
       ├── category_id → categories
       └── addon_parent_id → products (self)
```

---

## 12. Table Count Summary

| Table                | Purpose                         | Rows (expected scale)                  |
| -------------------- | ------------------------------- | -------------------------------------- |
| chains               | Business entities               | 1-5                                    |
| cinemas              | Physical locations              | 50-200                                 |
| screens              | Auditoriums                     | 200-800                                |
| categories           | Menu groupings (per chain)      | 20-50                                  |
| cinema_categories    | Category/cinema assignment      | 500-2000                               |
| products             | Food/drink items (per chain)    | 100-500                                |
| cinema_products      | Product/cinema assignment       | 5000-25000                             |
| product_pricing      | Prices per cinema/product/day   | 5000-50000                             |
| order_statuses       | Order lifecycle states          | 6 (seeded)                             |
| payment_statuses     | Payment lifecycle states        | 4 (seeded)                             |
| orders               | Customer purchases              | Grows continuously (millions)          |
| order_items          | Items within orders             | Grows continuously                     |
| order_status_logs    | Order status audit trail        | Grows with orders (multiple per order) |
| payment_status_logs  | Payment status audit trail      | Grows with orders (1-2 per order)      |
| users                | Staff accounts                  | 100-500                                |
| banners              | Promotional images              | 100-500                                |
| pos_integrations     | POS provider configs per cinema | 50-200                                 |
| screen_pos_mappings  | Screen ↔ POS screen links       | 200-800                                |
| product_pos_mappings | Product ↔ POS item links        | 5000-25000                             |
| order_pos_context    | External POS context per order  | Grows with orders                      |
| pos_transactions     | POS API audit log               | Grows with orders                      |

---

## 13. Key Design Decisions

### Why master tables for order/payment statuses?

Status codes represent important business lifecycles with:

- Display names that may be customized (e.g., "Ready" → "Ready for Pickup")
- Descriptions for documentation/UI
- Transition history (audit trail)
- Potential for reporting queries

Other enums (order source, POS provider, discount type, roles) do NOT get master tables - they are stable, rarely displayed, and don't need transition history.

### Why `code` not `id` for application logic?

Numeric IDs are database identities and may differ between environments (dev/staging/prod). Application logic depends on the stable `code` field (e.g., `statusMap['confirmed']`) loaded at startup. This makes migrations/seeding portable.

### Why status transition logs?

Enables: "When did this order move to preparing?", "Who marked it delivered?", "How long did the kitchen take?" Without logs, only the current state is known. The logs also serve as an audit trail for disputed orders.

### Why separate availability from pricing?

A product being **available** at a cinema (`cinema_products.is_active`) is different from having a **price** there (`product_pricing`). You might temporarily disable a product without deleting its pricing.

### Why separate POS identity from availability?

Whether a product is sold at a cinema (availability) is a different concern from what POS code it uses (POS identity). The same cinema could switch from Vista to Showbizz without touching `cinema_products`.

### Why snapshot data on order items?

Products get renamed, repriced, or discontinued. Historical orders must still display exactly what was purchased at the original price.

### Why no selling_price column?

Computing the selling price in code gives exactly one source of truth (`base_price` minus discount).

### Why no customer accounts?

QBusto is designed for one-shot cinema orders. No order history, no saved preferences, no loyalty points.

### Why `unknown` instead of `timeout` for POS transactions?

A timeout is just one cause of an ambiguous outcome. `unknown` makes the semantics clear: we don't know what happened, and retry safety depends on provider guarantees.

### Why chain_id on both categories and products?

Creates a hard ownership boundary at the DB level. Junction tables provide cinema-level visibility; `chain_id` provides chain-level ownership isolation.

### Why NOT master tables for everything?

Order source, POS provider, POS transaction status, POS operation, discount type, banner type, and roles remain application-controlled stable values. They don't represent configurable business lifecycles, don't need display names or descriptions, and don't need transition history. Lookup-table overengineering adds complexity without benefit.

---

## 14. Legacy System Context

QBusto replaces a legacy system called **Vista PopExpress** running on SQL Server. The legacy database had:

- A `DAE_OrderStatus` table with ~9 status rows - QBusto modernizes this with `order_statuses` (stable `code` + display `name` + audit history). The useful part (configurable display names, reportable states) is preserved while improving it (machine-readable codes, transition history).
- Day-of-week pricing spread across 28+ columns per row
- Per-source discounts as individual columns (deferred from V1)
- No foreign key enforcement between most tables
- Vista ticketing system integration (session IDs, film codes, POS item codes)

QBusto normalizes all of this into a clean relational schema. Vista-specific identifiers have been moved to the POS integration layer, making domain tables provider-neutral.
