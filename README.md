# Invoices

Standalone supplier frontend for invoice submission/status, work-order requests, and contribution reports. Extracted from the Payables working tree with Proto's scoped supplier behavior retained. Backend authentication, records, owner approvals and guarded execution remain in Proto.

## Local build and checks

Requires Node 24+ and pnpm 12.11.2.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm start
```

`pnpm start` serves public assets at http://127.0.0.1:3011. It deliberately has no authenticated API. For a working local product, run a simulated Proto backend with `INVOICES_FRONTEND_URL=http://127.0.0.1:3011` and open the **Proto supplier origin**, not the asset origin. Never point development at a live executor.

From the sibling Proto checkout, the isolated simulated-provider suite accepts this actual build:

```sh
node test/e2e/run.mjs --invoices-dist ../dao/invoices/dist payments.spec.mjs agent-access.spec.mjs
```

When entering through the DAO workspace symlink, use the unambiguous absolute build path `/Users/jlwaugh/agencies/dao/invoices/dist`.

## Release boundary

Build output is `dist/`: two HTML entries, browser module, content-hashed report assets and `contract.json`. The Node asset service has no production npm dependencies; Dockerfile packages only the built assets and server. CI checks the build and browser journeys and uploads a frontend artifact. No deployment is configured.

Proto's integration checks the declared capabilities before serving HTML. It proxies presentation only; cookies and authorization headers never go to this service. Private calls remain same-origin with Proto. Once the backend integration is installed, this service can release independently without restarting Proto. Keep previous hashed assets available through rollout and rollback; serve a complete release atomically. Do not delete or migrate backend state for a UI update.

Public entries: `/` for invoice/work-order tasks and `/report` for contribution reports. Proto also serves them under `/i/own-<24 hex>/` with isolated sessions, recipient records and drafts. Report assets use `/invoice-ui/static/`, separately from Proto's consent UI. Legacy Payables `/requests/pay-...` host bindings were not migrated; the new shared contract uses Proto's registered supplier instances.

## Validation and limits

Standalone build, typecheck, offline browser journeys and scoped/mobile checks pass. Proto's simulated-provider E2E passes invoice/owner-approval/settlement, lost responses, work-order requests, contribution-report review and shared agent access. No live credentials, owner actions, transfers or production deployment were performed. Browser tests use offline wallet/provider fixtures; source and built-asset tests are distinct.

This is an independent static frontend release, not yet an everything-dev Module Federation remote. No source checkout is needed at build/runtime. Contract schemas and local UI components are intentionally owned snapshots; `source-provenance.json` records upstream source hashes, and changes require compatibility checks rather than silently syncing concurrent work.

See `../proto/docs/invoices-extraction.md` for the backend contract, permissions, state preservation and release instructions. The embedded Proto page remains a fallback only when no independent frontend origin is configured; frontend outages do not automatically switch products.
