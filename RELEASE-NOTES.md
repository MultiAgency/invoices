# Release notes

Each release is a complete, immutable build directory, identified by the Proto runner's `digest()`.
Local candidates only; nothing has been published or deployed.

## Release I (in preparation; no digest yet)

After a definitive refusal, an invoice whose amount or note the contributor changes goes out under a new submission identity; an unchanged retry, and any resubmission after an unknown, session or forbidden outcome, keeps the original. The step script (`workflow/payee.mjs`) now classifies Proto's answers as the page does: a 5xx, unreadable or wrong-shape answer is unknown and resumable, 401 and 403 keep the identity, and only another 4xx is a refusal. Built on `@multiagency/sdk` 0.1.0: a report shows the owner's approved amount as its compensation, and a requested amount reads as "requested" until approved. Failed browser scenarios keep their error, page logs and screenshots under `.test-artifacts/browser-failures/`.

## c1032433 (release H)

Product copy says "contributor" instead of "supplier"; requesting terms doesn't make someone a payee, a signed agreement does. The code, the step script (now `workflow/payee.mjs`, reading the stack's `payee` origin) and the platform package (`@multiagency/sdk` 0.0.1, `./payee`) all say payee. `/skill.md` now leads with one worked outcome: a contributor's agent submits a report and follows it to its payment record. Agent connections now carry `role: "payee"` on the wire, so G and earlier aren't rollback targets.

## 74c99424 (release G)

- **Agent connections for contribution reports.** On the report page, once signed in with their wallet, a contributor can connect their own agent (for example a coding agent) to their reports on this entry. They can also list and revoke those connections. The page:
  - shows exactly what a connection can do, from the connection's own permissions: read their reports, feedback and payment status, and submit and revise their reports;
  - states what it cannot do: file invoices or work orders, request payouts, approve, prepare or pay, see other contributors' records, reach another entry, host or the owner's workspace, sign in as them in a browser, or start or revoke connections;
  - shows the token once and never stores it.
- The control appears only when the platform advertises `supplier-agent-connections-v1`. Proto issues, scopes, expires, revokes and attributes connections; Invoices holds no credential.
- `/skill.md` explains how an agent uses a connection with Proto's supplier client, how to keep the token secret, and how to recover from lost replies without replacements.
- Contract 1.5.0 (sha256 `c2834a9e…7e39`), still through the zod-only `./supplier` entry.
- Local and simulated only: no live credentials and no deployment.
  - New: an optional capability and the `/api/agent-connections` routes on platforms that offer them. `contract.json` lists the capability under `optional`, so platforms without it still serve this release, and the page simply hides the control.
  - Consumer action: none.

## c0f7cae3 (release F)

- **Typed supplier contract, the way the owner apps use theirs.** Invoices imports only `@multiagency/proto-contract/supplier` (contract 1.4.0, sha256 `b8147cdf…8382`), a zod-only entry with no oRPC or AG-UI dependency.
  - One app-owned TanStack Query adapter (`web/src/app/queries.ts`) defines every supplier read and command. Keys are `[route, instance, account, …ids]`; reads are not retried, and commands are never retried and keep their caller's identity.
  - This shape was agreed with Proto: no Proto-side Query adapter for a single consumer.
- The build checks reject any import of the contract's root entry or owner modules, so owner procedures stay unreachable from Invoices.

## e31978a7 (release E)

- **Invoices is one React app** on the same stack as Payables and Treasury: React 19, TanStack Router and TanStack Query, built with rsbuild and styled with Tailwind and the shared components.
  - The invoice tasks (`/`, `/submit`, with `?workOrder=<id>`) and contribution reports (`/report`) are routes of one page, at the root intake or under a scoped `/i/own-<24 hex>` base, with or without a trailing slash.
  - The release declares all three entries as `index.html`. No gateway change was needed.
- **One sign-in covers both** invoice and report tasks on an instance (Proto issues one supplier session). Signing out or switching accounts clears every cached record of the previous account. Drafts stay saved per account, under the same storage keys as before, so drafts saved under D load in E.
- **Data comes through Proto's `supplierClient`** behind TanStack Query. Reads are not retried or refetched on focus; mutations are never retried.
  - Identity handling is unchanged: submission and command identities are retained; lost or unreadable answers stay unknown; 401 and 403 read differently.
  - A late answer, or a late 401 or 403, for an earlier account never affects the current one.
- The wallet connector is the bundled `@fastnear/near-connect`, still using the pinned wallet list. The invoice page's old separately built module and `contributor.html` are gone.
- **Toolchain:** Node 24.22.0 (CI and image), pnpm 12.14.0 (`packageManager`), `@types/node` 24.19.2, Playwright 1.64.1.
  - `@tanstack/react-query` stays at 5.104.3: pnpm 12.14's release-age policy rejects 5.104.4, published 2026-10-17, until it is a day old.

## 397217d7 (release D)

- **Both pages use Proto's platform client** (`supplierClient`, `@multiagency/proto-contract` 1.2.2, sha256 `b6b3ee2f…c12d`) for every supplier call, replacing their own fetch and error handling.
  - Answers are validated against the contract.
  - An expired session (401) and a refused account (403) read differently. Both hide private records and keep drafts.
  - A lost, failed (5xx) or unreadable answer to a submission is an unknown outcome. The page keeps the draft and its submission or command identity, also across a reload, and never sends a replacement. A deliberate retry resends the same identity.
- The invoice page's module is now built and bundled as one content-hashed ES module, with the client inside. The wallet connector still loads from its pinned CDN address.
- Work-order requests are checked against the contract before anything is saved or sent.
- Build checks now verify that the vendored contract is pinned (sha256, lockfile integrity) and comes from a clean Proto snapshot. They also verify that everything this release declares and imports exists in that pinned version.

## 2f483771 (release C)

- **Supplier onboarding skill at `/skill.md`.** Invoices now owns contributor and supplier onboarding (user decision).
  - The skill (`multiagency-builder-onboarding`) is adopted from Payables' contributor copy at `97ddec7`. It is updated to describe the supplier host: the supplier pages and endpoints relative to the entry, payment-status meanings matching release B, and the owner side in Payables.
  - The report page's "For your coding agent" link now points to the host-relative `/skill.md`, so the report bundle changes.
  - Served as `text/markdown` from the active release only, with no fallback copy.
- **No server of its own.** The release now holds only its pages, hashed assets, `skill.md` and `contract.json`. It is served by Proto's shared release server (`@multiagency/proto-contract` 1.2.0, sha256 `5847245c…b3b8`), which the Dockerfile and `pnpm start` run with only `HOST`, `PORT` and `RELEASES_ROOT`.
  - The previous `server.mjs` and the unreferenced legacy `invoice-browser.js` are removed. A page opened under an older release that still asks for `/invoice-browser.js` gets 503 from Proto's gateway; those pages had already loaded their module.

## 549e34c5 (release B)

- **Payment status on the report page now explains each state.**
  - Before, a contributor saw raw codes such as "Payment status: waiting.", "paying." or "preparation incomplete", and "Do not submit a replacement request" appeared even after the payment was paid.
  - Now each status Proto reports reads as a sentence. Approval is never presented as payment: "Waiting for the owner to approve the payout. Approval is not payment." and "Approved. The payment is processing; settlement is not yet confirmed."
  - The replacement warning, shown as a warning alert, appears only while the outcome is unproven (unknown, needs review, failed).
  - This changes the hashed report bundle (`contributor.9b67d6c501.js`).
- **Both pages share one title**, "Invoices | MultiAgency". The invoice page was titled "Invoices".
- Unchanged: the "For your coding agent" link still points to the contributor skill on the Payables host. Where that skill should live is an open ownership question.

## e12c047c (release A)

- The first clean, reproducible build: `dist/` is emptied before each build. Earlier local builds (`6881b968`, `bc7acf3f`, `601ab2b2`) carried unreferenced bundles from previous builds.
- The invoice page's module is content-hashed (`/invoice-ui/static/js/invoice-browser.<hash>.js`). An unreferenced legacy `invoice-browser.js` stays only while Proto's gateway names it.
- Contract schemas and supplier types come from the vendored `@multiagency/proto-contract` 1.1.0.
- `contract.json` declares release `entries`, `strip` and `assetPrefix` for Proto's shared release server.
- The release still includes its own `server.mjs` for the current delivery path.
