const { join } = require('node:path');

/**
 * Serves the built release as Proto's gateway and release server do: every declared entry (/, /submit,
 * /report, with or without a scoped /i/own-<24 hex> base and trailing slash) is index.html, and hashed
 * assets come from /invoice-ui/static/. near-connect's pinned wallet list is answered empty, so only the
 * injected test wallet is offered. Returns the route's handling, or null for a payee API request.
 */
function serveRelease(route, root) {
  const url = new URL(route.request().url());
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: { version: '1.0.0', wallets: [] } });
  if (url.hostname !== 'invoice.test') return route.abort();
  const path = url.pathname.replace(/^\/i\/own-[a-f0-9]{24}(?=\/|$)/, '') || '/';
  if (path.startsWith('/invoice-ui/static/')) return route.fulfill({ path: join(root, path.slice('/invoice-ui'.length)) });
  if (['/', '/submit', '/submit/', '/report', '/report/'].includes(path)) return route.fulfill({ path: join(root, 'index.html'), contentType: 'text/html' });
  return null;
}
/** The payee API path a fixture answers, without the scoped base. */
const apiPath = route => new URL(route.request().url()).pathname.replace(/^\/i\/own-[a-f0-9]{24}(?=\/)/, '');
module.exports = { serveRelease, apiPath };
