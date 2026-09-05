# Database table audit — AUDITED ONLY, NO CHANGES MADE

**Date:** 2026-09-04
**Database:** `qbusto` (development instance, restored from the client's own
backup and since migrated).
**Scope:** every table SQL Server reports in `sys.tables`.

> **Nothing in this document was executed.** No table was dropped, altered,
> emptied or created while producing it. Every statement run was a `SELECT`
> against `sys.tables`, `sys.foreign_keys` and `INFORMATION_SCHEMA`. The
> recommendations are recommendations; acting on any of them is a separate
> decision that needs the client's agreement, because several of these tables
> are theirs, not ours.

**32 tables.** Down from 35: `film`, `shows` and `session_old` were dropped by
`20260904000100-session-sole-show-source.js` as part of the same work that
produced this audit, and are not counted here.

Method, per table: does a Sequelize model exist; is it read anywhere in `src/`;
is it written anywhere in `src/`; is it created or altered by a migration; does
another table hold a foreign key INTO it; is it client-owned.

---

## Category A — actively used (18 tables)

Read and written by application code on a normal day. No action.

| Table | Rows | Notes |
| --- | --- | --- |
| `chains` | 5 | Tenant root. |
| `cinemas` | 11 | Tenant anchor; also holds `whatsapp_enabled` and `timezone`. |
| `screens` | 82 | Auditorium/seat-row grain conflict — see client-tables.md. |
| `users` | 6 | |
| `user_permissions` | 44 | Reloaded on every authenticated request. |
| `categories` | 24 | |
| `products` | 150 | |
| `cinema_products` | 161 | |
| `product_pricing` | 157 | |
| `product_availability_hours` | 147 | |
| `banners` | 20 | |
| `offers` | 2 | Coupons. |
| `orders` | 80 | |
| `order_items` | 98 | |
| `order_statuses` | 6 | Seeded master data. |
| `payment_statuses` | 4 | Seeded master data. |
| `order_status_logs` | 208 | |
| `payment_status_logs` | 118 | |

Also active, and worth naming separately because their row counts look small:

| Table | Rows | Why it is active regardless of count |
| --- | --- | --- |
| `payment_gateway_config` | 4 | Per-cinema Cashfree credentials. The ONLY place a payment secret is stored, encrypted. |
| `payment_webhook_events` | 10 | Written by `paymentwebhook.service`; the replay/idempotency record. |
| `idempotency_keys` | 73 | Written by `consumer.service` on order creation. |

## Category B — client-owned or externally written (2 tables)

QBusto is not the author. Removing either is the client's decision, not ours.

| Table | Rows | Assessment |
| --- | --- | --- |
| `session` | 210 | **The single source of showtimes.** Read by the consumer picker and the Dashboard; written by `showSync.service` and by the client's own systems. 0 rows with a null title; statuses observed: `O` 191, `C` 4, `Y` 15. **Keep.** |
| `screen_layout` | 0 | The client's seat map, one row per physical seat. **Nothing in `src/` reads it** — the model exists only so schema verification can see the table. Empty, and identifies its screen by name rather than by `screens.id`. **Do not remove:** an empty client table cannot be distinguished from a client table that is about to be populated, and the client has never said which this is. |

## Category C — legacy or forward-looking, potentially required (3 tables)

Not dead, but not exercised today either. Each has a specific reason to stay.

| Table | Rows | Assessment |
| --- | --- | --- |
| `pos_integrations` | 0 | Read by `consumer.service` (to stamp `order_pos_context`) and by `showSync.service` (it is the sync's entry point). Empty only because no cinema has a POS configured yet. Four other tables hold foreign keys into it. **Keep.** |
| `order_pos_context` | 0 | Written by `consumer.service.createOrder` whenever the cinema has an active POS integration — which no cinema currently does, hence 0 rows. It is the per-order external-identifier record. **Keep.** |
| `cinema_categories` | 0 | Read on the consumer catalogue path and by `category.service`, and it is now where the **per-cinema category display order** lives. Empty means "no cinema has set an order yet", which sorts alphabetically — the behaviour every cinema has today. **Keep.** |

## Category D — unused, and a defensible removal candidate (2 tables)

Neither is referenced anywhere in `src/`. Both are still listed as candidates
rather than as removals, because both belong to a feature that is on hold, not
to a feature that was abandoned.

### `pos_transactions` — 0 rows

- **Why it appears unused:** a model exists (`models/postransaction.js`) but no
  service, controller, route or validator references `models.PosTransaction`.
  No migration since its creation touches it.
- **References found:** `models/postransaction.js`,
  `migrations/20260809002400-create-pos-transactions.js`, and a mention in the
  (now dropped) `shows` migration.
- **FK dependencies:** it holds FKs to `orders` and `pos_integrations`. **No
  table holds a FK into it**, so dropping it would break no other table.
- **Confidence that it is unused:** high.
- **Recommendation:** **do not remove yet.** It is the audit trail for pushing
  an order to a POS, which is precisely the half of POS integration that has
  not been built. Dropping it now buys nothing (0 rows, no queries, no
  constraint pressure) and would have to be recreated by the work that is on
  hold. Revisit only if POS integration is cancelled outright.

### `product_pos_mappings` — 0 rows

- **Why it appears unused:** identical situation. `models.ProductPosMapping` is
  referenced by nothing in `src/`.
- **References found:** `models/productposmapping.js`,
  `migrations/20260809002200-create-product-pos-mappings.js`.
- **FK dependencies:** FKs out to `pos_integrations`, `products` and `users`.
  **No table holds a FK into it.**
- **Confidence:** high.
- **Recommendation:** same as above — **retain while POS is on hold.**

`screen_pos_mappings` (0 rows) narrowly misses this category: it IS referenced,
by `showSync.service` and `src/pos/externalShow.js`. Category C by that fact
alone.

## Category E — cannot determine without the client (3 tables)

| Table | Rows | What is unclear |
| --- | --- | --- |
| `qbusto_timezone_migration` | 1 | Bookkeeping written by `20260830000100-store-qbusto-datetimes-as-ist.js` (an explicitly **not re-runnable** migration) and read by `scripts/tz-inventory.js`. It is the marker that says the one-time IST conversion has already happened. **Removing it would make that migration look un-run.** Whether it is still needed after go-live is an operational call, not a code one. |
| `qbusto_timezone_migration_backup` | 1107 | The pre-conversion copy of every converted datetime, from the same migration. It is the only record of what the values were before. **It is a backup and should be treated as one:** keep it until the client confirms the converted data is correct in production, then archive it deliberately rather than dropping it as "unused". |
| `SequelizeMeta` | 43 | Sequelize's own migration ledger. Never touch it by hand. Listed only for completeness. |

---

## What this audit did NOT do

- It did not drop, truncate or alter anything.
- It did not judge a table by row count alone. `pos_integrations`,
  `order_pos_context` and `cinema_categories` are all empty and all actively
  read.
- It did not extend to columns. Several tables carry columns nothing reads
  (`session` has none left, but `screens.category`/`seat_row` and much of
  `pos_integrations` qualify). A column-level audit is a separate exercise.
- It did not check the other database on the instance (`Vista_PopExpress`),
  which is out of scope.

## Summary

| Category | Count | Action |
| --- | --- | --- |
| A — actively used | 18 | None |
| B — client-owned / external | 2 | None; the client decides |
| C — legacy but required | 3 | None |
| D — unused, removal candidate | 2 | **Retain while POS integration is on hold** |
| E — cannot determine | 3 | Two are one-time-migration bookkeeping; ask before removing |

**There is no table this audit recommends dropping today.** The three that
genuinely were redundant — `film`, `shows`, `session_old` — were identified and
removed by the show-source work, each with its dependencies checked and its data
preserved or proven absent first.
