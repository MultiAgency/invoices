# Linking a payee to a dashboard contributor

## Decision

**The NEAR account id is the one key** that identifies a contributor across Invoices and the dashboard. Invoices treats the signed-in
account as the payee; the dashboard's contributor model is keyed by the same account (`project_contributors.near_account`). Nothing
else joins them, and nothing in Invoices stores a dashboard id.

## Optional project reference

A work-order request may name the project it belongs to, supplied by the host or link: `?project=<id>`.

- `web/src/shared/project.ts` reads it. Only a plain identifier is accepted (letters, digits, `_` and `-`, up to 64 characters, given once);
  anything else is ignored.
- The reference says which project or budget a request is for. It is **never used for access**: records are returned only to the
  signed-in account that owns them, with or without a project.
- The request form shows "For project <id>" and sends the id **only when the platform contract declares a `project` field** on
  `payeeWorkOrderRequest`. That schema is strict, so a field it does not declare would be refused. With the current contract (`@multiagency/sdk` 0.1.0)
  it does not, so today the reference is read but neither sent nor shown. Tests: `test/project-ref.test.mjs`.

## What the other repositories must do

This repository can only carry the reference. The rest is backend and dashboard work:

1. **`@multiagency/sdk`:** add an optional `project` string to `payeeWorkOrderRequest` (and to the work-order view the owner and contributor read),
   then release it. Until then the form sends nothing.
2. **Payables backend:** store `project` with the work-order request and show it to the owner on review.
3. **Listing by account:** the dashboard lists a contributor's invoices and work orders by NEAR account through the gateway's agreed API
   (MultiAgency/sdk#3 and dashboard#78). Invoices has no records of its own to list.
4. **Isolation test:** that one account cannot read another account's records is enforced and tested in the gateway and backend.
   This repository's scoped browser journey (`test/browser/scoped.cjs`) checks the frontend only shows the signed-in account's records.

## Status

Frontend reading and form wiring are done and tested offline. Storing, showing to the owner, and listing from the dashboard are not.
