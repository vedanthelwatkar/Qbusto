# QBusto Database Schema

> Reference document. Source of truth for Sequelize models and migrations.
> Last updated: 2026-08-07
> Revision: 4 - Status master tables + audit logs introduced; source_discounts remains deferred.

---

## chains

| Column     | Type         | Constraints         |
| ---------- | ------------ | ------------------- |
| id         | int          | PK auto             |
| name       | varchar(100) | NOT NULL            |
| is_active  | bit          | NOT NULL, default 1 |
| created_at | datetime2    | NOT NULL            |
| updated_at | datetime2    | NOT NULL            |

---

## cinemas

| Column     | Type         | Constraints           |
| ---------- | ------------ | --------------------- |
| id         | int          | PK auto               |
| chain_id   | int          | FK → chains, NOT NULL |
| code       | varchar(10)  | NOT NULL, UNIQUE      |
| name       | varchar(100) | NOT NULL              |
| location   | varchar(255) | nullable              |
| is_active  | bit          | NOT NULL, default 1   |
| created_at | datetime2    | NOT NULL              |
| updated_at | datetime2    | NOT NULL              |

`code` is a QBusto-owned short cinema identifier (e.g., "1038", "1074"). Used in QR URLs and display. It is NOT the POS integration identifier - the external POS cinema/theatre ID lives on `pos_integrations.external_cinema_id`. Existing cinemas may initially use the same value as legacy Vista Cinema_strID for convenience.

---

## screens

| Column     | Type        | Constraints            |
| ---------- | ----------- | ---------------------- |
| id         | int         | PK auto                |
| cinema_id  | int         | FK → cinemas, NOT NULL |
| name       | varchar(50) | NOT NULL               |
| is_active  | bit         | NOT NULL, default 1    |
| created_at | datetime2   | NOT NULL               |
| updated_at | datetime2   | NOT NULL               |

Screen names are freeform: "Screen 1", "IMAX", "Gold Class", etc.

---

## categories

| Column      | Type          | Constraints           |
| ----------- | ------------- | --------------------- |
| id          | int           | PK auto               |
| chain_id    | int           | FK → chains, NOT NULL |
| name        | varchar(200)  | NOT NULL              |
| description | nvarchar(max) | nullable              |
| image_url   | varchar(500)  | nullable              |
| is_active   | bit           | NOT NULL, default 1   |
| created_at  | datetime2     | NOT NULL              |
| updated_at  | datetime2     | NOT NULL              |

Categories are chain-scoped. Each chain manages its own category catalog. Per-cinema availability is controlled by `cinema_categories`.

A product belongs to exactly one category within the same chain.

---

## cinema_categories

| Column      | Type      | Constraints               |
| ----------- | --------- | ------------------------- |
| id          | int       | PK auto                   |
| cinema_id   | int       | FK → cinemas, NOT NULL    |
| category_id | int       | FK → categories, NOT NULL |
| sequence    | int       | NOT NULL, default 0       |
| is_active   | bit       | NOT NULL, default 1       |
| created_at  | datetime2 | NOT NULL                  |
| updated_at  | datetime2 | NOT NULL                  |

**Unique**: `(cinema_id, category_id)`

---

## products

| Column           | Type          | Constraints                    |
| ---------------- | ------------- | ------------------------------ |
| id               | int           | PK auto                        |
| chain_id         | int           | FK → chains, NOT NULL          |
| category_id      | int           | FK → categories, NOT NULL      |
| name             | varchar(200)  | NOT NULL                       |
| description      | nvarchar(max) | nullable                       |
| weight           | varchar(50)   | nullable                       |
| image_url        | varchar(500)  | nullable                       |
| tax_slab_code    | varchar(20)   | nullable                       |
| is_complementary | bit           | NOT NULL, default 0            |
| is_addon         | bit           | NOT NULL, default 0            |
| addon_parent_id  | int           | FK → products (self), nullable |
| is_active        | bit           | NOT NULL, default 1            |
| created_at       | datetime2     | NOT NULL                       |
| updated_at       | datetime2     | NOT NULL                       |

Products are chain-scoped. Each chain manages its own product catalog. A product belongs to exactly one category within the same chain.

> `is_complementary` exists for legacy compatibility. No behavior is built around it in V1.

---

## cinema_products

| Column     | Type      | Constraints             |
| ---------- | --------- | ----------------------- |
| id         | int       | PK auto                 |
| cinema_id  | int       | FK → cinemas, NOT NULL  |
| product_id | int       | FK → products, NOT NULL |
| sequence   | int       | NOT NULL, default 0     |
| is_active  | bit       | NOT NULL, default 1     |
| created_at | datetime2 | NOT NULL                |
| updated_at | datetime2 | NOT NULL                |

**Unique**: `(cinema_id, product_id)`

Controls product availability per cinema. POS item codes are stored separately in `product_pos_mappings`.

---

## product_pricing

| Column           | Type          | Constraints                      |
| ---------------- | ------------- | -------------------------------- |
| id               | int           | PK auto                          |
| cinema_id        | int           | FK → cinemas, NOT NULL           |
| product_id       | int           | FK → products, NOT NULL          |
| day_of_week      | tinyint       | NOT NULL, default 0              |
| base_price       | decimal(10,2) | NOT NULL, CHECK >= 0             |
| discount_type    | char(1)       | nullable ('P'=percent, 'F'=flat) |
| discount_value   | decimal(10,2) | nullable, CHECK >= 0             |
| complement_price | decimal(10,2) | nullable, CHECK >= 0             |
| is_active        | bit           | NOT NULL, default 1              |
| created_at       | datetime2     | NOT NULL                         |
| updated_at       | datetime2     | NOT NULL                         |

**Unique**: `(cinema_id, product_id, day_of_week)`

### day_of_week values

```
0 = default (all days / fallback)
1 = Monday
2 = Tuesday
3 = Wednesday
4 = Thursday
5 = Friday
6 = Saturday
7 = Sunday
```

Lookup logic: query for specific day first, fall back to `day_of_week = 0` if no day-specific row exists.

No `selling_price` stored - calculated in backend code.

> `complement_price` exists for legacy compatibility. No behavior is built around it in V1.

---

## order_statuses

| Column      | Type         | Constraints         |
| ----------- | ------------ | ------------------- |
| id          | int          | PK auto             |
| code        | varchar(30)  | NOT NULL, UNIQUE    |
| name        | varchar(100) | NOT NULL            |
| description | varchar(255) | nullable            |
| is_active   | bit          | NOT NULL, default 1 |
| created_at  | datetime2    | NOT NULL            |
| updated_at  | datetime2    | NOT NULL            |

Master table for order lifecycle statuses. Application logic depends on `code`, NEVER on numeric `id`.

### Seeded values

| code      | name      | description                          |
| --------- | --------- | ------------------------------------ |
| initiated | Initiated | Order created, awaiting payment      |
| confirmed | Confirmed | Payment verified, visible to kitchen |
| preparing | Preparing | Kitchen has started cooking          |
| ready     | Ready     | Food prepared, awaiting delivery     |
| delivered | Delivered | Food handed to customer              |
| rejected  | Rejected  | Order rejected by cinema staff       |

### Lifecycle transitions

```
initiated → confirmed → preparing → ready → delivered
                ↓
             rejected
```

### Design rules

- `code` is the stable machine-readable identifier. Application code compares against `code`.
- `name` is the display-friendly label. Can be changed without breaking logic (e.g., `ready` → "Ready for Pickup").
- Numeric `id` is a database identity only. NEVER hardcode assumed IDs in application logic.

---

## payment_statuses

| Column      | Type         | Constraints         |
| ----------- | ------------ | ------------------- |
| id          | int          | PK auto             |
| code        | varchar(30)  | NOT NULL, UNIQUE    |
| name        | varchar(100) | NOT NULL            |
| description | varchar(255) | nullable            |
| is_active   | bit          | NOT NULL, default 1 |
| created_at  | datetime2    | NOT NULL            |
| updated_at  | datetime2    | NOT NULL            |

Master table for payment lifecycle statuses. Application logic depends on `code`, NEVER on numeric `id`.

### Seeded values

| code     | name     | description                    |
| -------- | -------- | ------------------------------ |
| pending  | Pending  | Awaiting payment               |
| paid     | Paid     | Payment confirmed via Razorpay |
| failed   | Failed   | Payment attempt failed         |
| refunded | Refunded | Payment refunded to customer   |

### Lifecycle transitions

```
pending → paid
    ↓       ↓
  failed  refunded
```

### Design rules

Same as `order_statuses`: depend on `code`, never on numeric `id`.

---

## orders

| Column              | Type          | Constraints                     |
| ------------------- | ------------- | ------------------------------- |
| id                  | int           | PK auto                         |
| cinema_id           | int           | FK → cinemas, NOT NULL          |
| screen_id           | int           | FK → screens, nullable          |
| seat_number         | varchar(20)   | nullable                        |
| status_id           | int           | FK → order_statuses, NOT NULL   |
| source              | varchar(20)   | nullable                        |
| customer_mobile     | varchar(15)   | nullable                        |
| customer_email      | varchar(200)  | nullable                        |
| film_title          | varchar(200)  | nullable                        |
| show_time           | datetime2     | nullable                        |
| subtotal            | decimal(10,2) | NOT NULL, CHECK >= 0            |
| discount            | decimal(10,2) | NOT NULL, default 0, CHECK >= 0 |
| total               | decimal(10,2) | NOT NULL, CHECK >= 0            |
| payment_status_id   | int           | FK → payment_statuses, NOT NULL |
| razorpay_order_id   | varchar(100)  | nullable                        |
| razorpay_payment_id | varchar(100)  | nullable                        |
| razorpay_signature  | varchar(255)  | nullable                        |
| notes               | varchar(500)  | nullable                        |
| delivered_at        | datetime2     | nullable                        |
| created_at          | datetime2     | NOT NULL                        |
| updated_at          | datetime2     | NOT NULL                        |

`film_title` and `show_time` are provider-neutral display snapshots. External POS session/booking/film identifiers are stored in `order_pos_context`.

### Resolving default status IDs at order creation

The application MUST NOT hardcode numeric IDs. Recommended V1 approach:

1. On application startup, query `order_statuses` and `payment_statuses` tables.
2. Build an in-memory map: `{ code → id }` (e.g., `{ 'initiated': 1, 'confirmed': 2, ... }`).
3. Use `statusMap['initiated']` and `paymentStatusMap['pending']` when creating orders.
4. Cache is invalidated/refreshed only on application restart (status codes are stable).

This avoids per-request DB lookups while remaining safe across environments where auto-increment IDs may differ.

No DB-level DEFAULT is set on `status_id` or `payment_status_id` - the application always provides the resolved ID explicitly.

### Source values

```
qr
seat_qr
kiosk
counter
```

---

## order_items

| Column       | Type          | Constraints                     |
| ------------ | ------------- | ------------------------------- |
| id           | int           | PK auto                         |
| order_id     | int           | FK → orders, NOT NULL           |
| product_id   | int           | FK → products, NOT NULL         |
| product_name | varchar(200)  | NOT NULL                        |
| pos_item_id  | varchar(50)   | nullable                        |
| quantity     | int           | NOT NULL, CHECK > 0             |
| unit_price   | decimal(10,2) | NOT NULL, CHECK >= 0            |
| discount     | decimal(10,2) | NOT NULL, default 0, CHECK >= 0 |
| total        | decimal(10,2) | NOT NULL, CHECK >= 0            |

`product_name` is a snapshot - historical record of what was ordered.

`pos_item_id` is a snapshot of the external POS item identifier resolved at order time from `product_pos_mappings`. Provider-neutral: stores whatever external ID applied (Vista master_item_code or Showbizz ItemId). Nullable because counter orders or orders at cinemas without POS integration may not have a POS code.

---

## order_status_logs

| Column             | Type         | Constraints                   |
| ------------------ | ------------ | ----------------------------- |
| id                 | int          | PK auto                       |
| order_id           | int          | FK → orders, NOT NULL         |
| previous_status_id | int          | FK → order_statuses, nullable |
| new_status_id      | int          | FK → order_statuses, NOT NULL |
| changed_by_user_id | int          | FK → users, nullable          |
| reason             | varchar(500) | nullable                      |
| created_at         | datetime2    | NOT NULL                      |

Audit log of every order status transition.

- `previous_status_id` is NULL for the first entry (order creation).
- `changed_by_user_id` is NULL for system-generated transitions (e.g., payment confirmation → `confirmed`).
- `reason` captures optional context (e.g., "Out of stock" for rejection).

### Implementation requirement

Updating `orders.status_id` and inserting into `order_status_logs` MUST happen in the same database transaction. This prevents state/history divergence where the order shows `ready` but the log only records up to `preparing`.

---

## payment_status_logs

| Column              | Type         | Constraints                     |
| ------------------- | ------------ | ------------------------------- |
| id                  | int          | PK auto                         |
| order_id            | int          | FK → orders, NOT NULL           |
| previous_status_id  | int          | FK → payment_statuses, nullable |
| new_status_id       | int          | FK → payment_statuses, NOT NULL |
| changed_by_user_id  | int          | FK → users, nullable            |
| razorpay_payment_id | varchar(100) | nullable                        |
| reason              | varchar(500) | nullable                        |
| created_at          | datetime2    | NOT NULL                        |

Audit log of every payment status transition.

- `previous_status_id` is NULL for the first entry (order creation with `pending`).
- `razorpay_payment_id` captures the Razorpay reference associated with this transition (e.g., the payment ID when transitioning to `paid`).
- `changed_by_user_id` is NULL for system/webhook-driven transitions.

This is QBusto's internal payment-state audit trail. Razorpay remains the authoritative external ledger.

### Implementation requirement

Same as order_status_logs: updating `orders.payment_status_id` and inserting into `payment_status_logs` MUST happen in the same database transaction.

---

## users

| Column        | Type         | Constraints            |
| ------------- | ------------ | ---------------------- |
| id            | int          | PK auto                |
| chain_id      | int          | FK → chains, NOT NULL  |
| cinema_id     | int          | FK → cinemas, nullable |
| role          | varchar(20)  | NOT NULL               |
| username      | varchar(50)  | NOT NULL, UNIQUE       |
| password_hash | varchar(255) | NOT NULL               |
| first_name    | varchar(50)  | nullable               |
| last_name     | varchar(50)  | nullable               |
| mobile        | varchar(15)  | nullable               |
| is_active     | bit          | NOT NULL, default 1    |
| created_at    | datetime2    | NOT NULL               |
| updated_at    | datetime2    | NOT NULL               |

### Roles

```
owner          - chain_id required, cinema_id NULL
chain_admin    - chain_id required, cinema_id NULL
cinema_admin   - chain_id required, cinema_id required
kitchen_staff  - chain_id required, cinema_id required
```

Backend validates that `cinema_id` belongs to the user's `chain_id`.

---

## banners

| Column     | Type         | Constraints            |
| ---------- | ------------ | ---------------------- |
| id         | int          | PK auto                |
| cinema_id  | int          | FK → cinemas, NOT NULL |
| image_url  | varchar(500) | NOT NULL               |
| type       | char(1)      | nullable               |
| is_active  | bit          | NOT NULL, default 1    |
| created_at | datetime2    | NOT NULL               |
| updated_at | datetime2    | NOT NULL               |

> `type` column kept for legacy compatibility. H/I meanings unconfirmed. Not blocking V1.

---

## POS Integration Layer

The following tables form the POS integration layer. They store external POS mappings, order-level POS context, and transaction audit logs. Domain tables (above) remain provider-neutral.

Full architectural rationale: see `schema-explained.md` sections 6 and 8.

---

## pos_integrations

| Column             | Type          | Constraints            |
| ------------------ | ------------- | ---------------------- |
| id                 | int           | PK auto                |
| cinema_id          | int           | FK → cinemas, NOT NULL |
| provider           | varchar(30)   | NOT NULL               |
| external_cinema_id | varchar(50)   | NOT NULL               |
| is_active          | bit           | NOT NULL, default 1    |
| credential_ref     | varchar(200)  | nullable               |
| config             | nvarchar(max) | nullable               |
| created_at         | datetime2     | NOT NULL               |
| updated_at         | datetime2     | NOT NULL               |

**Unique**: `(cinema_id, provider)`

**Filtered unique index** (SQL Server):

```sql
CREATE UNIQUE INDEX UQ_pos_integrations_active_cinema
ON pos_integrations(cinema_id)
WHERE is_active = 1;
```

This guarantees AT MOST one active POS integration per cinema. Zero active integrations is valid (cinema not yet configured). Application validation rejects POS ordering when no active integration exists.

**`provider`** values: `'vista'`, `'showbizz'`, or future providers.

**`external_cinema_id`**: The POS system's identifier for this cinema (Vista: Cinema_strID, Showbizz: TheatreId).

**`credential_ref`**: Pointer to an external secrets manager (e.g., `"pos/showbizz/cinema-1074"`). Actual secrets (passwords, API keys, tokens) are NEVER stored in database tables. If NULL, application code falls back to provider-wide environment variables.

**`config`**: Non-secret JSON configuration only (API base URL, timeout, transaction type). Example: `{"api_base_url": "https://...", "transaction_type": "InCinemaFB", "timeout_ms": 30000}`.

---

## screen_pos_mappings

| Column             | Type        | Constraints                     |
| ------------------ | ----------- | ------------------------------- |
| id                 | int         | PK auto                         |
| pos_integration_id | int         | FK → pos_integrations, NOT NULL |
| screen_id          | int         | FK → screens, NOT NULL          |
| external_screen_id | varchar(50) | NOT NULL                        |
| created_at         | datetime2   | NOT NULL                        |
| updated_at         | datetime2   | NOT NULL                        |

**Unique**: `(pos_integration_id, screen_id)`

Maps QBusto screens to external POS screen identifiers. Required for Showbizz (`ScreenId`). Only populated for providers that need screen IDs in API calls.

---

## product_pos_mappings

| Column             | Type        | Constraints                     |
| ------------------ | ----------- | ------------------------------- |
| id                 | int         | PK auto                         |
| pos_integration_id | int         | FK → pos_integrations, NOT NULL |
| product_id         | int         | FK → products, NOT NULL         |
| external_item_id   | varchar(50) | NOT NULL                        |
| external_group_id  | varchar(50) | nullable                        |
| created_at         | datetime2   | NOT NULL                        |
| updated_at         | datetime2   | NOT NULL                        |

**Unique**: `(pos_integration_id, product_id)` - V1 assumes 1:1 product→POS item mapping.

**`external_item_id`**: POS identifier used when posting a sale (Vista: master_item_code like "I000001624", Showbizz: ItemId).

**`external_group_id`**: Showbizz `MainItemId` (parent/group concept). Nullable - Vista does not use this.

Replaces the removed `cinema_products.master_item_code`. Availability (is product sold here?) is now separate from POS identity (what's its POS code?).

---

## order_pos_context

| Column              | Type         | Constraints                     |
| ------------------- | ------------ | ------------------------------- |
| id                  | int          | PK auto                         |
| order_id            | int          | FK → orders, NOT NULL, UNIQUE   |
| pos_integration_id  | int          | FK → pos_integrations, NOT NULL |
| external_session_id | varchar(100) | nullable                        |
| external_film_id    | varchar(50)  | nullable                        |
| external_screen_id  | varchar(50)  | nullable                        |
| created_at          | datetime2    | NOT NULL                        |

**Unique**: `(order_id)` - exactly one POS context per order.

Stores external POS show/session context for a specific order. Created at order time; immutable after creation.

- `external_session_id`: Vista Session_lngSessionId or Showbizz BookingId.
- `external_film_id`: Vista Film_strCode or Showbizz FilmId.
- `external_screen_id`: resolved from `screen_pos_mappings` at order time.

All nullable because some orders (counter, kiosk without ticket scan) may lack full POS context.

No `updated_at` - context is immutable once set.

---

## pos_transactions

| Column               | Type           | Constraints                     |
| -------------------- | -------------- | ------------------------------- |
| id                   | int            | PK auto                         |
| order_id             | int            | FK → orders, NOT NULL           |
| pos_integration_id   | int            | FK → pos_integrations, NOT NULL |
| operation            | varchar(30)    | NOT NULL                        |
| idempotency_key      | varchar(100)   | NOT NULL, UNIQUE                |
| status               | varchar(20)    | NOT NULL, default 'pending'     |
| attempt_count        | int            | NOT NULL, default 1             |
| external_response_id | varchar(100)   | nullable                        |
| request_payload      | nvarchar(4000) | nullable                        |
| response_payload     | nvarchar(4000) | nullable                        |
| last_error           | varchar(500)   | nullable                        |
| last_attempted_at    | datetime2      | nullable                        |
| created_at           | datetime2      | NOT NULL                        |
| updated_at           | datetime2      | NOT NULL                        |

### Operation values

```
Showbizz: book_items, buy_item, cancel, refund
Vista:    post_sale (INFERRED), refund (UNKNOWN)
```

Vista operations are NOT confirmed - no API documentation available.

### Status values

```
pending  - request in-flight or about to be sent
success  - POS confirmed it processed the operation
failed   - POS explicitly rejected (safe to retry)
unknown  - outcome ambiguous (timeout, connection lost); must NOT be blindly retried
```

POS transaction statuses remain as varchar. They are integration/implementation states - NOT configurable business lifecycle statuses - and do not need a master table.

**Critical**: `failed` means definitive rejection. `unknown` means the POS may have processed the request but QBusto did not receive confirmation. Retry safety for `unknown` depends on provider idempotency guarantees.

### Idempotency

`idempotency_key` format: `order_{order_id}_{operation}` (e.g., `order_123_book_items`).

The UNIQUE constraint guarantees one logical-operation row per order+operation. Retries update the existing row (`attempt_count`, `last_error`, payloads) rather than creating new rows.

**Important**: This constraint prevents duplicate INTERNAL rows. It does NOT guarantee the external POS processes the operation only once. For the full retry strategy, see `schema-explained.md`.

### Payload storage

`request_payload` and `response_payload` use `nvarchar(4000)` (in-row, no LOB). Store sanitized JSON of the LATEST attempt only.

**NEVER store in payloads**: passwords, PartnerPwd, API keys, auth tokens, sensitive PII.

---

## Multi-Tenancy / Chain Isolation

QBusto supports multiple cinema chains. Data from Chain A must never be accidentally exposed to or configurable by Chain B.

### Ownership model

| Table                | Owned by        | Isolation mechanism                                       |
| -------------------- | --------------- | --------------------------------------------------------- |
| chains               | System          | Top-level tenant boundary                                 |
| cinemas              | Chain           | `chain_id` FK                                             |
| screens              | Cinema          | Via `cinema_id` → inherits chain from cinema              |
| categories           | Chain           | `chain_id` FK                                             |
| products             | Chain           | `chain_id` FK                                             |
| cinema_categories    | Cinema          | Junction: cinema + category (same-chain validated in app) |
| cinema_products      | Cinema          | Junction: cinema + product (same-chain validated in app)  |
| product_pricing      | Cinema          | References cinema + product (same-chain validated)        |
| order_statuses       | System          | Global - shared across all chains                         |
| payment_statuses     | System          | Global - shared across all chains                         |
| orders               | Cinema          | `cinema_id` FK → inherits chain scope                     |
| order_items          | Order           | Via `order_id` → cinema → chain                           |
| order_status_logs    | Order           | Via `order_id` → cinema → chain                           |
| payment_status_logs  | Order           | Via `order_id` → cinema → chain                           |
| users                | Chain (+Cinema) | `chain_id` FK; `cinema_id` must match chain               |
| banners              | Cinema          | `cinema_id` FK → inherits chain                           |
| pos_integrations     | Cinema          | `cinema_id` FK → inherits chain                           |
| screen_pos_mappings  | POS Integration | Via `pos_integration_id` → cinema → chain                 |
| product_pos_mappings | POS Integration | Via `pos_integration_id` → cinema → chain                 |
| order_pos_context    | Order           | Via `order_id` → cinema → chain                           |
| pos_transactions     | Order           | Via `order_id` → cinema → chain                           |

### Cross-chain prevention

- **categories** and **products** have `chain_id` FK. Each chain owns its own catalog.
- **order_statuses** and **payment_statuses** are global system tables - shared across all chains (same lifecycle for all).
- Application middleware validates that authenticated users can only access entities belonging to their own `chain_id`.
- Junction tables (`cinema_categories`, `cinema_products`) link cinemas to categories/products. App must validate both sides belong to the same chain.
- Orders inherit chain scope through `cinema_id`.
- POS integration tables inherit chain scope through cinema ownership.

### What is NOT enforced at DB level

Cross-chain FK validation (e.g., "cinema's chain_id must match product's chain_id") is enforced in application code, not via DB constraints. SQL Server does not support multi-column cross-table CHECK constraints.

---

## Foreign Key Delete Behavior

### Principle

Historical transactional data (orders, order_items, pos_transactions, status logs) must survive deactivation or removal of configuration data. Prefer soft-deletion (`is_active = 0`) for master data.

### Rules

| Parent           | Child                | ON DELETE | Rationale                                          |
| ---------------- | -------------------- | --------- | -------------------------------------------------- |
| chains           | cinemas              | NO ACTION | Deactivate chain; never delete while cinemas exist |
| cinemas          | screens              | NO ACTION | Preserve screen refs in historical orders          |
| cinemas          | orders               | NO ACTION | Orders are permanent financial records             |
| cinemas          | cinema_categories    | NO ACTION | Soft-delete via `is_active`                        |
| cinemas          | cinema_products      | NO ACTION | Soft-delete via `is_active`                        |
| cinemas          | pos_integrations     | NO ACTION | POS transaction history references these           |
| categories       | cinema_categories    | NO ACTION | Deactivate category; don't cascade                 |
| categories       | products             | NO ACTION | Deactivate product; don't cascade                  |
| products         | cinema_products      | NO ACTION |                                                    |
| products         | order_items          | NO ACTION | Historical items must survive product changes      |
| products         | product_pos_mappings | NO ACTION | Remove mapping explicitly                          |
| order_statuses   | orders               | NO ACTION | Status rows are never deleted                      |
| order_statuses   | order_status_logs    | NO ACTION | Audit history is permanent                         |
| payment_statuses | orders               | NO ACTION | Status rows are never deleted                      |
| payment_statuses | payment_status_logs  | NO ACTION | Audit history is permanent                         |
| orders           | order_items          | CASCADE   | Deleting an order deletes its items                |
| orders           | order_pos_context    | CASCADE   | POS context meaningless without order              |
| orders           | order_status_logs    | CASCADE   | Status history meaningless without order           |
| orders           | payment_status_logs  | CASCADE   | Payment history meaningless without order          |
| orders           | pos_transactions     | NO ACTION | POS audit trail preserved even if order archived   |
| users            | order_status_logs    | NO ACTION | Preserve who-changed-it reference                  |
| users            | payment_status_logs  | NO ACTION | Preserve who-changed-it reference                  |
| pos_integrations | screen_pos_mappings  | NO ACTION |                                                    |
| pos_integrations | product_pos_mappings | NO ACTION |                                                    |
| pos_integrations | order_pos_context    | NO ACTION | Historical context preserved                       |
| pos_integrations | pos_transactions     | NO ACTION | Audit trail survives integration deactivation      |

### Summary

- Master/config data: soft-delete (`is_active = 0`). Never hard-delete while referenced.
- Status master tables (`order_statuses`, `payment_statuses`): never deleted. Deactivate via `is_active` if a status is retired.
- Order data: never deleted in normal operation. Financial/audit records are permanent.
- POS audit data: never deleted.
- CASCADE: `orders → order_items`, `orders → order_pos_context`, `orders → order_status_logs`, `orders → payment_status_logs`.

---

## Indexes

Beyond PKs, FKs, and unique constraints:

### Domain table indexes

```sql
cinemas(chain_id)
screens(cinema_id)
categories(chain_id)
cinema_categories(cinema_id, is_active)
cinema_products(cinema_id, is_active)
products(chain_id, category_id)
product_pricing(cinema_id, product_id)
orders(cinema_id, status_id, created_at)
orders(razorpay_order_id)
orders(razorpay_payment_id)
order_items(order_id)
users(chain_id)
users(cinema_id)
banners(cinema_id, is_active)
```

### Status audit log indexes

```sql
order_status_logs(order_id, created_at)
payment_status_logs(order_id, created_at)
```

### POS integration layer indexes

```sql
pos_integrations(cinema_id, is_active)
screen_pos_mappings(screen_id)
product_pos_mappings(product_id)
pos_transactions(order_id, operation)
pos_transactions(pos_integration_id, status, created_at)
```

### Kitchen display query

```sql
SELECT o.*
FROM orders o
JOIN order_statuses os ON o.status_id = os.id
WHERE o.cinema_id = ?
  AND os.code IN ('confirmed', 'preparing', 'ready')
ORDER BY o.created_at
```

The `orders(cinema_id, status_id, created_at)` composite index covers this - the join to `order_statuses` resolves status IDs (small lookup, typically cached), then the index filters by cinema + status_id + sort by created_at.

Alternative (optimized): application caches the `id` values for `confirmed`, `preparing`, `ready` at startup and queries directly:

```sql
SELECT * FROM orders
WHERE cinema_id = ?
  AND status_id IN (@confirmed_id, @preparing_id, @ready_id)
ORDER BY created_at
```

This avoids the JOIN entirely and uses the composite index directly. Recommended for V1.

---

## CHECK constraints

| Table            | Column                         | Constraint |
| ---------------- | ------------------------------ | ---------- |
| product_pricing  | base_price                     | >= 0       |
| product_pricing  | discount_value                 | >= 0       |
| product_pricing  | complement_price               | >= 0       |
| product_pricing  | discount_value (when type='P') | <= 100     |
| orders           | subtotal                       | >= 0       |
| orders           | discount                       | >= 0       |
| orders           | total                          | >= 0       |
| order_items      | quantity                       | > 0        |
| order_items      | unit_price                     | >= 0       |
| order_items      | discount                       | >= 0       |
| order_items      | total                          | >= 0       |
| pos_transactions | attempt_count                  | >= 1       |

---

## Relationships

```
order_statuses
  ├── orders.status_id
  ├── order_status_logs.previous_status_id
  └── order_status_logs.new_status_id

payment_statuses
  ├── orders.payment_status_id
  ├── payment_status_logs.previous_status_id
  └── payment_status_logs.new_status_id

chains
  ├── cinemas
  │    ├── screens
  │    ├── cinema_categories → categories (chain-owned)
  │    ├── cinema_products → products (chain-owned)
  │    ├── product_pricing → products
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

## Not in schema (intentional)

- **POS credentials / secrets** - external secrets manager or environment variables, not DB
- **Dashboard navigation** - hardcoded in frontend
- **User-form permissions** - role-based middleware
- **Shows/schedule table** - QBusto does not manage schedules; show context is a snapshot
- **POS transaction attempts table** - V1 stores only latest attempt; add if operational need arises
- **Cascading deletes on transactional data** - orders/pos_transactions are permanent audit records
- **Generic error log table** - application/runtime errors go to structured logging infrastructure (stdout, log aggregator), not transactional SQL rows. Business-significant failures are captured in domain tables: POS failures in `pos_transactions`, status transitions in `order_status_logs`/`payment_status_logs`.
- **Master tables for enums** - order source, POS provider, POS transaction status, POS operation, discount type, banner type, and roles remain application-controlled stable values. Only `order_statuses` and `payment_statuses` have master tables because they represent important business lifecycles with display names, descriptions, and transition history.

---

## Legacy compatibility notes

| QBusto field                          | Legacy origin                                         | Notes                                                    |
| ------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| cinemas.code                          | tblCinema.Cinema_strID                                | Now QBusto-owned; POS ID on pos_integrations             |
| product_pos_mappings.external_item_id | DAE_ItemCinemaPrice.Item_strMasterItemcode            | Moved from cinema_products to POS layer                  |
| order_pos_context.external_session_id | DAE_Orders.Session_lngSessionId                       | Moved from orders to POS layer                           |
| order_pos_context.external_film_id    | DAE_Orders.Film_strCode                               | Moved from orders to POS layer                           |
| order_statuses                        | DAE_OrderStatus                                       | Modernized: stable `code` + display `name` + history log |
| products.is_complementary             | DAE_Items.IsItemComplementary                         | Kept; behavior deferred                                  |
| product_pricing.complement_price      | DAE*ItemCinemaPrice.ItemComplementPrice*\*            | Kept; behavior deferred                                  |
| source_discounts (deferred)           | DAE_Items.QRDiscount / KioskDiscount / SeatQRDiscount | Not in V1                                                |

---

## Deferred / Pending Business Features (NOT in V1 active schema)

These features are not required for the V1 order-placement flow. They may be added post-launch.

### source_discounts (deferred)

Per-ordering-channel discounts (e.g., 5% off for QR orders). Legacy data shows this was actively used. If QBusto needs it later:

| Column         | Type          | Constraints             |
| -------------- | ------------- | ----------------------- |
| id             | int           | PK auto                 |
| cinema_id      | int           | FK → cinemas, NOT NULL  |
| product_id     | int           | FK → products, NOT NULL |
| source         | varchar(20)   | NOT NULL                |
| discount_type  | char(1)       | NOT NULL ('P' or 'F')   |
| discount_value | decimal(10,2) | NOT NULL, CHECK >= 0    |
| created_at     | datetime2     | NOT NULL                |
| updated_at     | datetime2     | NOT NULL                |

Unique: `(cinema_id, product_id, source)`. Source values: `qr`, `seat_qr`, `kiosk`, `counter`.

### Complementary pricing (deferred behavior)

`products.is_complementary` and `product_pricing.complement_price` columns are kept in schema but NO logic is built around them in V1.

### Banner type semantics (deferred)

`banners.type` column is kept but H/I meanings are not confirmed. Not blocking order placement.

---

## Deferred / Future Audit Features

### price_change_logs (deferred)

May be useful later for admin auditing: who changed a price, old vs new value, when. NOT required for V1 because `order_items` already snapshots `unit_price` and `discount` at order time - historical orders remain financially accurate regardless of pricing changes.

Potential future structure:

| Column             | Type          | Purpose                   |
| ------------------ | ------------- | ------------------------- |
| id                 | int           | PK                        |
| cinema_id          | int           | FK → cinemas              |
| product_id         | int           | FK → products             |
| day_of_week        | tinyint       | Which pricing row changed |
| old_base_price     | decimal(10,2) | Previous price            |
| new_base_price     | decimal(10,2) | Updated price             |
| changed_by_user_id | int           | FK → users                |
| created_at         | datetime2     | When the change occurred  |

### user_login_logs (deferred)

Authentication auditing (login attempts, success/failure, IP, user agent). Not required for the V1 order-placement flow. Staff authentication works without login logging.

Potential future structure:

| Column     | Type         | Purpose        |
| ---------- | ------------ | -------------- |
| id         | int          | PK             |
| user_id    | int          | FK → users     |
| success    | bit          | Login result   |
| ip_address | varchar(45)  | Client IP      |
| user_agent | varchar(500) | Browser/device |
| created_at | datetime2    | When           |

---

## Pending decisions (adapter-level, NOT schema blockers)

These are implementation blockers for specific POS adapters, not database schema blockers:

1. **Per-cinema POS credentials** - Shared per provider or per cinema? Determines `credential_ref` usage. (Adapter concern.)
2. **Showbizz MainItemId** - Required in API calls? Determines if `external_group_id` is practically required. (Adapter concern.)
3. **Showbizz BookItems expiration** - Timeout before auto-cancel? (Adapter concern.)
4. **Vista API** - Exact endpoints, parameters, idempotency, refund support. (Adapter concern.)
5. **Showbizz/Vista idempotency** - Whether providers deduplicate on client-supplied keys. (Retry logic concern.)
