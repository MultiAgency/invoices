# Deployment

**Status: not deployed.** Nothing here has been published or run on a hosted target. This page is the intended setup and the
procedure to follow once a target is chosen. Items marked *to confirm* are proposals for the maintainers, not facts.

## Intended URL and owner

- **URL:** `https://invoices.multiagency.ai` (the supplier-facing entry named in the Payables docs).
- **How it is reached:** the Proto gateway serves the host and proxies **presentation only** to this service. Private calls stay
  same-origin with the gateway; cookies and authorization headers never reach this service, which holds no credential.
  Gateway-side configuration is in the backend repository's `docs/invoices-extraction.md` and `docs/shared-frontend-integration.md`.
- **Who deploys:** the MultiAgency maintainers who operate the gateway (*to confirm*). This repository ships an immutable release; the gateway owners point their host at it.

## What runs

One container from the `Dockerfile`: the shared release asset server (GET/HEAD, no API, no outbound calls).

| Setting | Value |
|---|---|
| `HOST` | `0.0.0.0` (image default) |
| `PORT` | `8080` (image default) |
| `RELEASES_ROOT` | `/releases`, a **persistent volume** holding every staged release plus `ACTIVE` and `HISTORY` |
| Secrets | None |

The service keeps no data other than the releases on that volume, so there is nothing to migrate or back up beyond it.

## Release

1. Build a release candidate: `pnpm freeze` (records the exact source tree and prints a release id).
2. Check it: `pnpm verify-release <id>` rebuilds from the recorded source and requires the same digest.
3. Images are built only from a release candidate (the vendored SDK tarball). A development `link:` SDK stops the build.

## Deploy

1. Build the image from the release candidate and deploy it with the volume mounted at `/releases`.
2. On start the entrypoint stages the baked release into the volume. An **empty** volume activates it. A volume that already has an
   `ACTIVE` release **keeps it**: a deploy or restart never overrides a rollback, and switching is always explicit.
3. To switch to the new release, run inside the container: `RELEASES_ROOT=/releases node /app/release-server.mjs activate <new id>`.
   `activate` verifies the release before switching `ACTIVE` atomically.
4. Check that the host serves the app page at `/` and `/report`.

## Rollback

`RELEASES_ROOT=/releases node /app/release-server.mjs activate <previous id>`. Every earlier release stays on the volume and
`HISTORY` lists the activated ones, so rollback needs no rebuild. Pages opened before a switch keep their content-hashed assets,
because the server serves assets from earlier activated releases too. Rolling back changes nothing the contributor stored: their
records live in the gateway's backend, not here.

## Not done

- No hosting target, volume or DNS is set up, and there is no deploy workflow (`.github/workflows/ci.yml` only tests).
- The repository description and topics are not set. Setting them needs admin rights on the repository. Proposed:
  - Description: `Contributor frontend for MultiAgency: invoices, work-order requests and contribution reports, served behind the Proto gateway.`
  - Topics: `near`, `multiagency`, `invoices`, `payments`, `react`, `frontend`.
