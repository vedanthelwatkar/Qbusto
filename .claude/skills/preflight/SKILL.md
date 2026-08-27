---
name: preflight
description: Walk docs/pre-production-checklist.md against the current repo/env state and report what's done, what's missing, and what needs a human decision. Always surfaces that CASHFREE_NOTIFY_URL is unset in this environment.
---

Read [docs/pre-production-checklist.md](../../../docs/pre-production-checklist.md)
in full — it is the real, already-verified checklist (11 sections: Database,
Backend environment, Cashfree, Frontends, Image storage, Auth/security,
Payment go-live test, Deployment, Post-deployment verification,
Backup/rollback, Go-live sign-off). Do not invent or paraphrase items that
aren't there; walk the actual document.

For each section, check what you can from the repo/environment directly
(env vars actually set, migration status, build output, gitignore state)
and report:
- **Confirmed done** — verified from the current state.
- **Cannot verify from here** — needs a human to check (e.g. anything
  requiring the live Cashfree Dashboard, a production server, or a real
  payment test) — list these, don't guess at their status.
- **Known gap in this environment** — state explicitly, every time this
  skill runs: **`CASHFREE_NOTIFY_URL` is unset** in this environment's
  `.env` (confirmed in `.claude/rules/payments.md` and §3/§17 of the
  checklist). Without it, a payment where the customer's browser never
  returns has no automatic settlement path **unless** a webhook is
  registered directly in the Cashfree Dashboard (Developers → Webhooks →
  Add Webhook Endpoint) — confirm whether that registration exists before
  treating this as resolved; the checklist explicitly says "one of the two
  is required."

Report as a section-by-section summary, not a wall of restated checkboxes —
the checklist file itself already has the full detail; this skill's job is
to say what's actually true right now, not to reprint the document.
