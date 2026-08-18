# QBusto Database Architecture

## 1. Overview

QBusto is a cinema food ordering system. Customers scan a QR code, browse the menu, place an order, pay, and the kitchen prepares the food for delivery.

The database supports four applications:

- Consumer - customer-facing ordering website
- Dashboard - cinema and chain management panel
- Kitchen - kitchen display system
- Backend - Node.js API serving all three frontends

The schema is multi-tenant. Chains own catalog data, cinemas belong to chains, and cinema-scoped tables keep each location's menu, pricing, POS setup, and notification settings separate.

---

## 2. Core design ideas

### Chain, cinema, and screen

A chain is the top-level business entity. A cinema belongs to one chain. A screen belongs to one cinema.

### Catalog ownership

Categories and products are chain-scoped. Cinema tables then decide which categories and products are available at a specific cinema.

### Audit-user fields

Many master and configuration tables now carry nullable `created_by` and `updated_by` fields that point to `users.id`.

These fields are used where they help explain who created or changed a configuration row. They are not added to every table, because some tables already have better lifecycle audit data, and some tables are history records where extra audit FKs would be redundant.

The important rule is that these audit links never remove business records if a user is deleted or deactivated.

### Legacy-friendly IDs and snapshots

Order data keeps operational snapshots like seat number, screen, film title, and show time. That lets Kitchen and reporting read the order directly even if upstream data changes later.

---

## 3. Cinema and catalog data

### Chain logo

`chains.logo_image_url` stores the chain logo image URL requested by the client.

### Cinema profile data

`cinemas` now also stores:

- `city`
- `gst_number`
- `fssai_number`
- `active_since`
- `sms_enabled`
- `whatsapp_enabled`

The GST and FSSAI values are strings, not numeric values, because they are identifiers, not quantities.

The SMS and WhatsApp flags are cinema-level preferences. A cinema may enable either channel, both, or neither.

### Banners

`banners` stays as one row per banner.

- `type` uses `H` for Header and `I` for Inner
- V1 uses Header banners only
- `sequence` controls display order
- `start_date` and `end_date` can bound when a banner is active

Banner rows are ordered by `sequence` and may optionally be bounded by `start_date` and `end_date`.

### Channel-specific product discounts

`product_pricing.discount_type` is the shared interpretation flag:

- `P` means Percentage
- `F` means Flat Amount

The client-requested channel columns now live directly on `product_pricing` as:

- `discount_on_qr`
- `discount_on_kiosk`
- `discount_on_seat_qr`
- `discount_on_counter`

### Cinema products

`cinema_products` is the link that says a cinema carries a product. It is a first-class resource, exposed at `/api/cinema-products`, because availability hours hang off its `id` rather than off a product directly.

The legacy system kept this link and its pricing together in `DAE_ItemCinemaPrice`. QBusto splits the two:

- the link, its display order and its date-range availability live in `cinema_products`
- per-day prices are normalized into `product_pricing`

That is why a `cinema_products` row carries no price columns.

The chain of ownership is:

```
Product
  -> CinemaProduct   (product carried at one cinema)
       -> ProductAvailabilityHour   (when it is orderable there)
```

A client turns a (cinema, product) pair into the `cinemaProductId` that availability needs by filtering the list endpoint on both ids. `(cinema_id, product_id)` is unique, so that filter returns one row or none.

`sequence` is the display order within a cinema. It is not unique - the legacy `DAE_ItemCinemaPrice.Sequence` was unconstrained and duplicates are ordinary.

### Product date ranges

`cinema_products.available_from` and `cinema_products.available_until` allow a cinema-specific product to be enabled only for a date range, such as a festival offer.

`cinema_products.is_active` remains the main enable or disable flag.

Where both bounds are set, the API requires `available_until` to be later than `available_from`. The database carries no CHECK for this, and the legacy table had only a `ToDate`, so the rule is enforced in the service layer.

### Product availability hours

Recurring weekly time windows are modeled in `product_availability_hours` instead of using one wide set of day columns.

That means the same product can have multiple windows on the same day, for example:

- Monday 10:00 to 13:00
- Monday 18:00 to 22:00

The day convention is:

- 0 = all days
- 1 = Monday
- 2 = Tuesday
- 3 = Wednesday
- 4 = Thursday
- 5 = Friday
- 6 = Saturday
- 7 = Sunday

Overnight windows are allowed conceptually. The schema does not block them with a `start_time < end_time` check, because that would prevent cases like 22:00 to 01:00. Any overlap validation is handled by application logic.

**The API is stricter than the schema here.** `/api/product-availability-hours` requires `startTime` to be earlier than `endTime`, so a 22:00 to 01:00 window is currently rejected with a 400 even though the table could store it. Representing one would mean splitting it into 22:00-23:59:59 and 00:00-01:00, or relaxing the validator. Do not describe overnight windows as supported until that is decided.

### How availability is evaluated

A cinema product is considered available only when all of these are true:

1. `cinema_products.is_active = 1`
2. `available_from`, if present, has already started
3. `available_until`, if present, has not passed
4. If `product_availability_hours` rows exist, at least one row matches the current day and time
5. If no hourly rows exist, there is no time-of-day restriction

This separates date-range availability from recurring time-of-day availability.

---

## 4. Orders and statuses

The order lifecycle still uses the existing master tables:

- `order_statuses`
- `payment_statuses`
- `order_status_logs`
- `payment_status_logs`

That architecture remains unchanged.

### SeatNo

The client's SeatNo request is already satisfied by `orders.seat_number`. The seat stays directly on the order so Kitchen and other flows can read it without extra mapping.

### POS booking ID

The client's POS_BookingId requirement is implemented by `order_pos_context.external_booking_id`.

That keeps the order provider-neutral while still capturing the committed external booking or order identifier from the POS system.

### SMS and WhatsApp delivery status

The client asked for one combined SMS/WhatsApp_Sent field, but the design keeps the channels separate because they are independent.

`orders` now stores:

- `sms_status`
- `whatsapp_status`

Each value may be `pending`, `success`, or `failed`. NULL means the channel was not applicable or was not enabled for that order.

No notification master table is created for these states, because they are small operational delivery states rather than business lifecycles.

### What stays unchanged

Order and payment status values still live in their master tables. The application should resolve statuses using stable status codes (for example, confirmed and paid) instead of hardcoding numeric IDs. The database continues to reference the master tables through foreign keys.

### Order creation idempotency (Phase 1 consumer API)

The consumer API (`POST /api/consumer/orders`) supports idempotent order creation via the `Idempotency-Key` header (UUID v4).

The `idempotency_keys` table maps each idempotency key to the order it created:

- `key` (UUID string, unique): The value from the `Idempotency-Key` request header
- `order_id`: Foreign key to the created order
- `created_at`, `updated_at`: Timestamps

The unique constraint on `key` prevents the database from accepting a duplicate key even if two requests arrive simultaneously, making the endpoint safely retry-able. If the frontend retries with the same key after a network failure, the backend returns the original order without creating a duplicate.

The consumer API requires the `Idempotency-Key` header on every order creation request. Missing the header returns a 400 validation error.

---

## 5. POS integration layer

The POS architecture remains provider-neutral.

### Supported providers

The documented provider values are now:

- `vista`
- `showbizz`
- `impact`
- `qbusto`

The display names may still be written in uppercase in user-facing text, but the database codes stay lowercase and stable.

### IS_Intigrated

The client's IS_Intigrated request is already covered by `pos_integrations.is_active`.

A separate `is_integrated` field is intentionally not added, because it would duplicate the same state and could create contradictory data.

### POS credentials

The existing POS credential pattern still uses `pos_integrations.credential_ref` as a pointer to external secret storage. The database does not store POS passwords or tokens in plaintext.

`pos_integrations.api_url` stores the provider endpoint.

### Shows

`shows` is the catalog of scheduled shows mirrored from the POS. The POS and show architecture is maintained separately by the development team.

It exists because every earlier representation of a show is a *consequence of an order*. `orders.film_title`, `orders.show_time` and `order_pos_context.external_session_id` are per-order snapshots created at checkout and immutable afterwards. None of them can answer "what is playing at this cinema in the next three hours", because a show with no orders would not exist anywhere. The consumer Show Time dropdown needs exactly that question answered, so a catalog table is required.

This mirrors, and deliberately corrects, the legacy design. PopExpress had no shows table either: `DAE_Orders` carried `Session_lngSessionId`, `Film_strTitle` and `Session_dtmRealShow` directly on the order row and read live session data from Vista at selection time. QBusto keeps the per-order snapshot, which is correct for history, and adds the catalog half that the legacy schema never had.

The natural key is `(pos_integration_id, external_session_id)`. Synchronization is an upsert on that pair, so the unique index is what prevents duplicates rather than any application-side check-then-write. The same pair is already stored per order on `order_pos_context`, which means an order can be joined back to its show on a unique key without adding a `show_id` column to the frozen `orders` table.

`shows` follows the machine-written conventions rather than the master-data ones:

- No `created_by` / `updated_by`, because the POS sync writes these rows, not a user. This matches `order_pos_context` and `pos_transactions`.
- No `is_active`. Soft delete is a staff-managed master-data convention, and these rows mirror external state. Lifecycle is `status` (`scheduled` / `cancelled`) plus `last_synced_at`.
- `screen_id` is nullable, because a show can arrive before its external screen has been mapped. The alternative — refusing or hiding such shows — would silently lose them. The raw `external_screen_id` is kept so the mapping can be resolved later.

`show_time` stores a UTC instant. The POS supplies cinema-local wall clock; converting it is the synchronization service's job (Phase B5), done in one place so the Vista and Showbiz adapters cannot drift apart. Provider adapters return wall clock and never convert.

### User permissions

User access is controlled by `user_permissions` instead of a module master table or user groups.

The permissions table stores `module_name` directly as a string instead of a numeric lookup value. That makes the database easier to read in SQL, easier to debug, easier to report on, and easier for client administrators and DBAs to inspect without any frontend lookup layer.

The application uses the same string values in both frontend and backend, so no modules master table is needed.

`users.role` still captures the business identity of the person:

- owner
- chain_admin
- cinema_admin
- kitchen_staff
- cinema_accountant

Module-level access is then granted per user through `user_permissions` rows keyed by `module_name`.

Supported module names are:

- Dashboard
- Orders
- Products
- Categories
- Pricing
- Banners
- Users
- Reports
- POS Integrations
- Settings

`order_pos_context` stores the external session, film, screen, and booking identifiers needed for POS operations. It is created once and then treated as immutable.

### POS transactions

`pos_transactions` remains the audit trail for POS API attempts. Its status values are still constrained technical states, not a master table.

The biggest architectural clarification is that payment gateway configuration belongs to the cinema, not to the POS integration row.

### Important separation

Payment gateway configuration is intentionally stored in its own
`payment_gateway_config` table instead of `pos_integrations`.

This is because payment processing and POS integration are two different concerns.

Each cinema may use its own payment gateway configuration regardless of which POS provider it uses.

The table stores:

- `gateway_url`
- `gateway_id`
- encrypted gateway secret
- active status

The encryption key is never stored in the database. It remains in secure server configuration or a secrets manager.

Payment gateway credentials are therefore kept separate from POS credentials:

- POS credentials stay with `pos_integrations` through `credential_ref`
- Payment gateway credentials stay with `payment_gateway_config`

Only one active payment gateway configuration is allowed per cinema. A filtered unique index enforces this while still allowing inactive historical configurations to be retained for credential rotation and auditing.

\*\*This separation is intentional and should remain unchanged during implementation.

## 6. Consumer app behavior

The consumer app should only present products that satisfy the availability rules.

At a high level, the menu flow is:

1. Load cinema categories and products
2. Check whether the cinema product is active
3. Check the date range, if present
4. Check the product availability windows, if any exist
5. Load the price row for the requested day, falling back to day 0 if needed
6. Show only the products that pass those checks

That keeps unavailable festival items, time-limited products, and disabled menu items out of the customer experience.

---

## 7. Dashboard behavior

The dashboard is the place where staff manage the new cinema-level controls.

It should cover:

- product availability schedules
- product date ranges
- cinema notification preferences
- cinema payment gateway configuration
- POS integration setup
- categories, products, pricing, and banners

The docs intentionally stop at the database boundary. They do not prescribe UI implementation details beyond the data model.

---

## 8. Multi-tenancy and history

The database keeps chain ownership and cinema ownership separated so one tenant does not leak into another.

Historical data stays intact:

- Orders remain linked to their original cinema
- Order and payment status transitions are preserved in log tables
- POS transaction attempts remain auditable
- Payment gateway settings can be rotated without losing history

That design keeps the schema practical for day-to-day operations and for later reporting.

---

## 9. Deferred items

`source_discounts` remains deferred and is not part of the active schema.

Other deferred ideas, such as price change logs and login audit logs, are not required for the current database design phase.

---

## 10. Quick summary of the updated architecture

- Chain logo lives on `chains`
- Cinema profile fields now include city, GST, FSSAI, active since, SMS, and WhatsApp flags
- Channel-specific product discounts live directly on `product_pricing`
- Product date ranges live on `cinema_products`
- Weekly availability windows live in `product_availability_hours`
- SeatNo is already covered by `orders.seat_number`
- POS_BookingId is represented by `order_pos_context.external_booking_id`
- SMS and WhatsApp delivery status are separate order columns
- POS provider support includes Vista, Showbizz, Impact, and QBusto
- Payment gateway config is per cinema, stored in its own table, and encrypted at rest
- The payment gateway encryption key is outside the database
- POS credentials remain separate from payment gateway credentials
- **Consumer API idempotency (Phase 1)**: `idempotency_keys` table maps UUID header values to order IDs, enabling safe retry of order creation
- `source_discounts` stays deferred
