/** Invoices loaded as a Module Federation remote inside a host app, with every call staying on the host's origin. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');
const { runTask } = require('./fixtures/task.cjs');
const { installWallet } = require('./fixtures/wallet.cjs');

const HOST = 'https://host.test', REMOTE = resolve('dist-remote'), HOSTED = resolve('.test-artifacts/remote-host');
for (const [dir, script] of [[REMOTE, 'scripts/build-remote.mjs'], [HOSTED, 'scripts/build-remote-host.mjs']])
  if (!existsSync(join(dir, dir === REMOTE ? 'remoteEntry.js' : 'index.html'))) {
    const built = spawnSync(process.execPath, [script], { stdio: 'inherit' });
    if (built.status !== 0) { console.error(`${script} failed`); process.exit(1); }
  }
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2' };
const file = (route, root, path) => route.fulfill({ path: join(root, path), contentType: TYPES[extname(path)] ?? 'application/octet-stream' });

async function embedded(browser) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }); await installWallet(page);
  page.setDefaultTimeout(8000);
  const seen = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: { version: '1.0.0', wallets: [] } });
    seen.push(url.origin + url.pathname);
    if (url.origin !== HOST) return route.abort();
    if (url.pathname.startsWith('/remote/')) return file(route, REMOTE, url.pathname.slice('/remote/'.length));
    if (url.pathname.startsWith('/invoices-api/')) {
      const api = url.pathname.slice('/invoices-api'.length);
      if (api === '/api/session') return route.fulfill({ json: { account: null, agreed: false } });
      return route.fulfill({ status: 404, json: { error: 'unexpected' } });
    }
    return file(route, HOSTED, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  });
  await page.goto(HOST + '/');
  await page.locator('#host-title').waitFor();
  // The remote's own page renders inside the host's slot.
  await page.locator('#invoices-slot').getByRole('button', { name: 'Sign in with NEAR' }).waitFor();
  assert.equal(await page.locator('#host-error').count(), 0, 'the host reported no load error');
  assert.ok(await page.locator('#invoices-slot').getByText('MultiAgency').first().isVisible());
  // Same origin only, and the app's calls go under the host's base; the host's URL is not rewritten.
  assert.ok(seen.every(u => u.startsWith(HOST)), 'every request stayed on the host origin: ' + seen.filter(u => !u.startsWith(HOST)).join(', '));
  assert.ok(seen.some(u => u === HOST + '/invoices-api/api/session'), 'the session call used the host base');
  assert.equal(new URL(page.url()).pathname, '/', 'the host URL is unchanged');
  assert.deepEqual(errors, [], 'no page errors');
  await page.close();
  console.log('PASS federation remote: Invoices renders inside a host app, calls stay on the host origin under its base, and the host URL is untouched');
}

runTask([embedded]);
