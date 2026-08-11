# Task 1: Create orders.service.ts - Report

## Implementation

Created `dashboard/src/services/orders.service.ts` as the API communication layer wrapping the generated Orval client.

### Key Details

**File:** `dashboard/src/services/orders.service.ts`

**Functions Exported:**
- `listOrders(params: GetApiOrdersParams): Promise<OrdersPage>`
- `getOrder(id: number): Promise<OrderDetail>`
- `updateOrderStatus(id: number, status: PutApiOrdersIdStatusBodyStatus): Promise<Order>`
- `updatePaymentStatus(id: number, paymentStatus: PutApiOrdersIdPaymentStatusBodyPaymentStatus): Promise<Order>`
- `getOrderStatuses(): Promise<OrderStatus[]>`
- `getPaymentStatuses(): Promise<OrderStatus[]>`

**Architecture:**
- All API communication via generated Orval functions from `@/api/generated/orders/orders` and `@/api/generated/order-statuses/order-statuses`
- Envelope unwrapping following pattern from `pricing.service.ts` and `users.service.ts`
- Error handling via `MALFORMED` ApiError constant
- No handwritten URLs, query parameter types, body types, or response types

## Verification

### TypeScript Compilation
```
npm run typecheck 2>&1 | grep -A2 orders.service.ts || echo "OK"
```
Result: **OK** - No TypeScript errors

## Technical Adjustments

During implementation, fixed schema mapping issues:
- Used `PutApiOrdersIdStatusBodyStatus` enum type (not string) for status parameter
- Used `PutApiOrdersIdPaymentStatusBodyPaymentStatus` enum type (not string) for payment status parameter
- Payment statuses endpoint returns `OrderStatus[]` not separate `PaymentStatus[]` type
- Renamed imported `getOrderStatuses` factory to `getOrderStatusesApi` to avoid naming conflict with exported function

## Commit

```
839e020 feat(orders): create API service wrapping generated Orval client
```

## Status

**DONE** - Task 1 complete. Service compiles with no TypeScript errors and follows established patterns.
