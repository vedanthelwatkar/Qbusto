---
paths:
  - backend/src/services/coupon.service.js
  - backend/src/services/offer.service.js
  - backend/src/controllers/offer.controller.js
  - backend/src/routes/offer.routes.js
  - backend/src/validators/offer.validators.js
  - backend/src/validators/consumer.validators.js
  - backend/models/offer.js
  - dashboard/src/pages/OffersPage.tsx
  - dashboard/src/components/offers/OfferFormModal.tsx
  - consumer/src/components/CheckoutDrawer.tsx
---

# Coupons — pure QBusto, no Cashfree involvement

A coupon (`offers` table, Dashboard's **Offers** tab) is validated and
applied **entirely within QBusto**. The customer enters a code in the
Consumer app's cart ("Apply coupon" in `CheckoutDrawer`), which previews it
via the coupons/validate endpoint (see [payments.md](./payments.md)); at
order creation the code is re-validated server-side
(`services/coupon.service.validateCoupon`) against a subtotal QBusto itself
computed from `product_pricing` — never a client-supplied figure — and the
discount is subtracted into `orders.total` **before `payment-init` is ever
called**. Cashfree is handed only the final, already-discounted amount and
has no discount/offer concept in this flow at all.

An EARLIER version of this tried mirroring QBusto coupons into Cashfree's own
offer system (`order_meta.offer_filters` as an ALLOW list at `payment-init`,
`CASHFREE_APPROVED_OFFER_CODES` / `offers.cashfree_offer_id` at
reconciliation). The user's explicit instruction reversed this completely:
"WE ARE NOT LETTING ANY COUPONS APPLY ON CASHFREE WE ARE REVERTING TO THE
STRICT ARCH WE HAD BEFORE" — while explicitly keeping the per-cinema
credentials work: "but we have to keep the different id and secret key per
cinema in our db as we were doing we just have to revert the changes we did
for handling coupons in cashfree." Deliberately reverted because it meant a
third party could ultimately decide what a customer owed — a demo offer
observed in Cashfree's own sandbox (`testRetoolTPAPUPIoffer`, redeemable
despite existing nowhere in the merchant's own Offers dashboard) showed that
is not safe to trust. See memory.md §8.6/§8.15 for the full history.

- `offers.discount_type` is free text but has a **defined meaning**:
  `'percentage'` (case-insensitive) treats `disc_amount` as a percent of the
  cart, capped by `max_disc_amount` if set (the Dashboard form only shows
  "Max discount amount" for a percentage coupon — meaningless for a flat one);
  **anything else, including `'flat'`, is a flat rupee amount** — chosen as
  the default specifically so a coupon created without thinking hard about
  this field behaves as the less-surprising "flat" interpretation. A
  discount is always capped at the subtotal itself — `consumer.service
  .createOrder` clamps `productDiscount + couponDiscount` at the subtotal
  before computing `total`, so two independently-capped discounts (a
  promotional price plus a coupon) can never sum past it and make an order
  negative. `offer.validators.js` normalises `discount_type` to lower case
  on every write (like `status`); every **reader** of it still compares
  case-insensitively too, as defence for rows written before this existed —
  a code review caught `OfferFormModal.tsx` doing an exact-case comparison
  and silently nulling `max_disc_amount` on an unrelated edit for any row
  that wasn't already lower case.
  `offers.offer_category`/`payment_modes` — leftover vocabulary from the
  abandoned Cashfree-offer-mirroring design, never read by any calculation —
  were dropped from the database entirely
  (`20260825000700-drop-unused-offer-fields.js`).
- Validated: `status` must be `'active'`; `valid_from`/`valid_until` window;
  `min_txn_amount`/`max_txn_amount` gate eligibility; `max_txn_limit` caps
  total redemptions, counted only from **paid** orders (an abandoned or
  pending attempt never took the coupon's slot). **Known accepted race:**
  the limit is checked at **order-creation** time, not at payment-settlement
  time (it inherently cannot be, without refusing to honour a payment
  Cashfree already actually collected — see `paymenttransition.service.js`'s
  CAS design, which settles unconditionally once money has moved), so two
  near-simultaneous checkouts can both pass the check and both later pay,
  over-redeeming a hard `max_txn_limit` by at most the number of orders
  racing at that instant — a coupon's `max_txn_limit` is a soft cap, not a
  hard guarantee, the same tradeoff most e-commerce coupon systems make.
  Distinct in kind from the payment-amount matching in payments.md, which
  has zero tolerance by design.
- `orders.offer_id` (nullable FK, `NO ACTION`) records which coupon an order
  used, for redemption counting and audit — frozen at order creation and
  never changed afterward, the same way `filmTitle`/`showTime` freeze what an
  order was actually placed against. Deleting a coupon that has ever been
  redeemed is refused with a 409 (`services/offer.service.deleteOffer`) —
  deactivate it (`status: 'inactive'`) instead.
- A coupon that discounts an order to **exactly zero** is handled by
  `payment-init` itself — see discovery path 4 in
  [payments.md](./payments.md) — not by this module. Calling Cashfree's
  `PGCreateOrder` with `order_amount: 0.00` is rejected outright (verified
  live: a real 400 from Cashfree), so the zero-total short-circuit exists
  specifically to avoid ever sending Cashfree a zero amount.
- **Dashboard**: `OfferFormModal.tsx` field set — code, name, discountType,
  description, tnc, status, discAmount, maxDiscAmount, minTxnAmount,
  maxTxnAmount, maxTxnLimit, validFrom/validUntil. `maxDiscAmount` is shown
  only when `discountType` is `'percentage'`, and cleared automatically when
  switching away from percentage so a stale value can't be silently
  submitted.
- **§8.16 BLOCKER, fixed same day (for context — the empty-items guard lives
  in `consumer.validators.js`, shared scope with payments.md):** an
  independently-capped-discounts bug meant `productDiscountPaise +
  couponDiscountPaise` could sum past the subtotal and push `totalPaise`
  negative before the fix in `consumer.service.createOrder`:
  `discountPaise = Math.min(productDiscountPaise + couponDiscountPaise,
  subtotalPaise)`, plus a belt-and-suspenders `if (totalPaise < 0) throw new
  ValidationError(...)` immediately after. `coupon.service.js` itself was
  untouched by this fix — the cap is a call-site concern in
  `consumer.service.createOrder`, not in the coupon module.
