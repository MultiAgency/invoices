const assert = require('node:assert/strict');
const { runTask } = require('./fixtures/task.cjs');
const { assertResponsive } = require('./fixtures/layout.cjs');
const { serveRelease } = require('./fixtures/release.cjs');
const { installWallet } = require('./fixtures/wallet.cjs');
const { assertAccessWords } = require('./fixtures/access.cjs');

const base = '/i/own-' + 'a'.repeat(24);

/** One owner's scoped entry: every route resolves under its base, and every call stays within it. */
async function scopedPayee(browser, root) {
  for (const [path, landmark] of [['', 'Request a work order'], ['/', 'Request a work order'], ['/submit', 'Request a work order'], ['/submit/', 'Request a work order'], ['/report', 'Report. Review. Receive.'], ['/report/', 'Report. Review. Receive.']]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await installWallet(page);
    const calls = [];
    await page.route('**/*', route => {
      const served = serveRelease(route, root); if (served) return served;
      const p = new URL(route.request().url()).pathname;
      calls.push(p);
      if (p === base + '/api/session') return route.fulfill({ json: { account: 'supplier.near', agreed: true } });
      if (p === base + '/api/invoices') return route.fulfill({ json: { invoices: [], agreements: [], agreed: true } });
      if (p === base + '/api/work-orders') return route.fulfill({ json: { orders: [] } });
      if (p === base + '/api/compensation') return route.fulfill({ json: { account: 'supplier.near', agreements: [], requests: [], history: [], payments: [] } });
      return route.abort();
    });
    await page.goto('https://invoice.test' + base + path);
    await page.getByText(landmark, { exact: true }).first().waitFor();
    assert.equal(await page.locator('#report-link').getAttribute('href'), base + '/report', `${path}: links stay under the base`);
    if (landmark === 'Request a work order') {
      await page.getByRole('button', { name: 'Check work orders', exact: true }).click();
      await page.getByText('No work orders for this signed-in account.').waitFor();
      assert.match(await page.locator('body').ariaSnapshot(), /Describe the work/);
      // Navigating within the app keeps the base and the same session.
      await page.locator('#report-link').click();
      await page.getByText('Report. Review. Receive.', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, base + '/report');
    }
    assert.ok(calls.length && calls.every(p => p.startsWith(base + '/api/')), `${path}: every call stays under ${base}: ${calls.join(', ')}`);
    await assertResponsive(page, `scoped ${path || '(no slash)'}`);
    await page.close();
  }
  // HTML 401 and 403 classify the same under the base as at the root.
  for (const status of [401, 403]) {
    const page = await browser.newPage(); await installWallet(page);
    await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ amount: '1', note: 'Scoped', submission: 'scoped-id' })), `invoice-draft:${base}:supplier.near`);
    await page.route('**/*', route => {
      const served = serveRelease(route, root); if (served) return served;
      const p = new URL(route.request().url()).pathname;
      if (p === base + '/api/session') return route.fulfill({ json: { account: 'supplier.near', agreed: true } });
      if (p === base + '/api/invoices') return route.fulfill({ status, contentType: 'text/html', body: 'Proxy says no' });
      return route.abort();
    });
    await page.goto('https://invoice.test' + base + '/');
    await assertAccessWords(page, status);
    await page.getByRole('button', { name: 'Sign in with NEAR' }).waitFor();
    assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).submission, `invoice-draft:${base}:supplier.near`), 'scoped-id', `${status}: scoped draft kept`);
    await page.close();
  }
  console.log('PASS scoped entry: /, /submit and /report with and without a trailing slash stay under the base; HTML 401 and 403 classify as at the root');
}
runTask([scopedPayee]);
