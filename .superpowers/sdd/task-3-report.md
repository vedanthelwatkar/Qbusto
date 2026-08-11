# Task 3 Report: OrdersPage.tsx

## What was implemented

- `dashboard/src/pages/OrdersPage.tsx` (new) — main Orders list page: server-side
  paginated/sorted/filtered table wired to `useOrdersStore`, filters for search,
  cinema, screen, order status, payment status and source, a permission gate on
  `Orders:read`, row-click / View button opening `OrderDetailsDrawer` (Task 4),
  and status/payment color-tag helpers.
- `dashboard/src/components/screens/ScreenSelect.tsx` (new) — did not exist in the
  codebase yet, despite CLAUDE.md/the plan listing it as an existing selector.
  Built it following `CinemaSelect`'s exact pattern (searchable, paginated,
  by-id lookup for an out-of-page value), scoped to `cinemaId` via
  `GET /api/screens`.
- `dashboard/src/stores/orders.store.ts` (bugfix, one-line) — it imported a
  `PaymentStatus` type from the generated schemas that does not exist there.
  The spec's `GetApiPaymentStatuses200.data` is typed as `OrderStatus[]`, i.e.
  payment statuses reuse the order-status master-row shape. Replaced the
  import with a local `type PaymentStatus = OrderStatus` alias. This was a
  pre-existing defect from Task 2 that made the whole workspace fail
  `tsc --noEmit`; fixed because it blocked verifying Task 3's own file.

## Deviations from the plan's literal code (and why)

The plan document's Task 3 code block did not match the actual generated
Orval types/patterns in this codebase. Per CLAUDE.md ("inspect the existing
implementation," "never invent fields/endpoints," "use generated types"), the
page was adapted rather than copied verbatim where the plan was simply wrong
about the contract:

- `hasPermission(actor?.permissions, 'Orders', 'canRead')` → actual signature
  in `utils/permissions.ts` is `hasPermission(user, moduleName, 'read'|'edit'|'delete')`.
  Used `hasPermission(actor, 'Orders', 'read'/'edit')`, matching every other
  page (`BannersPage`, `CategoriesPage`, etc).
- `PageHeader subtitle=...` → the component's prop is `description`, not `subtitle`.
- `pagination.currentPage` / `pagination.pageSize` → the generated `Pagination`
  type has `page` / `limit` / `total`. Followed `BannersPage`'s exact
  `pagination={{ current: pagination?.page ?? query.page, ... }}` pattern, and
  its single `handleTableChange` (page + sort together) instead of a second
  `handlePaginationChange`.
- `record.cinema.id` (required) / `record.screen.id` → `Order.cinema` is
  optional (`OrderCinema | undefined`) and `Order.screen` is nullable
  (`OrderScreen | null | undefined`); used optional chaining and dropped the
  plan's `cinemaNames`/`screenNames` Map workaround (the backend
  (`order.service.js` `serializeOrder`) already embeds `{id, code, name}` /
  `{id, name}` on every row, so no follow-up lookup is needed).
- `record.status.code` / `record.paymentStatus.code` → the backend flattens
  these to plain code strings on `Order` (`order.status`, `order.paymentStatus`)
  and puts the full row under `statusDetail`/`paymentStatusDetail`. Read
  `record.status` directly for the code and `record.statusDetail?.name` for
  the label.
- `ORDER_SORT_FIELDS` included `screenId`, which `GetApiOrdersSort` does not
  accept (`id | cinemaId | total | createdAt | updatedAt | deliveredAt`).
  Removed it.
- `ORDER_SOURCES` used `counter | kiosk | seatQr`; the generated
  `GetApiOrdersSource` enum is `qr | seat_qr | kiosk | counter`. Corrected the
  values and added `qr`.
- Column `title: 'Created'` renamed to `'Created At'` per the task's column
  spec.

Everything else (query fields, service functions used, statuses fetched once
in the store, filter set) follows the plan and the existing dashboard
patterns as-is.

## Out of scope, left untouched

- `dashboard/src/routes/modules.tsx` and `dashboard/src/routes/AppRoutes.tsx`
  already have an `/orders` nav entry (`implemented: false`) but no route
  wiring to `OrdersPage`. Wiring the route was not in Task 3's file list, and
  both files showed as modified by a concurrent process during this session
  (presumably Task 4's agent), so they were left alone to avoid clobbering
  that work. Whoever finishes the vertical slice needs to flip
  `implemented: true` and add `OrdersPage` to the `PAGES` map in
  `AppRoutes.tsx`.
- `dashboard/src/components/orders/OrderDetailsDrawer.tsx` — appeared during
  this session (Task 4, running concurrently). Its current TypeScript errors
  (undefined narrowing on `order.status`/`order.paymentStatus`, a
  non-existent `.code` on the status union types, a non-existent
  `OrderDetail.showName`, unused `loading` var) belong to that file/task, not
  Task 3. Confirmed via `tsc --noEmit` that none of the reported errors are
  in `OrdersPage.tsx`, `ScreenSelect.tsx`, or `orders.store.ts`.

## TypeScript output

Filtered to this task's files only:

```
$ npm run typecheck 2>&1 | grep -i "OrdersPage\|ScreenSelect\|orders.store"
(no output — clean)
```

Full `tsc --noEmit` output at commit time has 17 errors, all in
`src/components/orders/OrderDetailsDrawer.tsx` (Task 4's in-progress file,
not part of this task).

## Lint

`npx eslint` on the three touched files (`OrdersPage.tsx`, `ScreenSelect.tsx`,
`orders.store.ts`) is clean. One real issue was caught and fixed along the
way: `ScreenSelect.tsx` initially called `setState` synchronously in a
`useEffect` body (`react-hooks/set-state-in-effect`) when clearing options for
a missing `cinemaId`; moved that branch inside the existing debounce
`setTimeout` callback alongside the rest of the state updates.

## Concerns / import issues

- `OrderDetailsDrawer` is imported from `@/components/orders/OrderDetailsDrawer`
  as specified. Until Task 4 lands cleanly, `OrdersPage.tsx` cannot be
  compiled standalone — this is expected per the task sequencing but means
  the workspace build stays red until Task 4 is fixed up.
- `OrdersPage` passes `orderStatuses`/`paymentStatuses` (both `OrderStatus[]`,
  since `PaymentStatus` is now an alias of `OrderStatus`) to
  `OrderDetailsDrawer`. Task 4/5/6 should type their `paymentStatuses` props
  as `OrderStatus[]` too, not re-import a nonexistent `PaymentStatus` schema
  type.
- Routing: `OrdersPage` is not yet reachable from the UI (see "Out of scope"
  above).

## Commits

- `730a6e7` — `feat(orders): create OrdersPage with server-side list and filters`
  (`dashboard/src/pages/OrdersPage.tsx`, `dashboard/src/components/screens/ScreenSelect.tsx`,
  `dashboard/src/stores/orders.store.ts`)
