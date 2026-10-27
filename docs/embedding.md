# Embedding Invoices as a Module Federation remote

Invoices is still an independent static release (`pnpm build` → `dist/`, frozen and rolled back as in the deployment note (docs/deployment.md)). It is **also**
built as a Module Federation remote that a host app, such as the dashboard, can load. The two builds are separate: the remote never
touches `dist/`, its digest, `pnpm freeze` or the release server.

## Build

```sh
pnpm build:remote   # → dist-remote/ (remoteEntry.js, mf-manifest.json); git-ignored
```

The remote is named `invoices` and exposes **`./Invoices`**, which exports `mount(element, { apiBase })`. React and React DOM are singletons
the host provides. Config: `web/rsbuild.remote.config.ts`; entry: `web/src/remote.tsx`.

## Use from a host

```ts
const { mount } = await import("invoices/Invoices");   // remotes: { invoices: "invoices@<remote origin>/remoteEntry.js" }
const app = await mount(document.getElementById("slot")!, { apiBase: "/invoices-api" });
// later: app.unmount()
```

- **`apiBase` is a path on the host's own origin** (`/invoices-api`, `/a/b`). The host serves or proxies the payee routes there (`/api/session`,
  `/api/invoices`, ...) to the gateway. A full URL, a host, `..` or a query is refused with an error.
- **No cookies or authorization headers cross origins.** The app can only call same-origin paths, so the host's own session reaches the gateway
  through the host's proxy and nothing is shared between origins. Signing a wallet message and every owner approval are unchanged.
- **Navigation is in memory.** The app never rewrites the host's URL; deep links such as `?workOrder=<id>` are not available inside an embed.
- **One base per page.** The base is read once, when the app's modules first load. Mounting a second time with a different base is not supported.
- The optional `?project=<id>` reference (the contributor-link note (docs/contributor-link.md)) is read from the host page's query string.

## Tests

- `test/embed.test.mjs`: the base-path validation, and that the federation build exposes `./Invoices` and shares React as singletons.
- `test/browser/remote.cjs`: a stand-in host app (`test/remote-host/`) loads the remote from its own origin; Invoices renders in the host's slot, every
  request stays on the host origin with the session call under the host's base, and the host URL is unchanged.
- The standalone suites (`test:browser` runs them with the remote test) and `pnpm freeze` are unaffected.

## Not done

- No real host has loaded it. The dashboard must choose embedding (MultiAgency/dashboard#78, MultiAgency/treasury#1) and proxy the payee routes on its origin.
- Hosting the remote's files (a stable URL or CDN, integrity, versioning against the host) is not set up; the standalone release's immutable, content-hashed
  model is not yet applied to `dist-remote/`.
- Theme and styling follow the app's own CSS; the host's theme is not applied.
