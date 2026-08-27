---
paths:
  - dashboard/src/**/*.tsx
---

# Ant Design form pitfalls (Dashboard)

## Required-field asterisks

Don't set `requiredMark={false}` on a Dashboard `<Form>` — it hides every
field's asterisk, not just the ones that shouldn't have one. antd derives
the asterisk directly from the field's own `rules={[{required: true, ...}]}`
— leave the prop off entirely and let antd derive it. Every form in the
Dashboard (13 of them: `BannerFormModal`, `CategoryFormModal`,
`ChainFormModal`, `ChangePasswordModal`, `CinemaFormModal`,
`CinemaPaymentGatewayModal`, `LoginPage`, `OfferFormModal`,
`PricingFormModal`, `ProductFormModal`, `ScreenFormModal`,
`AvailabilityFormModal`, `UserFormModal`) had this fixed by simply removing
the prop — zero validation behaviour changed, display-only.

## The label `::after` trap

Don't fight antd for a form label's `::after` — it's already used
unconditionally for the trailing colon (`form/style/index.js`), colon
visible or not, `layout="vertical"` or not. Only `::before` is free on that
element; use `order` (the label is `inline-flex`) to reposition it instead
of relocating content into `::after`. Verified live via
`node_modules/antd/es/form/style/index.js` and the browser's own inspector,
not assumed.

Two wrong theories were tried and shipped first, each individually
plausible:
1. Hide antd's `::before` asterisk and render a new one on `::after` —
   nothing showed at all, because the label's own trailing-colon `::after`
   (`content: ":"`, unconditional unless `colon={false}`, which none of
   this app's forms pass) wins outright — only one `::after` can exist on
   an element, this isn't a specificity fight `!important` can win.
2. Assumed the colon was suppressed by `layout="vertical"` and reached for
   `.ant-form-item-no-colon::after` instead — but `no-colon` is controlled
   by the `colon` **prop** being `false`, not by vertical layout (vertical
   layout only skips stripping a trailing ":" character a caller typed into
   a string label). That class is never applied here, so this matched
   nothing — confirmed by inspecting the live DOM (the class list was
   plainly just `ant-form-item-required`), not by more guessing.

Working fix: leave `::after` (the colon) alone entirely, and reorder the
**existing** `::before` asterisk instead — the label is `display:
inline-flex`, so `::before`/`::after` are flex items and obey `order` like
any other child. `.ant-form-item-required::before { order: 1;
margin-inline-start: 4px; }` moves the asterisk after the text without
touching what `::after` renders. The colon's own box was still visible
space even though colon isn't rendered as a visible ":" in this app's own
screens, so `.ant-form-item-required::after { content: none !important;
margin: 0 !important; }` was added too, scoped to required fields only so
optional fields' colon (never reported as a problem) is untouched.

**Lesson for next time a pseudo-element fight comes up:** read the actual
library CSS-in-JS source for the real selector and the real property
before writing an override, and confirm the applied class list in the
browser's own inspector before assuming why something isn't matching.
