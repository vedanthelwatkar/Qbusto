---
name: security-review
description: Adversarial security review of a diff against QBusto's payment/coupon invariants and the bug class from the §8.16 adversarial review. Argument is a branch name or path (defaults to the working diff if omitted).
argument-hint: "[branch-or-path]"
---

Diff under review:

!`git diff $ARGUMENTS`

Review the diff above against [checklist.md](./checklist.md) in this
skill's directory. The checklist is built from two sources: the two real
findings in memory.md §8.16 (an adversarial review that found a live
BLOCKER), and the payment invariants also checked by the
`payment-invariant-auditor` subagent.

For anything the diff touches under `backend/src/routes/`,
`backend/src/services/paymenttransition.service.js`,
`backend/src/services/paymentwebhook.service.js`,
`backend/src/services/cashfree.client.js`, `backend/src/services/
coupon.service.js`, or any `*.validators.js`, go through the checklist item
by item and state PASS / VIOLATION / N/A with the specific line as
evidence — don't skip an item because it seems unlikely to apply; state N/A
explicitly instead.

Report findings only — do not fix anything as part of this skill. If the
diff is empty (nothing to review), say so plainly.
