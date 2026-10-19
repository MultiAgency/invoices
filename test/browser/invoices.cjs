/** Offline task journeys. A failing scenario keeps its diagnostics under .test-artifacts/browser-failures/. */
const { runTask } = require('./fixtures/task.cjs');
const assert = require('node:assert/strict');
const { serveRelease } = require('./fixtures/release.cjs');
const { installWallet, settled } = require('./fixtures/wallet.cjs');
const { assertAccessWords } = require('./fixtures/access.cjs');
const { elapse } = require('./fixtures/clock.cjs');
const { assertResponsive } = require('./fixtures/layout.cjs');

async function fileInvoice(browser, root) {
  {
    const width = 390;
    const page = await browser.newPage({ viewport: { width, height: 900 } }); await installWallet(page);
    page.setDefaultTimeout(8000);
    let agreements = [], invoices = [], agreed = false, unavailable = false;
    const writes = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), p = url.pathname;
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: null, agreed: false } });
      if (route.request().method() === 'POST') writes.push({ path: p, body: route.request().postDataJSON() });
      if (p === '/api/signin/challenge') return route.fulfill({ json: { nonce: 'AAAA', message: 'Offline sign-in', recipient: 'invoice.test' } });
      if (p === '/api/signin') return route.fulfill({ json: { account: 'synthetic-payee.near', agreed } });
      if (p === '/api/invoices' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        if (!agreed) {
          agreements = [{ id: 'agreement', origin: 'payee', status: 'requested', amount: '1250000', note: body.note, submission: body.submission, at: new Date().toISOString() }];
          return route.fulfill({ json: { id: 'agreement', status: 'requested' } });
        }
        invoices = [{ id: 'invoice', status: 'waiting', amount: '1250000', note: body.note, filedAt: new Date().toISOString(), revisionConflict: false }];
        agreements = [];
        return route.fulfill({ json: { id: 'invoice', status: 'waiting' } });
      }
      if (p === '/api/invoices') return route.fulfill(unavailable ? { status: 503, json: {} } : { json: { agreements, invoices, agreed } });
      throw new Error('Unexpected fixture request: ' + p);
    });
    await page.goto('https://invoice.test/');
    await page.getByRole('button', { name: 'Sign in with NEAR' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Send request', exact: true }).waitFor();
    await page.getByLabel('Amount (USDC)').fill('1.25');
    await page.getByLabel("What's it for? (optional)").fill('Synthetic work');
    await page.getByRole('button', { name: 'Send request', exact: true }).click();
    await page.getByText(/Waiting for the DAO to agree/).waitFor();
    const original = writes.find(w => w.path === '/api/invoices').body.submission;
    const refresh = () => page.getByRole('button', { name: 'Check invoice status again' }).click();
    agreements[0].status = 'proposed'; await refresh();
    await page.getByText(/DAO still needs to approve the policy/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'File this invoice' }).count(), 0);
    agreements[0].status = 'agreed'; agreed = true; await refresh();
    await page.getByRole('button', { name: 'File this invoice' }).click();
    await page.getByText(/Waiting for approval/).waitFor();
    const [request, filing] = writes.filter(w => w.path === '/api/invoices').map(w => w.body);
    assert.equal(filing.submission, original);
    assert.deepEqual(filing, request, 'filing the agreed request sends its identity with exactly the agreed terms');
    for (const [status, text] of [['paying', /Settlement is not yet confirmed/], ['unknown', /do not create a replacement invoice/], ['refused', /nothing was sent for this invoice/], ['paid', /^Paid\.$/]]) {
      invoices[0].status = status; await refresh(); await page.getByText(text).waitFor();
    }
    unavailable = true; await refresh(); await page.getByText(/Invoice status could not be checked/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await assertResponsive(page, "invoice-journey");
    assert.deepEqual(errors, []);
    assert.deepEqual(writes.map(w => w.path), ['/api/signin/challenge', '/api/signin', '/api/invoices', '/api/invoices']);
    console.log(`PASS payee journey ${width}: synthetic sign-in, request, owner decision observations, stable invoice identity, held payout, processing, unresolved, refusal, paid, unavailable read`);
    await page.close();
  }
}

async function invoiceDraftsAndRefresh(browser, root) {
  const page = await browser.newPage(); await installWallet(page);
  page.setDefaultTimeout(8000);
  await page.clock.install();
  const errors = [], submissions = [];
  page.on('pageerror', error => errors.push(error.message));
  let records = [{ id: 'fixture', status: 'unknown', amount: '1000000', note: '', filedAt: '2026-01-01T00:00:00Z', revisionConflict: false }];
  let agreements = [], agreed = false, unavailable = false, defer = false;
  const queued = [];
  const response = (status = 'paid') => ({ invoices: [{ note: '', revisionConflict: false, ...records[0], id: 'fixture', status, amount: '1000000', filedAt: '2026-01-01T00:00:00Z' }], agreements: [], agreed: true });
  let sessionReads = 0;
  let pendingSubmission, holdSubmission = false;
  await page.addInitScript(() => localStorage.setItem('invoice-draft:payee.near', JSON.stringify({ amount: '7.50', note: 'Saved work', submission: 'original-id' })));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    { const served = serveRelease(route, root); if (served) return served; }
    if (url.pathname === '/api/signout') return route.fulfill({ json: { account: null } });
    if (url.pathname === '/api/signin/challenge') return route.fulfill({ json: { message: 'mock', recipient: 'mock', nonce: Buffer.alloc(32).toString('base64') } });
    if (url.pathname === '/api/signin') return route.fulfill({ json: { account: 'bob.near', agreed: true } });
    if (url.pathname === '/api/session') { sessionReads++; return route.fulfill({ json: { account: 'payee.near', agreed } }); }
    if (url.pathname === '/api/invoices' && route.request().method() === 'POST') {
      submissions.push(route.request().postDataJSON());
      if (holdSubmission) { pendingSubmission = route; return; }
      return route.fulfill({ json: { id: 'fixture', status: 'failed' } });
    }
    if (url.pathname === '/api/invoices') {
      if (defer) { queued.push(route); return; }
      if (unavailable) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { invoices: records, agreements, agreed } });
    }
    throw new Error('Unexpected invoice request: ' + url.pathname);
  });
  await page.goto('https://invoice.test/');
  // A background refresh: the page's own control, triggered without moving keyboard focus.
  const refresh = async () => { await page.evaluate(() => document.getElementById('refresh').click()); await settled(page); };
  await page.getByText(/Last checked/).waitFor();
  await page.getByRole('button', { name: 'Send request', exact: true }).waitFor();
  agreed = true;
  await refresh();
  await page.getByRole('button', { name: 'Submit invoice', exact: true }).waitFor();
  assert.equal(await page.locator('#amount').inputValue(), '7.50');
  assert.equal(await page.locator('#note').inputValue(), 'Saved work');
  assert.equal(sessionReads, 1);
  await page.locator('#submit').click();
  await page.getByText(/This alone does not establish/).waitFor();
  await page.waitForFunction(() => !document.getElementById('submit').disabled);
  await page.locator('#submit').click();
  await page.waitForFunction(() => !document.getElementById('submit').disabled);
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].submission, 'original-id');
  assert.deepEqual(submissions[1], submissions[0], 'the second submit resends the identical submission');
  assert.equal(await page.locator('#amount').inputValue(), '7.50');
  const copy = page.getByRole('button', { name: 'Copy review reference' });
  await copy.focus();
  await page.evaluate(() => { window.focused = document.activeElement; });
  await refresh();
  assert.equal(await page.evaluate(() => focused === document.activeElement), true);
  records[0] = { ...records[0], status: 'needs_review', note: 'Updated evidence' };
  await refresh();
  assert.equal(await page.evaluate(() => focused === document.activeElement), true);
  assert.match(await page.locator('#invoices').innerText(), /Updated evidence/);
  records[0].status = 'paid';
  await refresh();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'refresh');
  assert.equal(await copy.count(), 0);
  records = [];
  await refresh();
  assert.equal(await page.locator('#invoices li').count(), 0);
  agreements = [{ id: 'agreement', status: 'agreed', origin: 'owner', amount: '1000000', terms: { maxAmount: '2000000', until: '2030-01-01T00:00:00Z' }, note: 'First', at: '2026-01-01T00:00:00Z' }];
  await refresh();
  await page.getByRole('button', { name: 'Use these terms' }).focus();
  await page.evaluate(() => { window.agreementButton = document.activeElement; });
  agreements[0].note = 'Updated';
  await refresh();
  assert.equal(await page.evaluate(() => agreementButton === document.activeElement), true);
  await page.getByRole('button', { name: 'Use these terms' }).click();
  assert.equal(await page.locator('#note').inputValue(), 'Updated');
  assert.equal(await page.locator('#amount').inputValue(), '2');
  unavailable = true;
  await refresh();
  assert.match(await page.locator('#refresh-error').innerText(), /could not be checked/);
  assert.equal(await page.locator('#amount').inputValue(), '2');
  unavailable = false;
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/invoices');
  await page.clock.fastForward(15000);
  await retried;
  await page.waitForFunction(() => document.getElementById('refresh-error').textContent === '');
  defer = true;
  async function begin(slot) {
    const requested = page.waitForRequest(r => new URL(r.url()).pathname === '/api/invoices');
    await page.evaluate(() => document.getElementById('refresh').click());
    await requested;
    while (!queued.length) await new Promise(resolve => setImmediate(resolve));
    return queued.shift();
  }
  for (const olderFails of [false, true]) {
    const old = await begin('oldRead'), latest = await begin('newRead');
    await latest.fulfill({ json: response() }); await settled(page);
    await old.fulfill(olderFails ? { status: 503, json: {} } : { json: response('prepared') }); await settled(page);
    assert.match(await page.locator('#invoices').innerText(), /Paid/);
    assert.equal(await page.getByRole('button', { name: 'Continue this prepared invoice' }).count(), 0);
    assert.equal(await page.locator('#refresh-error').innerText(), '');
  }
  const old = await begin('oldRead'), latest = await begin('newRead');
  await latest.fulfill({ status: 503, json: {} });
  await settled(page);
  await old.fulfill({ json: response('prepared') });
  await settled(page);
  assert.match(await page.locator('#invoices').innerText(), /Paid/);
  assert.match(await page.locator('#refresh-error').innerText(), /could not be checked/);
  holdSubmission = true;
  await page.locator('#amount').fill('3');
  await page.locator('#submit').click();
  while (!pendingSubmission) await new Promise(resolve => setImmediate(resolve));
  const oldSessionRead = await begin('oldSessionRead'), oldSessionDenied = await begin('oldSessionDenied');
  await page.locator('#signout').click();
  await page.locator('#signin').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'signin', 'sign-out restores a visible keyboard target');
  assert.equal(await page.locator('#agreements-card').isVisible(), false);
  assert.equal(await page.locator('#agreements li').count(), 0);
  assert.equal(await page.locator('#invoices li').count(), 0);
  await oldSessionRead.fulfill({ json: response('unknown') });
  await settled(page);
  // Late answers for the signed-out account change nothing: no records, no error, and a late 401 ends no session.
  const signedOutView = async when => {
    assert.equal(await page.locator('#signin').isVisible(), true, `${when}: still signed out`);
    assert.equal(await page.locator('#agreements-card').isVisible(), false, `${when}: no agreements`);
    assert.equal(await page.locator('#invoices li').count(), 0, `${when}: no invoices`);
    assert.equal(await page.locator('#error').isVisible(), false, `${when}: no error`);
    assert.equal(await page.getByText(/Your session expired|may not access these records/).count(), 0, `${when}: no access-ended notice`);
  };
  await signedOutView('after a late answer');
  await oldSessionDenied.fulfill({ status: 401, contentType: 'text/html', body: 'Old session expired' });
  await settled(page);
  await signedOutView('after a late 401');
  const readsBefore = queued.length;
  await page.clock.fastForward(30000);
  assert.equal(queued.length, readsBefore, 'signed-out polling must stop');
  await page.evaluate(() => localStorage.setItem('invoice-draft:bob.near', JSON.stringify({ amount: '9', note: 'Bob draft', submission: 'bob-id' })));
  await page.locator('#signin').click();
  // Sign-out disconnected the wallet, so the connector asks which wallet to use; its selector runs on timers.
  await page.clock.runFor(1000);
  await page.getByText('Local test wallet', { exact: true }).click();
  await page.waitForFunction(() => document.getElementById('account')?.textContent === 'bob.near');
  assert.equal(await page.locator('#invoices li').count(), 0);
  assert.equal(await page.locator('#agreements li').count(), 0);
  await pendingSubmission.fulfill({ json: { id: 'fixture', status: 'paid' } });
  await settled(page);
  assert.equal(await page.locator('#amount').inputValue(), '9');
  assert.equal(await page.locator('#note').inputValue(), 'Bob draft');
  assert.equal(await page.locator('#refresh-status').innerText(), '');
  assert.equal(await page.locator('#error').isVisible(), false);
  while (!queued.length) await new Promise(resolve => setImmediate(resolve));
  // Every read Bob's page started is answered; only the latest is shown.
  while (queued.length) await queued.shift().fulfill({ json: { invoices: [], agreements: [], agreed: true } });
  await page.getByText(/Last checked/).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS invoice page: module loading, eligibility, drafts, focus, failure recovery, submission identity, overlapping refreshes, session isolation');
}

async function invoiceSessionExpiry(browser, root) {
  for (const status of [401, 403]) for (const method of ['GET', 'POST']) {
    const page = await browser.newPage(); await installWallet(page); page.setDefaultTimeout(5000); await page.clock.install();
    let expired = false;
    let nextAccount = 'payee.near', holdSubmission = false, pendingSubmission;
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('invoice-draft:payee.near', JSON.stringify({ amount: '7.50', note: 'Private draft', submission: 'original-id' })));
    await page.route('**/*', async route => {
      const { hostname, pathname: p } = new URL(route.request().url());
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: 'payee.near', agreed: true } });
      if (route.request().method() === 'POST') writes.push(p);
      if (p === '/api/invoices' && route.request().method() === 'POST' && holdSubmission) { pendingSubmission = route; return; }
      if (p === '/api/signout') return route.fulfill({ json: { account: null } });
      if (p === '/api/signin/challenge') return route.fulfill({ json: { message: 'mock', recipient: 'mock', nonce: Buffer.alloc(32).toString('base64') } });
      if (p === '/api/signin') { expired = false; return route.fulfill({ json: { account: nextAccount, agreed: true } }); }
      if (p === '/api/invoices') return route.fulfill(expired ? { status, contentType: 'text/html', body: 'Sign in again' } : {
        json: { invoices: [{ id: 'private-invoice', status: 'unknown', amount: '1000000', note: 'Private invoice', filedAt: '2026-01-01T00:00:00Z', revisionConflict: false }], agreements: [], agreed: true } });
      throw new Error('Unexpected invoice request: ' + p);
    });
    await page.goto('https://invoice.test/');
    await page.getByText(/Private invoice/).waitFor();
    expired = true;
    await page.getByRole('button', { name: method === 'GET' ? 'Check invoice status again' : 'Submit invoice', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in with NEAR' }).waitFor();
    await assertAccessWords(page, status);
    assert.equal(await page.getByText(/Private invoice/).count(), 0);
    assert.equal(await page.locator('#amount').isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('invoice-draft:payee.near')).submission), 'original-id');
    await page.getByRole('button', { name: 'Sign in with NEAR' }).click();
    await page.getByRole('button', { name: 'Submit invoice', exact: true }).waitFor();
    assert.equal(await page.locator('#amount').inputValue(), '7.50');
    assert.equal(await page.locator('#note').inputValue(), 'Private draft');
    await page.getByText(/This form retains a previous submission/).waitFor();
    assert.deepEqual(writes, [...(method === 'POST' ? ['/api/invoices'] : []), '/api/signin/challenge', '/api/signin']);
    if (method === 'POST') {
      holdSubmission = true;
      const started = page.waitForRequest(request => new URL(request.url()).pathname === '/api/invoices' && request.method() === 'POST');
      await page.getByRole('button', { name: 'Submit invoice', exact: true }).click(); await started;
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      nextAccount = 'other.near';
      await page.getByRole('button', { name: 'Sign in with NEAR' }).click();
      await page.getByText('other.near', { exact: true }).waitFor();
      await page.locator('#amount').fill('2.00'); await page.locator('#note').fill('Other private draft');
      const late = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invoices' && response.request().method() === 'POST');
      await pendingSubmission.fulfill({ status, contentType: 'text/html', body: 'Old session denied' }); await late;
      await page.clock.runFor(100);
      assert.equal(await page.getByText('other.near', { exact: true }).isVisible(), true, 'a late denial cannot expire a newer account session');
      assert.equal(await page.locator('#amount').inputValue(), '2.00');
      assert.equal(await page.locator('#note').inputValue(), 'Other private draft');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('invoice-draft:payee.near')).submission), 'original-id');
    }
    assert.deepEqual(errors, []);
    await page.close(); console.log(`PASS ${method} HTTP${status} removes invoice presentation and reauthentication preserves submission identity`);
  }
}

/**
 * Through the platform client: a submission whose answer is lost, a gateway failure or an unreadable body
 * leaves its outcome unknown. The page keeps the draft and its identity (also across a reload) and never mints
 * a replacement; the payee's explicit retry resends the same identity. An expired session and a refused
 * account read differently, and both keep the draft.
 */
async function invoiceSubmissionFailures(browser, root) {
  for (const mode of ['transport', 'gateway-502', 'invalid-200']) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(8000);
    await page.clock.install();
    const posts = [], errors = [];
    let failNext = true;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()), p = url.pathname;
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: 'payee.near', agreed: true } });
      if (p === '/api/invoices' && route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        if (failNext) {
          failNext = false;
          if (mode === 'transport') return route.abort('connectionreset');
          if (mode === 'gateway-502') return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
        }
        return route.fulfill({ json: { id: 'invoice', status: 'waiting' } });
      }
      if (p === '/api/invoices') return route.fulfill({ json: { invoices: [], agreements: [], agreed: true } });
      if (p === '/api/work-orders') return route.fulfill({ json: { orders: [] } });
      return route.abort();
    });
    await page.goto('https://invoice.test/');
    await page.getByLabel('Amount (USDC)').fill('3.25');
    await page.getByLabel("What's it for? (optional)").fill('Failure ' + mode);
    await page.getByRole('button', { name: 'Submit invoice', exact: true }).click();
    await page.getByText(/the outcome is unknown/).waitFor();
    const retained = () => page.evaluate(() => JSON.parse(localStorage.getItem('invoice-draft:payee.near') || 'null'));
    assert.equal((await retained()).submission, posts[0].submission, `${mode}: the draft keeps the submitted identity`);
    await page.locator('#retained-draft').waitFor();
    // Minutes pass with the page open: no timer resends it.
    await elapse(page);
    assert.equal(posts.length, 1, `${mode}: nothing is sent again automatically`);
    await page.reload();
    await page.locator('#retained-draft').waitFor();
    assert.equal(await page.locator('#amount').inputValue(), '3.25');
    await page.getByRole('button', { name: 'Submit invoice', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('invoice-draft:payee.near') === null);
    // The retry is the same submission: same identity and the same terms, never a replacement or changed terms.
    assert.equal(posts.length, 2, `${mode}: one explicit retry`);
    assert.deepEqual(posts[1], posts[0], `${mode}: the explicit retry resends the identical submission`);
    assert.equal(await page.locator('#retained-draft').isVisible(), false, `${mode}: a recorded answer settles the draft`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const status of [401, 403]) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(8000);
    await page.addInitScript(() => localStorage.setItem('invoice-draft:payee.near', JSON.stringify({ amount: '1', note: 'Kept', submission: 'kept-id' })));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()), p = url.pathname;
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: 'payee.near', agreed: true } });
      if (p === '/api/invoices') return route.fulfill({ status, contentType: 'text/html', body: 'Proxy says no' });
      if (p === '/api/work-orders') return route.fulfill({ json: { orders: [] } });
      return route.abort();
    });
    await page.goto('https://invoice.test/');
    await assertAccessWords(page, status);
    assert.equal(await page.locator('#amount').isVisible(), false, `${status}: private presentation removed`);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('invoice-draft:payee.near')).submission), 'kept-id', `${status}: draft identity kept`);
    await page.close();
  }
  // A definitive refusal (4xx JSON): the page shows Proto's reason, keeps the draft and its identity, and sends nothing more.
  for (const status of [409, 422]) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(8000);
    await page.clock.install();
    const posts = [], error = `Refused ${status}: this invoice conflicts with the recorded terms. Nothing was filed.`;
    await page.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: 'payee.near', agreed: true } });
      if (p === '/api/invoices' && route.request().method() === 'POST') { posts.push(route.request().postDataJSON()); return route.fulfill({ status, json: { code: 'conflict', error } }); }
      if (p === '/api/invoices') return route.fulfill({ json: { invoices: [], agreements: [], agreed: true } });
      if (p === '/api/work-orders') return route.fulfill({ json: { orders: [] } });
      return route.abort();
    });
    await page.goto('https://invoice.test/');
    await page.getByLabel('Amount (USDC)').fill('4.50');
    await page.getByLabel("What's it for? (optional)").fill('Refused ' + status);
    await page.getByRole('button', { name: 'Submit invoice', exact: true }).click();
    await page.getByText(error, { exact: true }).waitFor();
    assert.equal(await page.getByText(/the outcome is unknown/).count(), 0, `${status}: a refusal is not an unknown outcome`);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('invoice-draft:payee.near') || 'null'));
    assert.deepEqual(draft, { ...posts[0], refused: true }, `${status}: the draft keeps the refused submission and its identity, marked refused`);
    assert.equal(await page.locator('#amount').inputValue(), '4.50', `${status}: the form keeps its terms`);
    await elapse(page);
    assert.equal(posts.length, 1, `${status}: nothing is sent again`);
    await page.close();
  }
  console.log('PASS invoice submission failures through the platform client: transport, 502 HTML and invalid 200 stay unknown with the same identity, and nothing is resent over five minutes; HTML 401 and 403 read differently and keep drafts; 409 and 422 show the refusal and keep the draft');
}

/**
 * Which identity a resubmission carries. After a definitive refusal nothing was recorded, so changed terms go out
 * under a new identity while an unchanged retry keeps the refused one. After an unknown outcome the original may be
 * recorded, so every resubmission, edited or not, keeps the original identity.
 */
async function invoiceResubmissionIdentity(browser, root) {
  for (const first of ['refused', 'unknown']) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(8000);
    const posts = [];
    let answers = first === 'refused' ? ['refused', 'refused', 'recorded'] : ['lost', 'recorded'];
    await page.route('**/*', route => {
      const p = new URL(route.request().url()).pathname;
      { const served = serveRelease(route, root); if (served) return served; }
      if (p === '/api/session') return route.fulfill({ json: { account: 'payee.near', agreed: true } });
      if (p === '/api/invoices' && route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        const answer = answers.shift();
        if (answer === 'lost') return route.abort('connectionreset');
        if (answer === 'refused') return route.fulfill({ status: 409, json: { code: 'conflict', error: 'Refused: the amount exceeds the agreed terms. Nothing was filed.' } });
        return route.fulfill({ json: { id: 'invoice', status: 'waiting' } });
      }
      if (p === '/api/invoices') return route.fulfill({ json: { invoices: [], agreements: [], agreed: true } });
      if (p === '/api/work-orders') return route.fulfill({ json: { orders: [] } });
      return route.abort();
    });
    await page.goto('https://invoice.test/');
    await page.getByLabel('Amount (USDC)').fill('9.00');
    await page.getByLabel("What's it for? (optional)").fill('First terms');
    const submit = async () => { const sent = posts.length; await page.getByRole('button', { name: 'Submit invoice', exact: true }).click(); while (posts.length === sent) await new Promise(r => setTimeout(r, 20)); await settled(page); };
    await submit();
    if (first === 'refused') {
      await page.getByText(/Refused: the amount exceeds/).waitFor();
      await submit();
      assert.deepEqual(posts[1], posts[0], 'refused: an unchanged retry keeps the refused identity and terms');
      await page.getByText(/Refused: the amount exceeds/).waitFor();
      await page.getByLabel('Amount (USDC)').fill('4.00');
      await submit();
      assert.notEqual(posts[2].submission, posts[0].submission, 'refused: edited terms never reuse the refused identity');
      assert.deepEqual([posts[2].amount, posts[2].note], ['4.00', 'First terms'], 'refused: the new identity carries the edited terms');
    } else {
      await page.getByText(/the outcome is unknown/).waitFor();
      await page.getByLabel('Amount (USDC)').fill('4.00');
      await submit();
      assert.equal(posts[1].submission, posts[0].submission, 'unknown: even an edited resubmission keeps the original identity');
    }
    await page.close();
  }
  console.log('PASS invoice resubmission identity: after a refusal, edited terms get a new identity and an unchanged retry keeps it; after an unknown outcome the identity is kept');
}

runTask([invoiceSubmissionFailures, fileInvoice, invoiceDraftsAndRefresh, invoiceSessionExpiry, invoiceResubmissionIdentity]);
