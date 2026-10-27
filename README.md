# Invoices

Standalone contributor frontend for invoice submission/status, work-order requests, and contribution reports. Extracted from the Payables working tree with Proto's scoped payee behavior retained. Backend authentication, records, owner approvals and guarded execution remain in Proto.

## Local build and checks

Requires Node 24.22.0 (CI and the image pin it) and pnpm 12.14.0 (`packageManager`). Nothing else: a fresh clone installs, type-checks, builds and passes `pnpm test` with only those two, because the SDK is the vendored tarball in `vendor/`. (`pnpm test:browser` also needs Playwright's Chromium, installed by the command below.)

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
- **Default, and release candidate:** `file:vendor/multiagency-sdk-<version>.tgz`, with its `.sha256` and `.provenance.json`. This is what a fresh clone installs, so no sibling checkout is needed.
- **Opt-in development:** to work against a local SDK checkout, run `pnpm sdk:link [path]` (default `../sdk/packages/sdk`, the generated, git-ignored `packages/sdk` of a checkout of [MultiAgency/sdk](https://github.com/MultiAgency/sdk); run its `pnpm sdk:dev` once first), then `pnpm install --no-frozen-lockfile`. `pnpm sdk:vendored` switches back. Neither change is meant to be committed, and `pnpm freeze` and the Docker image refuse a link.

The drift test checks the tarball, lockfile integrity and provenance whenever the tarball is the dependency (the default). In both modes it checks every import and declared capability against the installed SDK.

`pnpm freeze` builds a candidate from the working tree's exact source: a git tree object of tracked and untracked files (minus `.gitignore`), written through a temporary index, so nothing is committed, stashed or moved. It's built in its own directory against the pinned tarball and staged read-only under `.test-artifacts/releases/<digest>/`. The provenance record holds the base commit, the tree and the changed paths. The tree is also kept as `<digest>.source.tar`, with a `.sha256` sidecar, so the recorded source survives `git gc` without a commit or ref. `pnpm verify-release <digest>` rebuilds from that tree (or from the archive when the tree object is gone), requires the same digest and an intact frozen directory, and lists where the working tree has changed since. Freezing and the Docker image refuse a `link:` with "dev link: build from a release candidate" (`scripts/release-mode.mjs`).

From a checkout of the backend repository (`MultiAgency/sdk`, formerly `proto`), its isolated simulated-provider suite accepts this actual build:

```sh
node test/e2e/run.mjs --invoices-dist ../invoices/dist payments.spec.mjs agent-access.spec.mjs
```

Pass the build path relative to that checkout, or an absolute path on your machine.

## Release boundary

Build output is `dist/`: one complete, clean release. It contains one app page, `index.html`, which every entry (`/`, `/submit`, `/report`) declares, plus content-hashed bundles under `/invoice-ui/static/`, the payee skill `skill.md`, and `contract.json`. The app is React with TanStack Router and TanStack Query, the same stack as Payables and Treasury; its data layer is Proto's `payeeClient`, with reads not retried and mutations never retried. The contract declares the capabilities Proto checks plus the release `entries`, `strip` (scoped `/i/own-<24 hex>`) and `assetPrefix` used by Proto's shared release server. The release ships no server of its own. Its id is the digest of the directory; see `RELEASE-NOTES.md`.

The Dockerfile builds once and bakes that build as an immutable release in `/app/baked`. It runs the shared release server with only `HOST`, `PORT` and `RELEASES_ROOT`. `RELEASES_ROOT` (`/releases`) is meant to be a persistent volume. The entrypoint stages the baked release into it if it's missing, and activates it only when the volume has no active release, so a restart never overrides a rollback. Switching is `node /app/release-server.mjs activate <id>` against the volume. Earlier releases stay there, so pages opened before a switch keep their hashed assets. CI runs typecheck, build, tests and browser journeys on every commit. A development commit is tested against the vendored tarball for that run only (`release-mode.mjs --use-vendored`), and only a release candidate's `dist/` is uploaded. No deployment is configured.

Proto's integration checks the declared capabilities before serving HTML. It proxies presentation only; cookies and authorization headers never go to this service. Private calls remain same-origin with Proto. Once the backend integration is installed, this service can release independently without restarting Proto. Keep previous hashed assets available through rollout and rollback; serve a complete release atomically. Do not delete or migrate backend state for a UI update.

Public entries: `/` for invoice/work-order tasks and `/report` for contribution reports. Proto also serves them under `/i/own-<24 hex>/` with isolated sessions, recipient records and drafts. The app's assets use `/invoice-ui/static/`, separately from Proto's consent UI. Legacy Payables `/requests/pay-...` host bindings were not migrated; the new shared contract uses Proto's registered supplier instances.

## Validation and limits

Standalone build, typecheck, offline browser journeys and scoped/mobile checks pass. Proto's simulated-provider E2E passes invoice/owner-approval/settlement, lost responses, work-order requests, contribution-report review and shared agent access. No live credentials, owner actions, transfers or production deployment were performed. Browser tests use offline wallet/provider fixtures; source and built-asset tests are distinct.

This is an independent static frontend release, not yet an everything-dev Module Federation remote. No source checkout is needed at build/runtime. Contract schemas and payee types come from Proto's `@multiagency/sdk`, vendored as a pinned tarball in `vendor/` with its sha256 and provenance; update it only by vendoring a new reviewed tarball. Local UI components are intentionally owned snapshots; `source-provenance.json` is the historical extraction record of their upstream hashes.

See `docs/invoices-extraction.md` in the backend repository ([MultiAgency/sdk](https://github.com/MultiAgency/sdk)) for the backend contract, permissions, state preservation and release instructions. The embedded Proto page remains a fallback only when no independent frontend origin is configured; frontend outages do not automatically switch products.
