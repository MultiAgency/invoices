const assert = require('node:assert/strict');
const { runTask } = require('./fixtures/task.cjs');
const { rpcValue } = require('./fixtures/rpc.cjs');
const { assertResponsive } = require('./fixtures/layout.cjs');
const { serveRelease } = require('./fixtures/release.cjs');
const { installWallet, settled } = require('./fixtures/wallet.cjs');
const { assertAccessWords } = require('./fixtures/access.cjs');
const { elapse } = require('./fixtures/clock.cjs');
const { PAYEE_ROLE } = require('@multiagency/sdk/payee');
const agreement = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, at: '2026-10-16T12:00:00Z', recordedBy: 'owner', approved: '0', remaining: '1000000000', terms: { payee: 'builder.near', title: 'October engineering', document: 'https://docs.google.com/document/d/example', signedOn: '2026-10-01', start: '2026-10-01', end: '2026-10-31', ceiling: '1000000000', openingApproved: '0', scope: 'Authorized issues' } };
const report = { agreementId: agreement.id, start: '2026-10-01', end: '2026-10-16', contributions: 'Shipped the integration and acceptance tests.', assessment: 'Removed the manual handoff.', evidence: ['https://github.com/example/project/pull/42'] };
/** Every place the page keeps `needle`: its HTML, local/session storage, IndexedDB, Cache Storage and cookies. */
async function storedWith(page, needle) {
  const found = await page.evaluate(async needle => {
  const found = [];
  for (const [name, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]])
    for (let i = 0; i < storage.length; i++) { const key = storage.key(i); if (`${key}${storage.getItem(key)}`.includes(needle)) found.push(`${name}:${key}`); }
  for (const { name } of await indexedDB.databases()) {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    for (const store of db.objectStoreNames) {
      const [keys, values] = await Promise.all(['getAllKeys', 'getAll'].map(method => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store)[method](); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      })));
      if (JSON.stringify([keys, values]).includes(needle)) found.push(`indexedDB:${name}/${store}`);
    }
    db.close();
  }
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (`${request.url}${response ? await response.text() : ''}`.includes(needle)) found.push(`cacheStorage:${name}`);
    }
  }
  if (document.cookie.includes(needle)) found.push('document.cookie');
  return found;
  }, needle);
  if ((await page.content()).includes(needle)) found.push('html');
  for (const cookie of await page.context().cookies()) if (`${cookie.name}${cookie.value}`.includes(needle)) found.push(`cookie:${cookie.name}`);
  return found;
}
async function reportFirst(browser, root) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' }); await installWallet(page);
  page.setDefaultTimeout(10000);
  await page.clock.install();
  let requests = [], receipts = new Map(), attempts = [], lost = true, payments = [];
  await page.route('**/*', route => {
    const served = serveRelease(route, root); if (served) return served;
    const u = new URL(route.request().url());
    if (u.pathname === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
    if (u.pathname === '/api/compensation') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement], requests, history: [], payments } });
      const c = route.request().postDataJSON(); attempts.push(c);
      assert.equal(c.report.amount, undefined);
      if (!receipts.has(c.commandId)) { requests = [{ id: c.id, version: 1, payee: 'builder.near', agreementVersion: 1, report: c.report, state: 'submitted', feedback: '', reviewedBy: null, payment: null, at: '2026-10-16T12:00:00Z' }]; receipts.set(c.commandId, requests[0]); }
      if (lost) { lost = false; return route.fulfill({ status: 503, json: { error: 'Response lost. Retry this report.' } }); }
      return route.fulfill({ json: receipts.get(c.commandId) });
    }
    return route.abort();
  });
  await page.goto('https://invoice.test/report');
  await page.locator('#request-form').waitFor(); // no requests yet: the form opens first
  assert.equal(await page.getByLabel('Amount requested · USDC').count(), 0);
  await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
  await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  // A 5xx after the command was sent is an unknown outcome: the draft keeps its command identity, nothing is resent.
  await page.getByText(/the outcome is unknown/).waitFor();
  await elapse(page);
  assert.equal(attempts.length, 1, 'nothing resent over five minutes');
  await page.reload();
  // The request may already be recorded, so the list comes first; the retained draft is one click away.
  await page.getByRole('button', { name: 'Resume draft' }).click();
  await page.getByLabel('Contributions', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('Compensation in review', { exact: true }).waitFor();
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]); assert.equal(requests.length, 1);
  requests[0] = { ...requests[0], version: 2, state: 'approved', approvedAmount: '250000000', feedback: 'Accepted the integration and tests.', reviewedBy: 'owner', payment: { mode: 'isolated', id: requests[0].id, until: '2030-01-01T00:00:00Z' } };
  // Each status reads as a sentence; approval never reads as payment, and only unproven outcomes warn against replacement.
  for (const [status, words, replacementWarning] of [
    ['preparing', 'Payment is being prepared. The owner still needs to authorize and fund it; nothing has been sent.', false],
    ['waiting', 'Waiting for the owner to approve the payout. Approval is not payment.', false],
    ['paying', 'Approved. The payment is processing; settlement is not yet confirmed.', false],
    ['unknown', 'The payment outcome is unknown and needs reconciliation. Do not submit a replacement request.', true],
    ['failed', 'The provider reported a failed or refunded outcome. That alone does not make a replacement safe; ask the owner to review it.', true],
    ['paid', 'Paid.', false],
  ]) {
    payments = [{ requestId: requests[0].id, id: requests[0].id, status }];
    await page.getByRole('button', { name: 'All requests', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: /October engineering/ }).click();
    const notice = page.getByRole('alert').filter({ hasText: 'Your payouts' });
    await notice.getByText(words, { exact: true }).waitFor();
    assert.equal(/replacement/.test(await notice.innerText()), replacementWarning, `${status}: replacement warning only for unproven outcomes`);
    assert.equal(await page.getByRole('button', { name: 'Revise', exact: true }).count(), 0);
  }
  await assertResponsive(page, 'amount-free report and isolated payout');
}

/** The report page through the platform client: lost or unreadable answers keep the command; 401 and 403 read differently. */
async function reportFailures(browser, root) {
  const serve = (page, handle) => page.route('**/*', route => {
    const served = serveRelease(route, root); if (served) return served;
    return handle(route, new URL(route.request().url()).pathname);
  });
  for (const mode of ['transport', 'invalid-200']) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(10000);
    await page.clock.install();
    const attempts = [];
    let requests = [];
    await serve(page, (route, p) => {
      if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
      if (p !== '/api/compensation') return route.abort();
      if (route.request().method() === 'GET') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement], requests, history: [], payments: [] } });
      const c = route.request().postDataJSON(); attempts.push(c);
      requests = [{ id: c.id, version: 1, payee: 'builder.near', agreementVersion: 1, report: c.report, state: 'submitted', feedback: '', reviewedBy: null, payment: null, at: '2026-10-16T12:00:00Z' }];
      if (attempts.length === 1) return mode === 'transport' ? route.abort('connectionreset') : route.fulfill({ status: 200, contentType: 'application/json', body: '{"saved":true}' });
      return route.fulfill({ json: requests[0] });
    });
    await page.goto('https://invoice.test/report');
    await page.locator('#request-form').waitFor(); // no requests yet: the form opens first
    await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
    await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByText(/the outcome is unknown/).waitFor();
    await elapse(page);
    assert.equal(attempts.length, 1, `${mode}: nothing resent over five minutes`);
    await page.reload();
    // The request may already be recorded, so the list comes first; the retained draft is one click away.
    await page.getByRole('button', { name: 'Resume draft' }).click();
    await page.getByLabel('Contributions', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByText('Compensation in review', { exact: true }).waitFor();
    // The retry is the same command: same identities, same expected version and the same report, never changed terms.
    assert.equal(attempts.length, 2, `${mode}: one explicit retry`);
    assert.deepEqual(attempts[1], attempts[0], `${mode}: the retry resends the identical command`);
    await page.close();
  }
  for (const status of [401, 403]) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(10000);
    await serve(page, (route, p) => p === '/api/session' ? route.fulfill({ json: { account: 'builder.near', agreed: true } }) : route.fulfill({ status, contentType: 'text/html', body: 'Proxy says no' }));
    await page.goto('https://invoice.test/report');
    await assertAccessWords(page, status);
    assert.equal(await page.getByRole('button', { name: 'New report', exact: true }).count(), 0, `${status}: private records not shown`);
    await page.close();
  }
  // Access ends on the submission itself: the private records go, and the draft keeps its report and command identity.
  for (const status of [401, 403]) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(10000);
    const attempts = [];
    await serve(page, (route, p) => {
      if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
      if (p !== '/api/compensation') return route.abort();
      if (route.request().method() === 'GET') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement], requests: [], history: [], payments: [] } });
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ status, contentType: 'text/html', body: 'Proxy says no' });
    });
    await page.goto('https://invoice.test/report');
    await page.locator('#request-form').waitFor(); // no requests yet: the form opens first
    await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
    await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await assertAccessWords(page, status);
    assert.equal(await page.getByLabel('Contributions', { exact: true }).count(), 0, `${status}: private presentation removed`);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('report:https://invoice.test:builder.near') || 'null'));
    assert.deepEqual([draft?.id, draft?.attempt?.commandId, draft?.report?.contributions], [attempts[0].id, attempts[0].commandId, report.contributions], `${status}: the draft keeps its report and command`);
    assert.equal(attempts.length, 1);
    await page.close();
  }
  // A definitive refusal (4xx JSON): the page shows Proto's reason and keeps the draft and its command; nothing more is sent.
  for (const status of [409, 422]) {
    const page = await browser.newPage(); await installWallet(page);
    page.setDefaultTimeout(10000);
    await page.clock.install();
    const attempts = [], error = `Refused ${status}: the report period must fit the agreement period.`;
    await serve(page, (route, p) => {
      if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
      if (p !== '/api/compensation') return route.abort();
      if (route.request().method() === 'GET') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement], requests: [], history: [], payments: [] } });
      attempts.push(route.request().postDataJSON());
      return route.fulfill({ status, json: { code: 'outside_period', error } });
    });
    await page.goto('https://invoice.test/report');
    await page.locator('#request-form').waitFor(); // no requests yet: the form opens first
    await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
    await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByText(error).waitFor();
    assert.equal(await page.getByText(/the outcome is unknown/).count(), 0, `${status}: a refusal is not an unknown outcome`);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('report:https://invoice.test:builder.near') || 'null'));
    assert.deepEqual([draft?.id, draft?.attempt?.commandId], [attempts[0].id, attempts[0].commandId], `${status}: the draft keeps the refused command`);
    assert.equal(await page.getByLabel('Contributions', { exact: true }).inputValue(), report.contributions, `${status}: the form keeps its text`);
    await elapse(page);
    assert.equal(attempts.length, 1, `${status}: nothing is sent again`);
    await page.close();
  }
  console.log('PASS report page through the platform client: transport and invalid 200 stay unknown with the same command, nothing resent over five minutes; HTML 401 and 403 read differently; 409 and 422 show the refusal and keep the draft');
}

/** Agent connections on the report page: offered only when the platform advertises them; the token is shown once. */
async function agentConnectionsControl(browser, root) {
  const capabilities = (offered) => ({ version: 1, product: 'invoices', capabilities: ['supplier-session-v1', 'supplier-compensation-v2', ...(offered ? ['supplier-agent-connections-v1'] : [])] });
  const view = { account: 'builder.near', agreements: [agreement], requests: [], history: [], payments: [] };
  const record = (id, label, extra = {}) => ({ id, label, role: PAYEE_ROLE, permissions: ['compensation.read', 'compensation.submit'], host: 'invoice.test', instance: '/', account: 'builder.near',
    agentId: 'a'.repeat(64), createdAt: '2026-10-17T12:00:00.000Z', expiresAt: new Date(Date.now() + 3600_000).toISOString(), revoked: false, ...extra });
  {
    const page = await browser.newPage(); await installWallet(page); page.setDefaultTimeout(10000);
    await page.route('**/*', route => {
      const served = serveRelease(route, root); if (served) return served;
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
      if (p === '/api/compensation') return route.fulfill({ json: view });
      if (p === '/api/capabilities') return route.fulfill({ json: capabilities(false) });
      return route.abort();
    });
    const answered = page.waitForResponse(r => new URL(r.url()).pathname === '/api/capabilities');
    await page.goto('https://invoice.test/report');
    await page.locator('#request-form').waitFor();
    // The gate is judged after the platform has answered, and after the page has rendered that answer.
    await answered; await settled(page);
    assert.equal(await page.getByRole('heading', { name: 'Agent connections' }).count(), 0, 'not offered without the capability');
    await page.close();
  }
  const page = await browser.newPage(); await installWallet(page); page.setDefaultTimeout(10000);
  await page.clock.install();
  let connections = [], posts = [], deletes = [], loseNextStart = false;
  await page.route('**/*', route => {
    const served = serveRelease(route, root); if (served) return served;
    const p = new URL(route.request().url()).pathname, method = route.request().method();
    if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
    if (p === '/api/compensation') return route.fulfill({ json: view });
    if (p === '/api/capabilities') return route.fulfill({ json: capabilities(true) });
    if (p === '/api/agent-connections' && method === 'GET') return route.fulfill({ json: { connections } });
    if (p === '/api/agent-connections' && method === 'POST') {
      const body = route.request().postDataJSON(); posts.push(body);
      const id = `0000000${posts.length}-0000-4000-8000-000000000000`, connection = record(id, body.label, { expiresAt: new Date(Date.now() + body.ttlSeconds * 1000).toISOString() });
      connections = [...connections, connection];
      if (loseNextStart) { loseNextStart = false; return route.abort('connectionreset'); }
      return route.fulfill({ status: 201, json: { connection, token: `tac_${id}.${'A'.repeat(43)}` } });
    }
    const revoke = p.match(/^\/api\/agent-connections\/([0-9a-f-]{36})$/);
    if (revoke && method === 'DELETE') { deletes.push(revoke[1]); connections = connections.map(c => c.id === revoke[1] ? { ...c, revoked: true } : c); return route.fulfill({ json: { revoked: true } }); }
    return route.abort();
  });
  await page.goto('https://invoice.test/report');
  await page.getByRole('heading', { name: 'Agent connections' }).waitFor();
  const section = page.locator('#agent-connections');
  for (const words of ["Read your reports, the owner's feedback and their payment status", 'Submit and revise your contribution reports', 'File invoices or work orders, or request payouts', 'Approve, prepare or pay anything', "See other contributors' records"])
    await section.getByText(words).first().waitFor();
  await section.getByText('No agent connections.').waitFor();
  await page.getByRole('button', { name: 'Start agent connection' }).click();
  await section.getByText(/Name the connection/).waitFor();
  assert.equal(posts.length, 0, 'invalid input sends nothing');
  await page.getByLabel('Name this connection').fill('Report agent');
  await page.getByLabel('Lasts').selectOption('28800');
  await page.getByRole('button', { name: 'Start agent connection' }).click();
  await page.locator('#agent-token').getByText('Copy this token now. It is shown only once.').waitFor();
  assert.deepEqual(posts, [{ label: 'Report agent', ttlSeconds: 28800 }]);
  assert.match(await page.locator('#agent-token code').innerText(), /^tac_00000001-0000-4000-8000-000000000000\.A{43}$/);
  await page.getByRole('button', { name: 'Done, hide token' }).click();
  assert.equal(await page.locator('#agent-token').count(), 0, 'the token is shown only until hidden');
  assert.deepEqual(await storedWith(page, 'A'.repeat(43)), [], 'once hidden, the token is nowhere on the page or in its storage');
  await page.locator('#agent-connection-list').getByText('Report agent', { exact: true }).waitFor();
  await page.reload();
  await page.locator('#agent-connection-list').getByText('Report agent', { exact: true }).waitFor();
  assert.equal(await page.locator('#agent-token').count(), 0, 'a reload never shows the token again');
  assert.deepEqual(await storedWith(page, 'A'.repeat(43)), [], 'after a reload, the token is nowhere on the page or in its storage');
  await page.getByRole('button', { name: 'Revoke Report agent' }).click();
  await section.getByText(/is revoked\. Its token no longer works\./).waitFor();
  assert.deepEqual(deletes, ['00000001-0000-4000-8000-000000000000']);
  await page.locator('#agent-connection-list').getByText('Revoked', { exact: true }).waitFor();
  // A lost start: not a money action. The page says so and the refreshed list shows the orphan, which can be revoked.
  loseNextStart = true;
  await page.getByLabel('Name this connection').fill('Lost one');
  await page.getByRole('button', { name: 'Start agent connection' }).click();
  await section.getByText(/it is unclear whether a connection started/).waitFor();
  const starts = posts.length;
  await elapse(page);
  assert.equal(posts.length, starts, 'a lost start is never retried');
  await page.getByRole('button', { name: 'Revoke Lost one' }).waitFor();
  assert.equal(await page.locator('#agent-token').count(), 0);
  await page.close();
  console.log('PASS agent connections: offered only with the capability; exact can and cannot; token shown once; list, revoke, and a lost start leaves a revocable orphan');
}

/**
 * Where the report page opens and what a link or reload keeps: requests first when there are any (even with a saved
 * draft), the form first when there are none; `?request=` opens a request and survives reload, back and forward;
 * `?agreement=` starts a new report on those terms, keeping one draft identity across reloads; scoped entries alike.
 */
async function reportPlace(browser, root) {
  const terms = (title, start, end) => ({ payee: 'builder.near', title, document: 'https://example.org/a', signedOn: start, start, end, ceiling: '1000000000', openingApproved: '0', scope: 'Work' });
  const november = { ...agreement, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', terms: terms('November design', '2026-11-01', '2026-11-30') };
  const paid = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version: 2, payee: 'builder.near', agreementVersion: 1, report, state: 'approved', approvedAmount: '250000000', feedback: 'Accepted.', reviewedBy: 'owner', payment: { mode: 'isolated', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, at: '2026-10-16T12:00:00Z' };
  for (const base of ['', '/i/own-' + 'a'.repeat(24)]) {
    const page = await browser.newPage(); await installWallet(page); page.setDefaultTimeout(10000);
    let requests = [paid];
    await page.route('**/*', route => {
      const served = serveRelease(route, root); if (served) return served;
      const p = new URL(route.request().url()).pathname.slice(base.length);
      if (p === '/api/session') return route.fulfill({ json: { account: 'builder.near', agreed: true } });
      if (p === '/api/compensation') return route.fulfill({ json: { account: 'builder.near', agreements: [agreement, november], requests, history: [], payments: requests.length ? [{ requestId: paid.id, id: paid.id, status: 'paying' }] : [] } });
      return route.abort();
    });
    const at = path => page.goto(`https://invoice.test${base}${path}`);
    const draftKey = `report:https://invoice.test${base}:builder.near`, draft = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), draftKey);
    const list = page.getByRole('heading', { name: 'Your requests' }), form = page.locator('#request-form'), opened = page.getByRole('button', { name: 'All requests' });
    const path = () => { const u = new URL(page.url()); return u.pathname.slice(base.length) + u.search; };

    // Requests exist: the list comes first, even after leaving a blank draft behind.
    await at('/report'); await list.waitFor();
    await page.getByRole('button', { name: 'New report', exact: true }).click(); await form.waitFor();
    await page.getByRole('button', { name: 'Back to requests' }).click(); await page.reload();
    await list.waitFor();
    assert.equal(await form.count(), 0, `${base}: a saved draft doesn't hide the requests`);
    await page.getByRole('button', { name: 'Resume draft' }).waitFor();
    await page.evaluate(key => localStorage.removeItem(key), draftKey); await page.reload(); await list.waitFor();

    // ?request= opens it; reload keeps it; back returns to the list and forward reopens it.
    await page.getByRole('button', { name: /250/ }).first().click(); await opened.waitFor();
    assert.equal(path(), `/report?request=${paid.id}`, `${base}: opening a request names it in the URL`);
    await page.reload(); await opened.waitFor();
    await page.getByText('Approved. The payment is processing; settlement is not yet confirmed.').waitFor();
    await page.getByRole('button', { name: 'All requests' }).click(); await list.waitFor();
    await page.getByRole('button', { name: /250/ }).first().click(); await opened.waitFor();
    await page.goBack(); await list.waitFor();
    assert.equal(path(), '/report', `${base}: back returns to the requests`);
    await page.goForward(); await opened.waitFor();
    await at(`/report?request=${paid.id}`); await opened.waitFor();

    // ?agreement= starts a new report on those terms; a reload keeps the same draft and its identity.
    await at(`/report?agreement=${november.id}`); await form.waitFor();
    assert.equal(await page.locator('#agreement option:checked').innerText(), 'November design', `${base}: the linked terms are preselected`);
    const started = await draft();
    assert.deepEqual([started.report.agreementId, started.report.start, started.report.end], [november.id, '2026-11-01', '2026-11-30'], `${base}: the new report starts from the linked agreement`);
    await page.reload(); await form.waitFor();
    assert.equal((await draft()).id, started.id, `${base}: a reload keeps the draft's identity`);
    assert.equal(await page.locator('#agreement option:checked').innerText(), 'November design');

    // A link to other terms never shows a different agreement's draft as if it were the linked one. A blank draft
    // (nothing typed, never sent) gives way to the linked terms; one with content stays, and the page says why.
    await page.evaluate(key => localStorage.removeItem(key), draftKey);
    await at('/report'); await list.waitFor();
    await page.getByRole('button', { name: 'New report', exact: true }).click(); await form.waitFor();
    const blank = await draft();
    await at(`/report?agreement=${november.id}`); await form.waitFor();
    assert.equal(await page.locator('#agreement option:checked').innerText(), 'November design', `${base}: a blank draft gives way to the linked terms`);
    assert.notEqual((await draft()).id, blank.id, `${base}: the linked report gets its own identity`);
    await page.evaluate(key => localStorage.removeItem(key), draftKey);
    await at('/report'); await list.waitFor();
    await page.getByRole('button', { name: 'New report', exact: true }).click(); await form.waitFor();
    await page.getByLabel('Contributions', { exact: true }).fill('October work in progress');
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.report.contributions === 'October work in progress', draftKey);
    const kept = await draft();
    await at(`/report?agreement=${november.id}`); await list.waitFor();
    await page.getByText('You have an unsent report on October engineering. Resume it and save or submit it, then open this link again to start a report on November design.').waitFor();
    assert.equal(await form.count(), 0, `${base}: another agreement's draft is not shown as the linked report`);
    assert.deepEqual(await draft(), kept, `${base}: that draft and its identity are kept`);
    await page.getByRole('button', { name: 'Resume draft' }).click(); await form.waitFor();
    assert.equal(await page.locator('#agreement option:checked').innerText(), 'October engineering', `${base}: resuming opens that draft on its own terms`);
    assert.equal(await page.getByLabel('Contributions', { exact: true }).inputValue(), 'October work in progress');

    // A link naming a record this account can't see selects nothing and says so; it never falls back to another.
    await page.evaluate(key => localStorage.removeItem(key), draftKey);
    for (const [link, kind] of [[`?agreement=${'d'.repeat(8)}-dddd-4ddd-8ddd-${'d'.repeat(12)}`, 'agreement'], [`?request=${'e'.repeat(8)}-eeee-4eee-8eee-${'e'.repeat(12)}`, 'request']]) {
      await at(`/report${link}`); await list.waitFor();
      await page.getByText(`The ${kind} in this link is not found or not available to this account. Nothing was selected.`).waitFor();
      assert.deepEqual([await form.count(), await opened.count(), await draft()], [0, 0, null], `${base}: an unknown ${kind} opens nothing and starts no draft`);
    }

    // No requests yet: the form comes first.
    await page.evaluate(key => localStorage.removeItem(key), draftKey); requests = [];
    await at('/report'); await form.waitFor();
    assert.equal(await list.count(), 0, `${base}: with no requests the form comes first`);
    await page.close();
  }
  console.log('PASS report place: requests first (form first with none); ?request= survives reload, back and forward; ?agreement= starts on those terms with one draft identity; root and scoped');
}

runTask([reportFirst, reportFailures, agentConnectionsControl, reportPlace]);
