# QBusto Database Schema

> Technical source of truth for the database.
> Last updated: 2026-09-01
> Revision: 14 - added `cinema_products.is_all_time_favourite` BIT NOT NULL
> DEFAULT 0 (`20260831000100-add-all-time-favourite-to-cinema-products.js`),
> membership of the fixed "All Time Favourite" section of the Consumer
> catalogue. It sits on the cinema/product link because the section is
> per-cinema: `categories.chain_id` is NOT NULL and there is no `cinema_id`, so
> a category row is shared by every cinema in the chain and could never hold a
> per-cinema selection. A favourite keeps its own `products.category_id` and
> appears in both places. Applied to the live database and verified.
> Revision: 13 - added `cinemas.screensaver_url` VARCHAR(500) NULL
> (`20260830000200-add-screensaver-url-to-cinemas.js`), the per-cinema Consumer
> screensaver artwork. Holds an upload path (`/uploads/cinemas/<file>`) or an
> external URL in one column, the same convention as `banners.image_url` and
> `chains.logo_image_url`. Nullable because cinemas created before the field
> have none and the Consumer falls back to its text hero; `POST /api/cinemas`
> requires it, `PUT` does not. Applied to the live database and verified.
> Revision: 12 - QBusto-owned datetime columns now store **IST wall clock**
> rather than UTC (`20260830000100-store-qbusto-datetimes-as-ist.js`, a
> data-only migration; no column type, index or constraint changed). Applied to
> the live database and verified: 1,083 values shifted +05:30, 24 date
> boundaries normalised to IST midnight, 43 `orders.show_time` values left
> untouched because they already held IST. See "Datetime storage convention"
> below.
> Revision: 11 - renamed the three SQL-Server-auto-generated constraint names
> on `payment_webhook_events` that still carried the old table name after
> Revision 10's table rename (`20260825000200-rename-payment-webhook-events-
> constraints.js`): `PK_payment_webhook_events`, `UQ_payment_webhook_events_
> event_id` (unique on `event_id`), `FK_payment_webhook_events_order_id`
> (`order_id` → `orders.id`). Applied to the live database and verified;
> confirmed zero database objects anywhere in the schema still contain
> "razorpay" in their name.
> Revision: 10 - renamed all Razorpay-specific payment columns/table to
> provider-neutral names (`20260825000100-rename-payment-columns-provider-neutral.js`),
> ahead of the Razorpay → Cashfree payment gateway migration. Applied to the
> live database and verified. See below for current names.
> Revision: 9 - added `razorpay_webhook_events` (since renamed, see Revision 10)
> and the filtered unique index on `orders.razorpay_order_id` (since renamed).

---

## Datetime storage convention

Four layers, deliberately distinct. Confusing any two of them is how timezone
bugs get introduced here.

| Layer | Convention | Type / form |
| --- | --- | --- |
| **QBusto-owned DB columns** | **IST wall clock** (no offset stored) | `datetime2(7)` |
| **Vista / client-owned columns** (`film`, `session`) | IST wall clock, as the source system writes it — **never modified by QBusto** | `datetime` |
| **JS / API** | absolute instant, serialised ISO-8601 (`…Z`) | JS `Date` |
| **Frontend display** | rendered in `Asia/Kolkata` | — |

Both database layers therefore hold the *same* wall clock in the same zone;
only the SQL type and the ownership differ.

Storage is produced by a **matched pair** in `backend/config/config.js` —
`timezone: '+05:30'` governs writes, `dialectOptions.options.useUTC: false`
governs reads. Either one alone stores plausible values while corrupting the
instant, so they must never be changed independently;
`tests/timezone.storage.test.js` pins both halves.

`useUTC: false` parses offset-less columns as *process*-local, so
`APP_TIMEZONE` (`src/config/env.js`) pins the process to IST and refuses to
boot otherwise.

**Do not convert QBusto columns to `datetime`.** Sequelize renders a `DATE` as
`DATETIMEOFFSET`, which `datetime` rejects outright — every ORM write would
fail. The type carries no timezone meaning either way.

`node scripts/tz-inventory.js` reports the current datetime surface,
classified by how each column is treated.

---

## Active table count

31 active tables.

Active tables:

chains, cinemas, screens, categories, cinema_categories, products, cinema_products, product_availability_hours, product_pricing, order_statuses, payment_statuses, orders, order_items, order_status_logs, payment_status_logs, users, user_permissions, banners, film, session, screen_layout, pos_integrations, screen_pos_mappings, product_pos_mappings, order_pos_context, pos_transactions, payment_gateway_config, idempotency_keys, shows, payment_webhook_events, offers.

Deferred and not in the active schema:

source_discounts, price_change_logs, user_login_logs.

---

## Audit-user coverage

Nullable audit-user fields are added only where they are meaningful and do not duplicate existing lifecycle audit data.

Tables with `created_by` and `updated_by`:

chains, cinemas, screens, categories, cinema_categories, products, cinema_products, product_availability_hours, product_pricing, user_permissions, banners, pos_integrations, screen_pos_mappings, product_pos_mappings, payment_gateway_config, offers.

Tables intentionally not given audit-user fields:

users, orders, order_items, order_status_logs, payment_status_logs, order_pos_context, pos_transactions, idempotency_keys, shows, payment_webhook_events.

Reasons:

- `order_status_logs` and `payment_status_logs` already carry `changed_by_user_id`.
- `order_pos_context` is immutable after creation.
- `pos_transactions` is an operational audit trail.
- `shows` rows are machine-written by the POS sync, not authored by a user.
- `payment_webhook_events` rows are written by the gateway webhook handler, not by a user.
- `orders` and `order_items` are business/history records where per-row creator/updater FKs add little value.
- `users` should not be self-referenced with audit fields unless a future requirement explicitly needs it.

Audit-user FKs are intended to behave as `ON DELETE SET NULL` so business records are preserved if a user is deleted or deactivated.

**As implemented, all audit-user FKs use `ON DELETE NO ACTION, ON UPDATE NO ACTION`.** SQL Server rejects two cascading foreign keys from the same table to the same parent table (Msg 1785, "may cause cycles or multiple cascade paths"), and every audit table declares both `created_by` and `updated_by` against `users.id`. The null-on-delete behaviour is therefore enforced by the application layer, not the database. This supersedes the `ON DELETE SET NULL` annotation shown in the per-column tables below - treat those annotations as intent, not as implemented DDL.

In normal operation this is not exercised: soft deletion (`is_active = 0`) is the standard deactivation pattern and user rows are not hard-deleted.

---

## chains

| Column         | Type         | Constraints                                  |
| -------------- | ------------ | -------------------------------------------- |
| id             | int          | PK auto                                      |
| name           | varchar(100) | NOT NULL                                     |
| logo_image_url | varchar(500) | nullable                                     |
| is_active      | bit          | NOT NULL, default 1                          |
| created_by     | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by     | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at     | datetime2    | NOT NULL                                     |
| updated_at     | datetime2    | NOT NULL                                     |

`logo_image_url` implements the client's Chain_logoImgurl request using snake_case.

---

## cinemas

| Column           | Type         | Constraints                                  |
| ---------------- | ------------ | -------------------------------------------- |
| id               | int          | PK auto                                      |
| chain_id         | int          | FK -> chains.id, NOT NULL                    |
| code             | varchar(10)  | NOT NULL, UNIQUE                             |
| name             | varchar(100) | NOT NULL                                     |
| location         | varchar(255) | nullable                                     |
| city             | varchar(100) | nullable                                     |
| gst_number       | varchar(50)  | nullable                                     |
| fssai_number     | varchar(50)  | nullable                                     |
| screensaver_url  | varchar(500) | nullable                                     |
| active_since     | datetime2    | nullable                                     |
| sms_enabled      | bit          | NOT NULL, default 0                          |
| whatsapp_enabled | bit          | NOT NULL, default 0                          |
| is_active        | bit          | NOT NULL, default 1                          |
| created_by       | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by       | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at       | datetime2    | NOT NULL                                     |
| updated_at       | datetime2    | NOT NULL                                     |

`code` is a QBusto-owned short cinema identifier used in QR URLs and display. It is not the external POS cinema identifier. That external identifier stays on `pos_integrations.external_cinema_id`.

`sms_enabled` and `whatsapp_enabled` define which notification channels the cinema normally uses.

---

## screens

| Column     | Type        | Constraints                                  |
| ---------- | ----------- | -------------------------------------------- |
| id         | int          | PK auto                                      |
| cinema_id  | int          | FK -> cinemas.id, NOT NULL                   |
| name       | varchar(50)  | NOT NULL                                     |
| category   | nvarchar(50) | nullable                                     |
| seat_row   | nvarchar(2)  | nullable                                     |
| is_active  | bit          | NOT NULL, default 1                          |
| created_by | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at | datetime2   | NOT NULL                                     |
| updated_at | datetime2   | NOT NULL                                     |

Screen names are freeform: Screen 1, IMAX, Gold Class, and so on.

`category` is the seat class ("Platinum", "Recliner") and `seat_row` the row
label ("A"). Both come from the client's data and are nullable, because the rows
that predate them do not carry one.

**Grain caveat.** The client's data holds one row per seat row rather than one
per auditorium: 82 rows cover 27 distinct (cinema, name) pairs, and one
auditorium at cinema 8 spans ten rows. QBusto's own concept is one row per
auditorium, and `orders.screen_id` and `screen_pos_mappings.screen_id` are
foreign keys to it. The data is the client's and is left exactly as they
supplied it; reconciling the two grains is an open question with them.

---

## categories

| Column      | Type          | Constraints                                  |
| ----------- | ------------- | -------------------------------------------- |
| id          | int           | PK auto                                      |
| chain_id    | int           | FK -> chains.id, NOT NULL                    |
| name        | varchar(200)  | NOT NULL                                     |
| description | nvarchar(max) | nullable                                     |
| image_url   | varchar(500)  | nullable                                     |
| is_active   | bit           | NOT NULL, default 1                          |
| created_by  | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by  | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at  | datetime2     | NOT NULL                                     |
| updated_at  | datetime2     | NOT NULL                                     |

Categories are chain-scoped. Each chain manages its own category catalog. Per-cinema availability is controlled by `cinema_categories`.

---

## cinema_categories

| Column      | Type      | Constraints                                  |
| ----------- | --------- | -------------------------------------------- |
| id          | int       | PK auto                                      |
| cinema_id   | int       | FK -> cinemas.id, NOT NULL                   |
| category_id | int       | FK -> categories.id, NOT NULL                |
| sequence    | int       | NOT NULL, default 0                          |
| is_active   | bit       | NOT NULL, default 1                          |
| created_by  | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by  | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at  | datetime2 | NOT NULL                                     |
| updated_at  | datetime2 | NOT NULL                                     |

Unique constraint: `(cinema_id, category_id)`.

---

## products

| Column          | Type          | Constraints                                  |
| --------------- | ------------- | -------------------------------------------- |
| id              | int           | PK auto                                      |
| chain_id        | int           | FK -> chains.id, NOT NULL                    |
| category_id     | int           | FK -> categories.id, NOT NULL                |
| name            | varchar(200)  | NOT NULL                                     |
| description     | nvarchar(max) | nullable                                     |
| weight          | varchar(50)   | nullable                                     |
| image_url       | varchar(500)  | nullable                                     |
| tax_slab_code   | varchar(20)   | nullable                                     |
| is_addon        | bit           | NOT NULL, default 0                          |
| addon_parent_id | int           | FK -> products.id, nullable                  |
| is_active       | bit           | NOT NULL, default 1                          |
| created_by      | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by      | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at      | datetime2     | NOT NULL                                     |
| updated_at      | datetime2     | NOT NULL                                     |

Complementary pricing is not part of V1.

---

## cinema_products

| Column          | Type      | Constraints                                  |
| --------------- | --------- | -------------------------------------------- |
| id              | int       | PK auto                                      |
| cinema_id       | int       | FK -> cinemas.id, NOT NULL                   |
| product_id      | int       | FK -> products.id, NOT NULL                  |
| sequence        | int       | NOT NULL, default 0                          |
| available_from  | datetime2 | nullable                                     |
| available_until | datetime2 | nullable                                     |
| is_active       | bit       | NOT NULL, default 1                          |
| is_all_time_favourite | bit | NOT NULL, default 0                        |
| created_by      | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by      | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at      | datetime2 | NOT NULL                                     |
| updated_at      | datetime2 | NOT NULL                                     |

Unique constraint: `(cinema_id, product_id)`.

`available_from` and `available_until` control date-range availability such as festival offers. `is_active` remains the primary enable or disable flag.

`sequence` is the display order within a cinema and is deliberately not unique, matching the legacy `DAE_ItemCinemaPrice.Sequence`.

`is_all_time_favourite` puts the product in the fixed "All Time Favourite" section at the head of the Consumer catalogue, for this cinema only. It is not a category: the section has no `categories` row, because a category is chain-scoped and the selection is per-cinema. A product marked here keeps its own `category_id` and appears in both its category and the fixed section. The section's name and artwork are constants (`constants.ALL_TIME_FAVOURITE`); the consumer categories endpoint prepends it with a negative id so it can never collide with a real category, and omits it entirely when a cinema has marked nothing.

This table is the parent of `product_availability_hours`, so a window is always scoped to one product at one cinema. It is exposed at `/api/cinema-products` and guarded by the `Products` permission module - the frozen module list has none of its own, and availability hours are guarded the same way.

Rules enforced by the application, not the database:

- the cinema and the product must belong to the same chain (the `CinemaProduct` `beforeSave` hook, plus an explicit service check that produces the better error)
- a new link cannot be created under a deactivated cinema or a deactivated product
- `available_until` must be later than `available_from` when both are set

Deactivating a link does not cascade to its availability hours - the windows remain readable and editable.

---

## product_availability_hours

| Column            | Type      | Constraints                                  |
| ----------------- | --------- | -------------------------------------------- |
| id                | int       | PK auto                                      |
| cinema_product_id | int       | FK -> cinema_products.id, NOT NULL           |
| day_of_week       | tinyint   | NOT NULL                                     |
| start_time        | time      | NOT NULL                                     |
| end_time          | time      | NOT NULL                                     |
| created_by        | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by        | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at        | datetime2 | NOT NULL                                     |
| updated_at        | datetime2 | NOT NULL                                     |

Checks:

- `day_of_week` must be between 0 and 7.
- `start_time < end_time` is intentionally not enforced so overnight windows can be represented and interpreted by application logic.

Unique constraint: `(cinema_product_id, day_of_week, start_time, end_time)` to prevent exact duplicate windows.

Non-unique index `IX_product_availability_hours_lookup` on `(cinema_product_id, day_of_week)` optimizes lookup of a product's availability schedule for a given day of the week.

Multiple windows per product and day are allowed. Overlapping windows for the same product and day should be prevented by application validation.

The API applies both of those application rules, and one the schema does not require:

- overlaps are rejected with a 409, treating `day_of_week = 0` as clashing with every other day
- touching windows (09:00-12:00 and 12:00-15:00) are not overlaps and are accepted
- **`startTime` must be earlier than `endTime`**, so an overnight window such as 22:00 to 02:00 is currently rejected with a 400 despite the column permitting it

DELETE on this table is a hard delete - there is no `is_active` column.

Day convention:

0 = all days
1 = Monday
2 = Tuesday
3 = Wednesday
4 = Thursday
5 = Friday
6 = Saturday
7 = Sunday

---

## product_pricing

| Column              | Type          | Constraints                                  |
| ------------------- | ------------- | -------------------------------------------- |
| id                  | int           | PK auto                                      |
| cinema_id           | int           | FK -> cinemas.id, NOT NULL                   |
| product_id          | int           | FK -> products.id, NOT NULL                  |
| day_of_week         | tinyint       | NOT NULL, default 0                          |
| base_price          | decimal(10,2) | NOT NULL, CHECK >= 0                         |
| discount_type       | char(1)       | nullable ('P'=Percentage, 'F'=Flat Amount)   |
| discount_value      | decimal(10,2) | nullable, CHECK >= 0                         |
| discount_on_qr      | decimal(10,2) | nullable, CHECK >= 0                         |
| discount_on_kiosk   | decimal(10,2) | nullable, CHECK >= 0                         |
| discount_on_seat_qr | decimal(10,2) | nullable, CHECK >= 0                         |
| discount_on_counter | decimal(10,2) | nullable, CHECK >= 0                         |
| is_active           | bit           | NOT NULL, default 1                          |
| created_by          | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by          | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at          | datetime2     | NOT NULL                                     |
| updated_at          | datetime2     | NOT NULL                                     |

Unique constraint: `(cinema_id, product_id, day_of_week)`.

Day-of-week values follow the same convention as `product_availability_hours`.

`discount_type` controls every `discount_on_*` value. `P` means Percentage and `F` means Flat Amount. The channel discount columns should be non-NULL only when `discount_type` is set, and the application layer should validate that relationship.

Checks:

- `base_price >= 0`
- `discount_value >= 0`
- `discount_on_qr >= 0`
- `discount_on_kiosk >= 0`
- `discount_on_seat_qr >= 0`
- `discount_on_counter >= 0`

No `selling_price` is stored. The application calculates the final price.

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

Master table for order lifecycle statuses. Application logic depends on `code`, never on numeric `id`.

Seeded values: initiated, confirmed, preparing, ready, delivered, rejected.

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

Master table for payment lifecycle statuses. Application logic depends on `code`, never on numeric `id`.

Seeded values: pending, paid, failed, refunded.

---

## orders

| Column              | Type          | Constraints                                       |
| ------------------- | ------------- | ------------------------------------------------- |
| id                  | int           | PK auto                                           |
| cinema_id           | int           | FK -> cinemas.id, NOT NULL                        |
| screen_id           | int           | FK -> screens.id, nullable                        |
| seat_number         | varchar(20)   | nullable                                          |
| status_id           | int           | FK -> order_statuses.id, NOT NULL                 |
| source              | varchar(20)   | nullable                                          |
| customer_mobile     | varchar(15)   | nullable                                          |
| customer_email      | varchar(200)  | nullable                                          |
| film_title          | varchar(200)  | nullable                                          |
| show_time           | datetime2     | nullable                                          |
| subtotal            | decimal(10,2) | NOT NULL, CHECK >= 0                              |
| discount            | decimal(10,2) | NOT NULL, default 0, CHECK >= 0                   |
| total               | decimal(10,2) | NOT NULL, CHECK >= 0                              |
| payment_status_id   | int           | FK -> payment_statuses.id, NOT NULL               |
| sms_status          | varchar(20)   | nullable, CHECK IN ('pending','success','failed') |
| whatsapp_status     | varchar(20)   | nullable, CHECK IN ('pending','success','failed') |
| gateway_order_id   | varchar(100)  | nullable                                          |
| gateway_payment_id | varchar(100)  | nullable                                          |
| gateway_signature  | varchar(255)  | nullable                                          |
| offer_id            | int           | FK -> offers.id, nullable, ON DELETE NO ACTION    |
| notes               | varchar(500)  | nullable                                          |
| delivered_at        | datetime2     | nullable                                          |
| created_at          | datetime2     | NOT NULL                                          |
| updated_at          | datetime2     | NOT NULL                                          |

`seat_number` directly satisfies the client's SeatNo requirement. It remains on `orders` so Kitchen/KDS and other flows can read the seat without any extra mapping.

`sms_status` and `whatsapp_status` are independent. NULL means that channel was not applicable or not enabled for this order.

The existing status master architecture remains unchanged. `orders.status_id` and `orders.payment_status_id` continue to point to the status master tables.

`gateway_order_id` carries a filtered unique index:

```sql
CREATE UNIQUE INDEX UX_orders_gateway_order_id
ON orders(gateway_order_id)
WHERE gateway_order_id IS NOT NULL;
```

The filter is required, not cosmetic. SQL Server treats NULLs as equal in a
unique index, so an unfiltered one would permit only a single order without a
Cashfree order id. With the filter, one gateway order maps to at most one
QBusto order while unpaid orders remain unconstrained.

`offer_id` records which coupon (see `offers` below), if any, was applied at
checkout - set once at order creation and never changed afterward, the same
way `film_title`/`show_time` freeze what an order was actually placed
against. `ON DELETE NO ACTION`: an offer that has ever been redeemed on an
order cannot be hard-deleted (the application layer refuses with a 409
before the database constraint would); it must be deactivated instead.

---

## order_items

| Column       | Type          | Constraints                     |
| ------------ | ------------- | ------------------------------- |
| id           | int           | PK auto                         |
| order_id     | int           | FK -> orders.id, NOT NULL       |
| product_id   | int           | FK -> products.id, NOT NULL     |
| product_name | varchar(200)  | NOT NULL                        |
| pos_item_id  | varchar(50)   | nullable                        |
| quantity     | int           | NOT NULL, CHECK > 0             |
| unit_price   | decimal(10,2) | NOT NULL, CHECK >= 0            |
| discount     | decimal(10,2) | NOT NULL, default 0, CHECK >= 0 |
| total        | decimal(10,2) | NOT NULL, CHECK >= 0            |

`product_name`, `unit_price`, and `discount` are frozen snapshots for historical accuracy.

---

## order_status_logs

| Column             | Type         | Constraints                       |
| ------------------ | ------------ | --------------------------------- |
| id                 | int          | PK auto                           |
| order_id           | int          | FK -> orders.id, NOT NULL         |
| previous_status_id | int          | FK -> order_statuses.id, nullable |
| new_status_id      | int          | FK -> order_statuses.id, NOT NULL |
| changed_by_user_id | int          | FK -> users.id, nullable          |
| reason             | varchar(500) | nullable                          |
| created_at         | datetime2    | NOT NULL                          |

The status update and the log insert must happen in the same database transaction.

---

## payment_status_logs

| Column              | Type         | Constraints                         |
| ------------------- | ------------ | ----------------------------------- |
| id                  | int          | PK auto                             |
| order_id            | int          | FK -> orders.id, NOT NULL           |
| previous_status_id  | int          | FK -> payment_statuses.id, nullable |
| new_status_id       | int          | FK -> payment_statuses.id, NOT NULL |
| changed_by_user_id  | int          | FK -> users.id, nullable            |
| gateway_payment_id | varchar(100) | nullable                            |
| reason              | varchar(500) | nullable                            |
| created_at          | datetime2    | NOT NULL                            |

The status update and the log insert must happen in the same database transaction.

---

## users

| Column        | Type         | Constraints                |
| ------------- | ------------ | -------------------------- |
| id            | int          | PK auto                    |
| chain_id      | int          | FK -> chains.id, NOT NULL  |
| cinema_id     | int          | FK -> cinemas.id, nullable |
| role          | varchar(20)  | NOT NULL                   |
| username      | varchar(50)  | NOT NULL, UNIQUE           |
| password_hash | varchar(255) | NOT NULL                   |
| first_name    | varchar(50)  | nullable                   |
| last_name     | varchar(50)  | nullable                   |
| mobile        | varchar(15)  | nullable                   |
| is_active     | bit          | NOT NULL, default 1        |
| created_at    | datetime2    | NOT NULL                   |
| updated_at    | datetime2    | NOT NULL                   |

Roles: owner, chain_admin, cinema_admin, kitchen_staff, cinema_accountant.

---

## user_permissions

| Column      | Type        | Constraints                                  |
| ----------- | ----------- | -------------------------------------------- |
| id          | int         | PK auto                                      |
| user_id     | int         | FK -> users.id, NOT NULL                     |
| module_name | varchar(50) | NOT NULL                                     |
| can_read    | bit         | NOT NULL, default 0                          |
| can_edit    | bit         | NOT NULL, default 0                          |
| can_delete  | bit         | NOT NULL, default 0                          |
| created_by  | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by  | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at  | datetime2   | NOT NULL                                     |
| updated_at  | datetime2   | NOT NULL                                     |

**Unique**: `(user_id, module_name)`

`module_name` stores the application module name directly (for example: Orders, Products, Reports).

Supported module names: Dashboard, Orders, Products, Categories, Pricing, Banners, Users, Reports, POS Integrations, Settings.

---

## banners

| Column     | Type         | Constraints                                  |
| ---------- | ------------ | -------------------------------------------- |
| id         | int          | PK auto                                      |
| cinema_id  | int          | FK -> cinemas.id, NOT NULL                   |
| image_url  | varchar(500) | NOT NULL                                     |
| type       | char(1)      | NOT NULL                                     |
| sequence   | int          | NOT NULL, default 0                          |
| start_date | datetime2    | nullable                                     |
| end_date   | datetime2    | nullable                                     |
| is_active  | bit          | NOT NULL, default 1                          |
| created_by | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by | int          | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at | datetime2    | NOT NULL                                     |
| updated_at | datetime2    | NOT NULL                                     |

`type` values are H for Header and I for Inner. V1 uses Header banners only.

The application retrieves active banner rows ordered by `sequence`.

---

## film

The client's film catalogue, renamed from `Film` in 20260823001000. **44
columns**, all supplied by their source system and left exactly as they are;
only the columns QBusto reads are listed here.

| Column                 | Type         | Constraints |
| ---------------------- | ------------ | ----------- |
| Film_strCode           | varchar(20)  | **PK**      |
| Film_strTitle          | varchar(500) | nullable    |
| Film_strCensor         | varchar(10)  | nullable    |
| Film_intDuration       | smallint     | nullable    |
| Film_strURLforGraphic  | varchar(255) | nullable    |
| Film_strStatus         | varchar(1)   | nullable    |
| Film_strNowShowingFlag | varchar(1)   | nullable    |
| Film_dtmOpeningDate    | datetime     | nullable    |

The primary key is the source system's own film code, not an integer of ours.
The `Film` model maps these to `code`, `title`, `certification`,
`durationMinutes`, `imageUrl`, `status`, `nowShowingFlag` and `openingDate`, so
the provider's prefixes do not leak into services or API responses.

Read-only in QBusto: the catalogue is synced, so a write made here would not
survive the next sync.

`test_column nchar(1000)` also exists and appears to be debris from the client's
side; nothing reads it.

---

## session

The client's screening schedule, renamed from `Session` in 20260823001000. **24
columns**; only those QBusto reads are listed.

| Column                | Type         | Constraints                        |
| --------------------- | ------------ | ---------------------------------- |
| Code                  | varchar(10)  | **PK (1/2)**, FK -> cinemas.code   |
| Session_lngSessionId  | int          | **PK (2/2)**                       |
| Film_strCode          | varchar(20)  | FK -> film.Film_strCode            |
| Screen_bytNum         | int          | nullable                           |
| Screen_strName        | varchar(25)  | nullable                           |
| Session_dtmRealShow   | datetime     | NOT NULL                           |
| Session_dtmFinishShow | datetime     | NOT NULL                           |
| Session_intSeatsAvail | int          | NOT NULL                           |
| Session_intSeatsTotal | int          | nullable                           |
| Session_strStatus     | varchar(1)   | NOT NULL, `O`=Open `C`=Closed `I`=Inactive |

The primary key is composite, and the cinema is joined by `code` rather than
`id`.

**There is no `screens.id` here.** The source system names the auditorium
(`Screen_strName`) instead, so a session cannot be joined to a screen by key.
Matching on (cinema, name) against the current `screens` data multiplies 133
sessions into 1119 rows, because `screens` is not unique per auditorium - which
is why nothing in the application attempts that resolution.

The date columns are `datetime`, not `datetime2`. Comparisons against them go
through `src/utils/sqlDate.js`, because Sequelize's DATE serializer emits an
offset-bearing literal that `datetime` rejects.

Read-only in QBusto, for the same reason as `film`.

---

## screen_layout

The client's seat map: one row per physical seat. Currently **empty**.

| Column      | Type         | Constraints                                  |
| ----------- | ------------ | -------------------------------------------- |
| id          | int          | PK auto                                      |
| cinema_id   | int          | FK -> cinemas.id, NOT NULL                   |
| screen_name | varchar(50)  | NOT NULL                                     |
| category    | varchar(50)  | NOT NULL                                     |
| seat_row    | varchar(2)   | NOT NULL                                     |
| seat_no     | varchar(3)   | NOT NULL                                     |
| is_active   | bit          | NOT NULL                                     |
| created_by  | int          | nullable, FK -> users.id                     |
| updated_by  | int          | nullable, FK -> users.id                     |
| created_at  | datetime2    | NOT NULL                                     |
| updated_at  | datetime2    | NOT NULL                                     |

The mixed-case columns were lowered to snake_case in 20260823001000 so the table
reads like the rest of the schema; it was already half snake_case.

It identifies its screen by `screen_name` text rather than by `screens.id` -
the client's structure, left as they built it. Nothing in the application reads
it yet: QBusto neither sells nor allocates seats.

---

## pos_integrations

| Column             | Type          | Constraints                                  |
| ------------------ | ------------- | -------------------------------------------- |
| id                 | int           | PK auto                                      |
| cinema_id          | int           | FK -> cinemas.id, NOT NULL                   |
| provider           | varchar(30)   | NOT NULL                                     |
| external_cinema_id | varchar(50)   | NOT NULL                                     |
| api_url            | varchar(500)  | NOT NULL                                     |
| is_active          | bit           | NOT NULL, default 1                          |
| credential_ref     | varchar(200)  | nullable                                     |
| config             | nvarchar(max) | nullable                                     |
| created_by         | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by         | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at         | datetime2     | NOT NULL                                     |
| updated_at         | datetime2     | NOT NULL                                     |

Unique constraint: `(cinema_id, provider)`.

SQL Server filtered unique index:

```sql
CREATE UNIQUE INDEX UQ_pos_integrations_active_cinema
ON pos_integrations(cinema_id)
WHERE is_active = 1;
```

`provider` values are `vista`, `showbizz`, `impact`, and `qbusto`.

`is_active` already represents whether the POS integration configuration is enabled for the cinema. The client's IS_Intigrated request is satisfied by this field, so no duplicate boolean is added.

`credential_ref` keeps the POS secret architecture separate. POS secrets are still not stored in plaintext in the database.

---

## idempotency_keys

Maps an `Idempotency-Key` request header to the order that header created.

| Column     | Type        | Constraints               |
| ---------- | ----------- | ------------------------- |
| id         | int         | PK auto                   |
| key        | varchar(36) | NOT NULL, UNIQUE          |
| order_id   | int         | FK -> orders.id, NOT NULL |
| created_at | datetime2   | NOT NULL                  |
| updated_at | datetime2   | NOT NULL                  |

Used by the consumer ordering API (`POST /api/consumer/orders`), which requires
the `Idempotency-Key` header on every request; a missing header is a 400.

The UNIQUE constraint on `key` is what makes order creation safe to retry. Two
requests carrying the same key cannot both insert, even if they arrive
simultaneously, so a client that retries after a network failure receives the
original order rather than creating a second one. The guarantee is the
constraint, not an application-side check-then-write.

`order_id` is NOT NULL: a key only ever exists because an order was created for
it. This is the opposite of `payment_webhook_events.order_id`, which is
nullable precisely because a delivery can name an order this system does not
recognise.

There are no `created_by` / `updated_by` columns - rows are written by the
ordering endpoint, not authored by a user.

---

## shows

Catalog of scheduled shows mirrored from the POS.

| Column              | Type         | Constraints                         |
| ------------------- | ------------ | ----------------------------------- |
| id                  | int          | PK auto                             |
| cinema_id           | int          | FK -> cinemas.id, NOT NULL          |
| screen_id           | int          | nullable, FK -> screens.id          |
| pos_integration_id  | int          | FK -> pos_integrations.id, NOT NULL |
| external_session_id | varchar(100) | NOT NULL                            |
| external_screen_id  | varchar(50)  | nullable                            |
| external_film_id    | varchar(50)  | nullable                            |
| film_title          | varchar(200) | NOT NULL                            |
| show_time           | datetime2    | NOT NULL, IST wall clock            |
| status              | varchar(20)  | NOT NULL, default `scheduled`       |
| last_synced_at      | datetime2    | NOT NULL                            |
| created_at          | datetime2    | NOT NULL                            |
| updated_at          | datetime2    | NOT NULL                            |

Indexes:

```sql
CREATE UNIQUE INDEX UQ_shows_external_session
ON shows(pos_integration_id, external_session_id);

CREATE INDEX IX_shows_cinema_show_time
ON shows(cinema_id, show_time);
```

`(pos_integration_id, external_session_id)` is the natural key. POS synchronization is an upsert on this pair, so the unique index is the entire duplicate-prevention mechanism. The same pair is already stored per order on `order_pos_context`, which is how an order is linked back to its show without adding a column to `orders`.

`IX_shows_cinema_show_time` matches the shape of the consumer window query (cinema plus a show-time range).

`screen_id` is nullable on purpose. A show can arrive from the POS before its external screen has been mapped in `screen_pos_mappings`; hiding such a show would silently lose it, so the row is kept with an unresolved screen instead. `external_screen_id` holds the raw value in the meantime.

`status` values are `scheduled` and `cancelled`, enforced by `CK_shows_status`. There is deliberately no `is_active` column: the soft-delete convention applies to staff-managed master data, and these rows mirror external state. Lifecycle is carried by `status` plus `last_synced_at`.

`show_time` stores IST wall clock, like every QBusto-owned datetime column
(see "Datetime storage convention" at the top of this document). The POS
supplies cinema-local wall clock; turning that into a Date is centralized in
the synchronization service (Phase B5) rather than in a provider adapter.

`cinema_id` is denormalized from `pos_integrations` so the window query and tenant scoping do not need a join.

### Tenant-consistency invariants (application-enforced)

`shows` participates in the same class of cross-table tenant rule already documented for `cinema_categories` and `cinema_products` under "Legacy and deferred notes". Two relationships must hold on every insert and update:

1. **`shows.cinema_id` MUST equal the cinema of `shows.pos_integration_id`.** A POS integration belongs to exactly one cinema through `pos_integrations.cinema_id`. Because `shows.cinema_id` is a denormalized copy, the two can disagree unless the writer keeps them in step.
2. **If `shows.screen_id` is non-null, that screen MUST belong to `shows.cinema_id`** (`screens.cinema_id = shows.cinema_id`).

**The database does not enforce either relationship.** The foreign keys only require that the referenced cinema, screen and integration rows exist; nothing constrains them to the same tenant. `screen_pos_mappings` does not constrain its screen to the integration's cinema either, so a mapping row created against the wrong cinema can resolve to a foreign cinema's screen.

**Application code MUST validate both before inserting or updating a show.** This is the responsibility of the show synchronization service — the only component that writes this table.

This validation prevents cross-cinema data leakage into the **public, unauthenticated** Consumer shows API. That endpoint (Phase B6) filters on `cinema_id` alone, so a row whose `cinema_id` disagrees with its integration would surface another cinema's show in this cinema's Show Time dropdown, and an order placed against it would carry a foreign cinema's `screen_id`.

**An unmapped screen is not an inconsistency.** `screen_id = null` is valid and expected when the external screen has no row in `screen_pos_mappings` yet. Such a show MUST remain visible, with an unresolved screen; the raw value stays in `external_screen_id` until the mapping exists. Only a _non-null_ `screen_id` pointing at another cinema's screen is a violation.

---

## screen_pos_mappings

| Column             | Type        | Constraints                                  |
| ------------------ | ----------- | -------------------------------------------- |
| id                 | int         | PK auto                                      |
| pos_integration_id | int         | FK -> pos_integrations.id, NOT NULL          |
| screen_id          | int         | FK -> screens.id, NOT NULL                   |
| external_screen_id | varchar(50) | NOT NULL                                     |
| created_by         | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by         | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at         | datetime2   | NOT NULL                                     |
| updated_at         | datetime2   | NOT NULL                                     |

Unique constraint: `(pos_integration_id, screen_id)`.

---

## product_pos_mappings

| Column             | Type        | Constraints                                  |
| ------------------ | ----------- | -------------------------------------------- |
| id                 | int         | PK auto                                      |
| pos_integration_id | int         | FK -> pos_integrations.id, NOT NULL          |
| product_id         | int         | FK -> products.id, NOT NULL                  |
| external_item_id   | varchar(50) | NOT NULL                                     |
| external_group_id  | varchar(50) | nullable                                     |
| created_by         | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by         | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at         | datetime2   | NOT NULL                                     |
| updated_at         | datetime2   | NOT NULL                                     |

Unique constraint: `(pos_integration_id, product_id)`.

---

## order_pos_context

| Column              | Type         | Constraints                         |
| ------------------- | ------------ | ----------------------------------- |
| id                  | int          | PK auto                             |
| order_id            | int          | FK -> orders.id, NOT NULL, UNIQUE   |
| pos_integration_id  | int          | FK -> pos_integrations.id, NOT NULL |
| external_session_id | varchar(100) | nullable                            |
| external_film_id    | varchar(50)  | nullable                            |
| external_screen_id  | varchar(50)  | nullable                            |
| external_booking_id | varchar(100) | nullable                            |
| created_at          | datetime2    | NOT NULL                            |

`external_booking_id` implements the client's POS_BookingId requirement. It stores the committed external POS booking or order identifier without duplicating it on `orders`.

This table remains immutable after creation and intentionally has no `updated_at`.

---

## pos_transactions

| Column               | Type           | Constraints                         |
| -------------------- | -------------- | ----------------------------------- |
| id                   | int            | PK auto                             |
| order_id             | int            | FK -> orders.id, NOT NULL           |
| pos_integration_id   | int            | FK -> pos_integrations.id, NOT NULL |
| operation            | varchar(30)    | NOT NULL                            |
| idempotency_key      | varchar(100)   | NOT NULL, UNIQUE                    |
| status               | varchar(20)    | NOT NULL, default 'pending'         |
| attempt_count        | int            | NOT NULL, default 1                 |
| external_response_id | varchar(100)   | nullable                            |
| request_payload      | nvarchar(4000) | nullable                            |
| response_payload     | nvarchar(4000) | nullable                            |
| last_error           | varchar(500)   | nullable                            |
| last_attempted_at    | datetime2      | nullable                            |
| created_at           | datetime2      | NOT NULL                            |
| updated_at           | datetime2      | NOT NULL                            |

`status` values remain `pending`, `success`, `failed`, and `unknown`. This is an operational state, not a master table.

Never store secrets, auth tokens, or sensitive PII in the payload columns.

---

## offers

Cinema-scoped coupons, managed from the Dashboard's Offers tab. Validated and
applied entirely within QBusto (`backend/src/services/coupon.service.js`) -
Cashfree has no visibility into this table or the discount it drives at all;
a customer applies a coupon in the Consumer app's cart, and the discount is
subtracted from an order's `total` before payment is ever requested from the
gateway.

| Column           | Type          | Constraints                                  |
| ---------------- | ------------- | --------------------------------------------- |
| id                | int           | PK auto                                      |
| cinema_id         | int           | FK -> cinemas.id, NOT NULL, ON DELETE NO ACTION |
| code              | varchar(50)   | NOT NULL                                     |
| name              | varchar(150)  | NOT NULL                                     |
| discount_type     | varchar(30)   | NOT NULL                                     |
| description       | varchar(500)  | nullable                                     |
| tnc               | varchar(2000) | nullable                                     |
| status            | varchar(20)   | NOT NULL, default 'active'                   |
| disc_amount       | decimal(10,2) | NOT NULL                                     |
| max_disc_amount   | decimal(10,2) | nullable - only meaningful when discount_type is 'percentage' |
| min_txn_amount    | decimal(10,2) | nullable                                     |
| max_txn_amount    | decimal(10,2) | nullable                                     |
| max_txn_limit     | int           | nullable (a redemption COUNT, not an amount) |
| valid_from        | datetime2     | nullable                                     |
| valid_until       | datetime2     | nullable                                     |
| created_by        | int           | nullable, FK -> users.id, ON DELETE NO ACTION |
| updated_by        | int           | nullable, FK -> users.id, ON DELETE NO ACTION |
| created_at        | datetime2     | NOT NULL                                     |
| updated_at        | datetime2     | NOT NULL                                     |

```sql
CREATE UNIQUE INDEX UX_offers_cinema_id_code
ON offers(cinema_id, code);
```

`code` is unique per cinema, not globally - what a customer types into
"Apply coupon" in the Consumer app.

`discount_type` is free text, but has a defined meaning the code reads
directly: `'percentage'` (case-insensitive) treats `disc_amount` as a
percent of the cart subtotal, capped by `max_disc_amount` if set; anything
else, **including `'flat'`**, is treated as a flat rupee amount. A coupon's
discount is always capped at the order's own subtotal - it can never make an
order negative.

`status` is free text, for the operator's own vocabulary rather than a fixed
enum.

`payment_modes` and `offer_category` existed only to mirror Cashfree's own
offer vocabulary from an abandoned design (see this table's own note below
on the superseded `cashfree_offer_id` design) and were never read by any
calculation. Both columns were dropped
(`20260825000700-drop-unused-offer-fields.js`) after a repository-wide
search confirmed nothing outside the Dashboard's own CRUD form referenced
them.

`max_txn_limit` caps total redemptions, counted only against **paid**
orders - an abandoned or still-pending order never took the coupon's slot.
This limit is checked at order-creation time, not re-checked at
payment-settlement time; two near-simultaneous checkouts can both pass the
check before either pays and both later pay, which is a known, accepted
race rather than a bug (refusing to honour a payment already actually
collected by Cashfree would be worse).

Deletion is a genuine delete, not soft, **unless** the coupon has been
redeemed on at least one order (`orders.offer_id` references it), in which
case the application layer refuses with a 409 - set `status` to something
other than `'active'` instead.

An earlier version of this table also carried `cashfree_offer_id`, for a
design where a coupon's Cashfree-side offer id was passed to Cashfree's own
`order_meta.offer_filters`. That column was dropped
(`20260825000600-revert-cashfree-offer-sync.js`) when the design was
reverted in favour of the pure-QBusto model described above.

---

## payment_gateway_config

| Column                   | Type          | Constraints                                  |
| ------------------------ | ------------- | -------------------------------------------- |
| id                       | int           | PK auto                                      |
| cinema_id                | int           | FK -> cinemas.id, NOT NULL                   |
| gateway_url              | varchar(500)  | NOT NULL (unused - see note)                 |
| gateway_id               | varchar(255)  | NOT NULL                                     |
| gateway_secret_encrypted | varchar(1000) | NOT NULL                                     |
| environment              | varchar(20)   | NOT NULL, default 'test'                     |
| is_active                | bit           | NOT NULL, default 1                          |
| created_by               | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by               | int           | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at               | datetime2     | NOT NULL                                     |
| updated_at               | datetime2     | NOT NULL                                     |

SQL Server filtered unique index:

```sql
CREATE UNIQUE INDEX UQ_payment_gateway_config_active_cinema
ON payment_gateway_config(cinema_id)
WHERE is_active = 1;
```

This table represents the client's PAYGATEWAY_URL, PAYGATEWAY_ID, and PAYGATEWAY_SECRETKEY requirements at cinema scope. **This is actively used**, not aspirational: each cinema may run its own Cashfree merchant account, resolved via `backend/src/services/cashfree.client.js`'s `resolveCredentials(cinemaId)`. This table is the **only** source of Cashfree credentials - the deployment-wide `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY` env vars were removed, so a cinema with no active row cannot take payments at all. `gateway_url` remains genuinely unused - `environment` (added later, not folded into `gateway_url`) is the column that carries which Cashfree environment (`test`/`sandbox`/`prod`/`production`) a cinema's credentials belong to.

The gateway secret is stored only as encrypted ciphertext in `gateway_secret_encrypted` (AES-256-GCM, `backend/src/utils/credentials.js`). The encryption key, `CREDENTIALS_ENCRYPTION_KEY`, must live outside the database, such as in server configuration or a secret manager.

Only one active payment gateway configuration should exist per cinema at a time, enforced by the filtered unique index above. Historical inactive rows may remain - replacing a cinema's credentials deactivates the previous row rather than overwriting it. Managed from the Dashboard: `Cinemas -> (cinema) -> Payment gateway`.

---

## payment_webhook_events

Durable record of every Cashfree webhook delivery that reached the application.

| Column              | Type        | Constraints               |
| ------------------- | ----------- | ------------------------- |
| id                  | int         | PK auto                   |
| event_id            | varchar(64) | NOT NULL, UNIQUE          |
| event               | varchar(50) | NOT NULL                  |
| gateway_order_id   | varchar(50) | nullable                  |
| gateway_payment_id | varchar(50) | nullable                  |
| order_id            | int         | FK -> orders.id, nullable |
| outcome             | varchar(30) | NOT NULL                  |
| reason              | varchar(60) | nullable                  |
| created_at          | datetime2   | NOT NULL                  |
| updated_at          | datetime2   | NOT NULL                  |

Indexes:

```sql
-- Created as a UNIQUE constraint on event_id.
CREATE INDEX IX_payment_webhook_events_gateway_order_id
ON payment_webhook_events(gateway_order_id);
```

`event_id` is the deduplication key. Cashfree may deliver the same event more
than once, or out of order, so the UNIQUE constraint is the entire
"process this event once" mechanism - a redelivery fails the insert rather than
being caught by an application-side check-then-write. Where a delivery carries
no event identifier, the handler derives a stable key from the event name and
its subject so the column is never null.

`order_id` is **nullable on purpose**. An event naming a Cashfree order this
system does not recognise must still be recorded, and a NOT NULL foreign key
would make that impossible - the delivery would have to be dropped, losing the
evidence that it arrived. `idempotency_keys.order_id` is NOT NULL for the
opposite reason: it only ever describes an order this system created.

`outcome` records what the handler decided: `received`, `applied` or `ignored`.
`reason` explains an `ignored` outcome for later investigation. Neither is a
master table; both are small operational states.

This table does not decide payment state. It records deliveries. The
pending-to-paid transition itself is a conditional update on `orders`, so a
duplicate delivery that somehow got past `event_id` still cannot apply the
transition twice.

There are no `created_by` / `updated_by` columns: these rows are machine-written
by the webhook handler, following the same convention as `order_pos_context`,
`pos_transactions` and `shows`.

---

All core (non-audit) foreign keys use `ON DELETE NO ACTION, ON UPDATE NO ACTION` unless otherwise noted. Soft deletion (`is_active = 0`) is the standard deactivation pattern - rows are not hard-deleted in normal operation.

## Relationships

Tenancy and catalog:

- `cinemas.chain_id -> chains.id`
- `screens.cinema_id -> cinemas.id`
- `users.chain_id -> chains.id`
- `users.cinema_id -> cinemas.id`
- `banners.cinema_id -> cinemas.id`
- `categories.chain_id -> chains.id`
- `products.chain_id -> chains.id`
- `products.category_id -> categories.id`
- `products.addon_parent_id -> products.id`

Cinema-scoped catalog and pricing:

- `cinema_categories.cinema_id -> cinemas.id`
- `cinema_categories.category_id -> categories.id`
- `cinema_products.cinema_id -> cinemas.id`
- `cinema_products.product_id -> products.id`
- `product_availability_hours.cinema_product_id -> cinema_products.id`
- `product_pricing.cinema_id -> cinemas.id`
- `product_pricing.product_id -> products.id`

Orders and status history:

- `orders.cinema_id -> cinemas.id`
- `orders.screen_id -> screens.id`
- `orders.status_id -> order_statuses.id`
- `orders.payment_status_id -> payment_statuses.id`
- `order_items.order_id -> orders.id`
- `order_items.product_id -> products.id`
- `order_status_logs.order_id -> orders.id`
- `order_status_logs.previous_status_id -> order_statuses.id`
- `order_status_logs.new_status_id -> order_statuses.id`
- `order_status_logs.changed_by_user_id -> users.id`
- `payment_status_logs.order_id -> orders.id`
- `payment_status_logs.previous_status_id -> payment_statuses.id`
- `payment_status_logs.new_status_id -> payment_statuses.id`
- `payment_status_logs.changed_by_user_id -> users.id`
- `payment_webhook_events.order_id -> orders.id`
- `orders.offer_id -> offers.id`

Coupons:

- `offers.cinema_id -> cinemas.id`
- `offers.created_by -> users.id`
- `offers.updated_by -> users.id`

POS and payment gateway:

- `pos_integrations.cinema_id -> cinemas.id`
- `screen_pos_mappings.pos_integration_id -> pos_integrations.id`
- `screen_pos_mappings.screen_id -> screens.id`
- `product_pos_mappings.pos_integration_id -> pos_integrations.id`
- `product_pos_mappings.product_id -> products.id`
- `order_pos_context.order_id -> orders.id`
- `order_pos_context.pos_integration_id -> pos_integrations.id`
- `pos_transactions.order_id -> orders.id`
- `pos_transactions.pos_integration_id -> pos_integrations.id`
- `payment_gateway_config.cinema_id -> cinemas.id`

Audit-user links:

- `user_permissions.user_id -> users.id`
- `user_permissions.created_by -> users.id`
- `user_permissions.updated_by -> users.id`
- `chains.created_by -> users.id`
- `chains.updated_by -> users.id`
- `cinemas.created_by -> users.id`
- `cinemas.updated_by -> users.id`
- `screens.created_by -> users.id`
- `screens.updated_by -> users.id`
- `categories.created_by -> users.id`
- `categories.updated_by -> users.id`
- `cinema_categories.created_by -> users.id`
- `cinema_categories.updated_by -> users.id`
- `products.created_by -> users.id`
- `products.updated_by -> users.id`
- `cinema_products.created_by -> users.id`
- `cinema_products.updated_by -> users.id`
- `product_availability_hours.created_by -> users.id`
- `product_availability_hours.updated_by -> users.id`
- `product_pricing.created_by -> users.id`
- `product_pricing.updated_by -> users.id`
- `banners.created_by -> users.id`
- `banners.updated_by -> users.id`
- `pos_integrations.created_by -> users.id`
- `pos_integrations.updated_by -> users.id`
- `screen_pos_mappings.created_by -> users.id`
- `screen_pos_mappings.updated_by -> users.id`
- `product_pos_mappings.created_by -> users.id`
- `product_pos_mappings.updated_by -> users.id`
- `payment_gateway_config.created_by -> users.id`
- `payment_gateway_config.updated_by -> users.id`

---

## Indexes and checks summary

Unique constraints and indexes used in the active schema:

- `cinemas.code` unique
- `cinema_categories(cinema_id, category_id)` unique
- `cinema_products(cinema_id, product_id)` unique
- `product_pricing(cinema_id, product_id, day_of_week)` unique
- `product_availability_hours(cinema_product_id, day_of_week, start_time, end_time)` unique
- `product_availability_hours(cinema_product_id, day_of_week)` non-unique index, name `IX_product_availability_hours_lookup` - optimizes lookup of a product's availability schedule for a given day of week
- `order_statuses.code` unique
- `payment_statuses.code` unique
- `users.username` unique
- `pos_integrations(cinema_id, provider)` unique
- filtered unique index on `pos_integrations(cinema_id)` where `is_active = 1`
- `screen_pos_mappings(pos_integration_id, screen_id)` unique
- `product_pos_mappings(pos_integration_id, product_id)` unique
- `order_pos_context.order_id` unique
- `pos_transactions.idempotency_key` unique
- filtered unique index on `payment_gateway_config(cinema_id)` where `is_active = 1`
- `offers(cinema_id, code)` unique
- `orders(cinema_id, created_at)` non-unique index
- `orders(status_id)` non-unique index
- `orders(payment_status_id)` non-unique index
- `order_items(order_id)` non-unique index
- `pos_transactions(order_id)` non-unique index
- `shows(pos_integration_id, external_session_id)` unique
- `shows(cinema_id, show_time)` non-unique index
- `payment_webhook_events.event_id` unique
- `payment_webhook_events(gateway_order_id)` non-unique index
- filtered unique index on `orders(gateway_order_id)` where `gateway_order_id IS NOT NULL`

Checks:

- `product_pricing.discount_type IN ('P','F')`
- `banners.type IN ('H','I')`
- `pos_integrations.provider IN ('vista','showbizz','impact','qbusto')`
- `pos_transactions.status IN ('pending','success','failed','unknown')`
- `shows.status IN ('scheduled','cancelled')`
- `users.role IN ('owner','chain_admin','cinema_admin','kitchen_staff','cinema_accountant')`
- `user_permissions.module_name IN ('Dashboard','Orders','Products','Categories','Pricing','Banners','Users','Reports','POS Integrations','Settings')`
- `orders.source IN ('qr','seat_qr','kiosk','counter')`
- `product_pricing.base_price >= 0`
- `product_pricing.discount_value >= 0`
- `product_pricing.discount_on_qr >= 0`
- `product_pricing.discount_on_kiosk >= 0`
- `product_pricing.discount_on_seat_qr >= 0`
- `product_pricing.discount_on_counter >= 0`
- `product_availability_hours.day_of_week BETWEEN 0 AND 7`
- `orders.subtotal >= 0`
- `orders.discount >= 0`
- `orders.total >= 0`
- `orders.sms_status IN ('pending','success','failed')` when not NULL
- `orders.whatsapp_status IN ('pending','success','failed')` when not NULL
- `order_items.quantity > 0`
- `order_items.unit_price >= 0`
- `order_items.discount >= 0`
- `order_items.total >= 0`
- `pos_transactions.attempt_count >= 1`

---

## Availability rule

A cinema product is currently available only when:

1. `cinema_products.is_active = 1`
2. If `available_from` is set, the current date and time is on or after it
3. If `available_until` is set, the current date and time is on or before it
4. If `product_availability_hours` rows exist, the current day and time matches at least one applicable row
5. If no `product_availability_hours` rows exist, there is no time-of-day restriction

`available_from` and `available_until` handle date-range availability. `product_availability_hours` handles recurring weekly windows. Multiple windows per day are allowed.

---

## Legacy and deferred notes

The database does not enforce that a cinema's `chain_id` matches the `chain_id` of a `category` or `product` referenced through `cinema_categories` or `cinema_products`. Application code (service layer or Sequelize hooks) MUST validate this before insert/update to prevent cross-tenant data leakage.

The same applies to `shows`: `cinema_id` must match the cinema of `pos_integration_id`, and a non-null `screen_id` must belong to that cinema. See "Tenant-consistency invariants" under [shows](#shows).

- `orders.seat_number` already satisfies SeatNo.
- `pos_integrations.is_active` already satisfies IS_Intigrated.
- `order_pos_context.external_booking_id` implements POS_BookingId.
- `source_discounts` remains deferred and is not part of the active schema.
- Payment gateway credentials are stored per cinema in `payment_gateway_config`, not in `pos_integrations`.
- `gateway_secret_encrypted` stores ciphertext only. The encryption key is external to the database.
- POS credential handling remains separate through `pos_integrations.credential_ref`.
