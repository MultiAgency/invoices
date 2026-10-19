# Invoices

Standalone contributor frontend for invoice submission/status, work-order requests, and contribution reports. Extracted from the Payables working tree with Proto's scoped payee behavior retained. Backend authentication, records, owner approvals and guarded execution remain in Proto.

## Local build and checks

Requires Node 24.22.0 (CI and the image pin it) and pnpm 12.14.0 (`packageManager`).

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm start
```

`pnpm start` stages `dist/` as a release and serves it with Proto's shared release server (`@multiagency/sdk` `release-server`) at http://127.0.0.1:3011. Set `PORT`, `HOST` or `RELEASES_ROOT` to change this; the default root is `.test-artifacts/local-releases`. The server has no authenticated API and needs no Proto configuration or credentials. For a working local product, run a simulated Proto backend with `INVOICES_FRONTEND_URL=http://127.0.0.1:3011` and open the **Proto payee origin**, not the asset origin. Never point development at a live executor.

**SDK modes.** The `@multiagency/sdk` dependency spec decides the mode:
- **Development:** `link:` to Proto's SDK directory.
- **Release candidate:** `file:vendor/multiagency-sdk-<version>.tgz`, with its `.sha256` and `.provenance.json`.

The drift test checks the tarball, lockfile integrity and provenance only on a release candidate. In both modes it checks every import and declared capability against the installed SDK.

`pnpm freeze` builds a candidate from the working tree's exact source: a git tree object of tracked and untracked files (minus `.gitignore`), written through a temporary index, so nothing is committed, stashed or moved. It's built in its own directory against the pinned tarball and staged read-only under `.test-artifacts/releases/<digest>/`. The provenance record holds the base commit, the tree and the changed paths. The tree is also kept as `<digest>.source.tar`, with a `.sha256` sidecar, so the recorded source survives `git gc` without a commit or ref. `pnpm verify-release <digest>` rebuilds from that tree (or from the archive when the tree object is gone), requires the same digest and an intact frozen directory, and lists where the working tree has changed since. Freezing, the Docker image and CI all refuse a `link:` with "dev link: build from a release candidate" (`scripts/release-mode.mjs`).

From the sibling Proto checkout, the isolated simulated-provider suite accepts this actual build:

```sh
node test/e2e/run.mjs --invoices-dist ../dao/invoices/dist payments.spec.mjs agent-access.spec.mjs
```

When entering through the DAO workspace symlink, use the unambiguous absolute build path `/Users/jlwaugh/agencies/dao/invoices/dist`.

## Release boundary

Build output is `dist/`: one complete, clean release. It contains one app page, `index.html`, which every entry (`/`, `/submit`, `/report`) declares, plus content-hashed bundles under `/invoice-ui/static/`, the payee skill `skill.md`, and `contract.json`. The app is React with TanStack Router and TanStack Query, the same stack as Payables and Treasury; its data layer is Proto's `payeeClient`, with reads not retried and mutations never retried. The contract declares the capabilities Proto checks plus the release `entries`, `strip` (scoped `/i/own-<24 hex>`) and `assetPrefix` used by Proto's shared release server. The release ships no server of its own. Its id is the digest of the directory; see `RELEASE-NOTES.md`.

The Dockerfile builds once and bakes that build as an immutable release in `/app/baked`. It runs the shared release server with only `HOST`, `PORT` and `RELEASES_ROOT`. `RELEASES_ROOT` (`/releases`) is meant to be a persistent volume. The entrypoint stages the baked release into it if it's missing, and activates it only when the volume has no active release, so a restart never overrides a rollback. Switching is `node /app/release-server.mjs activate <id>` against the volume. Earlier releases stay there, so pages opened before a switch keep their hashed assets. CI checks the build and browser journeys and uploads `dist/`. No deployment is configured.

Proto's integration checks the declared capabilities before serving HTML. It proxies presentation only; cookies and authorization headers never go to this service. Private calls remain same-origin with Proto. Once the backend integration is installed, this service can release independently without restarting Proto. Keep previous hashed assets available through rollout and rollback; serve a complete release atomically. Do not delete or migrate backend state for a UI update.

Public entries: `/` for invoice/work-order tasks and `/report` for contribution reports. Proto also serves them under `/i/own-<24 hex>/` with isolated sessions, recipient records and drafts. The app's assets use `/invoice-ui/static/`, separately from Proto's consent UI. Legacy Payables `/requests/pay-...` host bindings were not migrated; the new shared contract uses Proto's registered supplier instances.

## Validation and limits

Standalone build, typecheck, offline browser journeys and scoped/mobile checks pass. Proto's simulated-provider E2E passes invoice/owner-approval/settlement, lost responses, work-order requests, contribution-report review and shared agent access. No live credentials, owner actions, transfers or production deployment were performed. Browser tests use offline wallet/provider fixtures; source and built-asset tests are distinct.

This is an independent static frontend release, not yet an everything-dev Module Federation remote. No source checkout is needed at build/runtime. Contract schemas and payee types come from Proto's `@multiagency/sdk`, vendored as a pinned tarball in `vendor/` with its sha256 and provenance; update it only by vendoring a new reviewed tarball. Local UI components are intentionally owned snapshots; `source-provenance.json` is the historical extraction record of their upstream hashes.

See `../proto/docs/invoices-extraction.md` for the backend contract, permissions, state preservation and release instructions. The embedded Proto page remains a fallback only when no independent frontend origin is configured; frontend outages do not automatically switch products.
