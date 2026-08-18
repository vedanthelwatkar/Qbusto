# QBusto Database Schema

> Technical source of truth for the database.
> Last updated: 2026-08-13
> Revision: 8 - added `shows` (Phase B1); corrected the active-table list, which omitted `idempotency_keys`.

---

## Active table count

26 active tables.

Active tables:

chains, cinemas, screens, categories, cinema_categories, products, cinema_products, product_availability_hours, product_pricing, order_statuses, payment_statuses, orders, order_items, order_status_logs, payment_status_logs, users, user_permissions, banners, pos_integrations, screen_pos_mappings, product_pos_mappings, order_pos_context, pos_transactions, payment_gateway_config, idempotency_keys, shows.

Deferred and not in the active schema:

source_discounts, price_change_logs, user_login_logs.

---

## Audit-user coverage

Nullable audit-user fields are added only where they are meaningful and do not duplicate existing lifecycle audit data.

Tables with `created_by` and `updated_by`:

chains, cinemas, screens, categories, cinema_categories, products, cinema_products, product_availability_hours, product_pricing, user_permissions, banners, pos_integrations, screen_pos_mappings, product_pos_mappings, payment_gateway_config.

Tables intentionally not given audit-user fields:

users, orders, order_items, order_status_logs, payment_status_logs, order_pos_context, pos_transactions, idempotency_keys, shows.

Reasons:

- `order_status_logs` and `payment_status_logs` already carry `changed_by_user_id`.
- `order_pos_context` is immutable after creation.
- `pos_transactions` is an operational audit trail.
- `shows` rows are machine-written by the POS sync, not authored by a user.
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
| id         | int         | PK auto                                      |
| cinema_id  | int         | FK -> cinemas.id, NOT NULL                   |
| name       | varchar(50) | NOT NULL                                     |
| is_active  | bit         | NOT NULL, default 1                          |
| created_by | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by | int         | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at | datetime2   | NOT NULL                                     |
| updated_at | datetime2   | NOT NULL                                     |

Screen names are freeform: Screen 1, IMAX, Gold Class, and so on.

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
| created_by      | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| updated_by      | int       | nullable, FK -> users.id, ON DELETE SET NULL |
| created_at      | datetime2 | NOT NULL                                     |
| updated_at      | datetime2 | NOT NULL                                     |

Unique constraint: `(cinema_id, product_id)`.

`available_from` and `available_until` control date-range availability such as festival offers. `is_active` remains the primary enable or disable flag.

`sequence` is the display order within a cinema and is deliberately not unique, matching the legacy `DAE_ItemCinemaPrice.Sequence`.

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
| razorpay_order_id   | varchar(100)  | nullable                                          |
| razorpay_payment_id | varchar(100)  | nullable                                          |
| razorpay_signature  | varchar(255)  | nullable                                          |
| notes               | varchar(500)  | nullable                                          |
| delivered_at        | datetime2     | nullable                                          |
| created_at          | datetime2     | NOT NULL                                          |
| updated_at          | datetime2     | NOT NULL                                          |

`seat_number` directly satisfies the client's SeatNo requirement. It remains on `orders` so Kitchen/KDS and other flows can read the seat without any extra mapping.

`sms_status` and `whatsapp_status` are independent. NULL means that channel was not applicable or not enabled for this order.

The existing status master architecture remains unchanged. `orders.status_id` and `orders.payment_status_id` continue to point to the status master tables.

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
| razorpay_payment_id | varchar(100) | nullable                            |
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

## shows

Catalog of scheduled shows mirrored from the POS.

| Column              | Type         | Constraints                              |
| ------------------- | ------------ | ---------------------------------------- |
| id                  | int          | PK auto                                  |
| cinema_id           | int          | FK -> cinemas.id, NOT NULL               |
| screen_id           | int          | nullable, FK -> screens.id               |
| pos_integration_id  | int          | FK -> pos_integrations.id, NOT NULL      |
| external_session_id | varchar(100) | NOT NULL                                 |
| external_screen_id  | varchar(50)  | nullable                                 |
| external_film_id    | varchar(50)  | nullable                                 |
| film_title          | varchar(200) | NOT NULL                                 |
| show_time           | datetime2    | NOT NULL, UTC instant                    |
| status              | varchar(20)  | NOT NULL, default `scheduled`            |
| last_synced_at      | datetime2    | NOT NULL                                 |
| created_at          | datetime2    | NOT NULL                                 |
| updated_at          | datetime2    | NOT NULL                                 |

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

`show_time` stores a UTC instant. The POS supplies cinema-local wall clock; conversion is centralized in the synchronization service (Phase B5) rather than in a provider adapter.

`cinema_id` is denormalized from `pos_integrations` so the window query and tenant scoping do not need a join.

### Tenant-consistency invariants (application-enforced)

`shows` participates in the same class of cross-table tenant rule already documented for `cinema_categories` and `cinema_products` under "Legacy and deferred notes". Two relationships must hold on every insert and update:

1. **`shows.cinema_id` MUST equal the cinema of `shows.pos_integration_id`.** A POS integration belongs to exactly one cinema through `pos_integrations.cinema_id`. Because `shows.cinema_id` is a denormalized copy, the two can disagree unless the writer keeps them in step.
2. **If `shows.screen_id` is non-null, that screen MUST belong to `shows.cinema_id`** (`screens.cinema_id = shows.cinema_id`).

**The database does not enforce either relationship.** The foreign keys only require that the referenced cinema, screen and integration rows exist; nothing constrains them to the same tenant. `screen_pos_mappings` does not constrain its screen to the integration's cinema either, so a mapping row created against the wrong cinema can resolve to a foreign cinema's screen.

**Application code MUST validate both before inserting or updating a show.** This is the responsibility of the show synchronization service — the only component that writes this table.

This validation prevents cross-cinema data leakage into the **public, unauthenticated** Consumer shows API. That endpoint (Phase B6) filters on `cinema_id` alone, so a row whose `cinema_id` disagrees with its integration would surface another cinema's show in this cinema's Show Time dropdown, and an order placed against it would carry a foreign cinema's `screen_id`.

**An unmapped screen is not an inconsistency.** `screen_id = null` is valid and expected when the external screen has no row in `screen_pos_mappings` yet. Such a show MUST remain visible, with an unresolved screen; the raw value stays in `external_screen_id` until the mapping exists. Only a *non-null* `screen_id` pointing at another cinema's screen is a violation.

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

## payment_gateway_config

| Column                   | Type          | Constraints                                  |
| ------------------------ | ------------- | -------------------------------------------- |
| id                       | int           | PK auto                                      |
| cinema_id                | int           | FK -> cinemas.id, NOT NULL                   |
| gateway_url              | varchar(500)  | NOT NULL                                     |
| gateway_id               | varchar(255)  | NOT NULL                                     |
| gateway_secret_encrypted | varchar(1000) | NOT NULL                                     |
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

This table represents the client's PAYGATEWAY_URL, PAYGATEWAY_ID, and PAYGATEWAY_SECRETKEY requirements at cinema scope.

The gateway secret is stored only as encrypted ciphertext in `gateway_secret_encrypted`. The encryption key must live outside the database, such as in server configuration or a secret manager.

Only one active payment gateway configuration should exist per cinema at a time. Historical inactive rows may remain.

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
- `orders(cinema_id, created_at)` non-unique index
- `orders(status_id)` non-unique index
- `orders(payment_status_id)` non-unique index
- `order_items(order_id)` non-unique index
- `pos_transactions(order_id)` non-unique index
- `shows(pos_integration_id, external_session_id)` unique
- `shows(cinema_id, show_time)` non-unique index

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
