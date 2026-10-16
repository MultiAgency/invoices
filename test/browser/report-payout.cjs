const assert = require('node:assert/strict');
const path = require('node:path');
const { runTask } = require('./fixtures/task.cjs');
const { rpcValue } = require('./fixtures/rpc.cjs');
const { assertResponsive } = require('./fixtures/layout.cjs');
const agreement = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, at: '2026-10-16T12:00:00Z', recordedBy: 'owner', approved: '0', remaining: '1000000000', terms: { payee: 'builder.near', title: 'October engineering', document: 'https://docs.google.com/document/d/example', signedOn: '2026-10-01', start: '2026-10-01', end: '2026-10-31', ceiling: '1000000000', openingApproved: '0', scope: 'Authorized issues' } };
const report = { agreementId: agreement.id, start: '2026-10-01', end: '2026-10-16', contributions: 'Shipped the integration and acceptance tests.', assessment: 'Removed the manual handoff.', evidence: ['https://github.com/example/project/pull/42'] };
async function reportFirst(browser, root) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  page.setDefaultTimeout(10000);
  let requests = [], receipts = new Map(), attempts = [], lost = true, payments = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'invoice.test') return route.abort();
    if (u.pathname === '/api/compensation/session') return route.fulfill({ json: { account: 'builder.near' } });
    if (u.pathname === '/api/compensation') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement], requests, history: [], payments } });
      const c = route.request().postDataJSON(); attempts.push(c);
      assert.equal(c.report.amount, undefined);
      if (!receipts.has(c.commandId)) { requests = [{ id: c.id, version: 1, payee: 'builder.near', agreementVersion: 1, report: c.report, state: 'submitted', feedback: '', reviewedBy: null, payment: null, at: '2026-10-16T12:00:00Z' }]; receipts.set(c.commandId, requests[0]); }
      if (lost) { lost = false; return route.fulfill({ status: 503, json: { error: 'Response lost. Retry this report.' } }); }
      return route.fulfill({ json: receipts.get(c.commandId) });
    }
    if (u.pathname.startsWith('/invoice-ui/static/')) return route.fulfill({ path: path.join(root, u.pathname.slice('/invoice-ui'.length)), contentType: u.pathname.endsWith('.js') ? 'application/javascript' : u.pathname.endsWith('.css') ? 'text/css' : 'font/woff2' });
    return route.fulfill({ path: path.join(root, 'contributor.html'), contentType: 'text/html' });
  });
  await page.goto('https://invoice.test/report');
  await page.getByRole('button', { name: 'New report', exact: true }).click();
  assert.equal(await page.getByLabel('Amount requested · USDC').count(), 0);
  await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
  await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('Response lost. Retry this report.').waitFor();
  await page.reload();
  await page.getByLabel('Contributions', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('Compensation in review', { exact: true }).waitFor();
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]); assert.equal(requests.length, 1);
  requests[0] = { ...requests[0], version: 2, state: 'approved', approvedAmount: '250000000', feedback: 'Accepted the integration and tests.', reviewedBy: 'owner', payment: { mode: 'isolated', id: requests[0].id, until: '2030-01-01T00:00:00Z' } };
  for (const status of ['preparing', 'waiting', 'unknown', 'failed', 'paid']) {
    payments = [{ requestId: requests[0].id, id: requests[0].id, status }];
    await page.getByRole('button', { name: 'All requests', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: /October engineering/ }).click();
    await page.getByText(`Payment status: ${status}.`, { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Revise', exact: true }).count(), 0);
  }
  await assertResponsive(page, 'amount-free report and isolated payout');
  await page.screenshot({ path: '/tmp/payables-report-receive-mobile.png', fullPage: true });
}

runTask([reportFirst]);
