// Offline check of workflow/payee.mjs: the real step script attaches over CDP to a browser whose built Invoices
// page talks to fixture payee APIs. Proves identity retention and the guards that stop replacement submissions.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { conformingRoute } = require('./fixtures/contract.cjs'), { keepFailure, requireEvery } = require('./fixtures/task.cjs');

const dist = resolve(process.argv[2] || 'dist'), work = mkdtempSync(join(tmpdir(), 'invoices-workflow-'));
const origin = 'https://localhost:4433';
const port = await new Promise(done => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const context = await chromium.launchPersistentContext(join(work, 'profile'), { headless: true, executablePath: process.env.BROWSER_EXECUTABLE,
  serviceWorkers: 'block', args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'] });
const session = join(work, 'session.json'), scenario = join(work, 'scenario.json');
writeFileSync(session, JSON.stringify({ cdp: `http://127.0.0.1:${port}`, invoices: origin, simulated: 'offline fixture' }));
const agreement = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, at: '2026-10-16T12:00:00Z', recordedBy: 'owner', approved: '0', remaining: '1000000000', terms: { payee: 'payee.near', title: 'October engineering', document: 'https://example.org/agreement', signedOn: '2026-10-01', start: '2026-10-01', end: '2026-10-31', ceiling: '1000000000', openingApproved: '0', scope: 'Authorized issues' } };
const orderId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
writeFileSync(scenario, JSON.stringify({ name: 'offline', payee: { account: 'payee.near' }, invoice: { amount: '1.25', note: 'Fixture work' },
  report: { start: '2026-10-01', end: '2026-10-15', contributions: 'Shipped the fixture.', assessment: 'Works offline.', evidence: ['https://example.org/pull/1'] } }));
const step = (receipt, ...args) => { const t = Date.now(); return run(receipt, ...args).finally(() => process.env.WORKFLOW_TIMING && console.log(`${args.join(' ')}: ${Date.now() - t}ms`)); };
// A step's result is its last JSON line; a step that exits non-zero after printing one (refused, access ended) still has it.
const last = stdout => stdout?.trim().split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).at(-1);
const run = (receipt, ...args) => promisify(execFile)(process.execPath, ['workflow/payee.mjs', ...args, '--session', session, '--scenario', scenario, '--receipt', join(work, receipt)])
  .then(({ stdout }) => ({ ok: true, out: last(stdout) }), error => ({ ok: false, out: last(error.stdout) ?? String(error.stderr) }));
const receipt = name => JSON.parse(readFileSync(join(work, name), 'utf8'));

// The injected test wallet behind near-connect's real interface; the step script answers its chooser.
await context.addInitScript(() => {
  const accounts = [{ accountId: 'payee.near', publicKey: 'ed25519:fixture' }];
  const wallet = { manifest: { id: 'local-test-wallet', name: 'Local test wallet', type: 'injected', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', features: { signMessage: true } },
    signIn: async () => accounts, getAccounts: async () => accounts, signOut: async () => {}, signMessage: async () => ({ accountId: 'payee.near', publicKey: 'ed25519:fixture', signature: 'fixture' }) };
  window.addEventListener('near-selector-ready', () => window.dispatchEvent(new CustomEvent('near-wallet-injected', { detail: wallet })));
});
// Fixture payee API: one invoice per submission, one request per report id, one invoice per work order, as Proto keys them.
// `answerNext` makes the next POST to a path answer with a planted fault instead, after recording it as Proto would.
const invoices = new Map(), posts = [], requests = new Map(), reportPosts = [], filings = [], answerNext = {};
let orderInvoice = null;
const FAULTS = {
  '502-html': { status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' },
  'invalid-200': { status: 200, contentType: 'application/json', body: '{"accepted":true}' },
  '401': { status: 401, json: { error: 'Sign in again.' } },
  '409': { status: 409, json: { code: 'conflict', error: 'This invoice conflicts with a recorded one. Nothing was filed.' } },
};
const planted = path => { const fault = answerNext[path]; delete answerNext[path]; return fault && FAULTS[fault]; };
await context.route('**/*', async unchecked => {
  const route = conformingRoute(unchecked);
  const url = new URL(route.request().url()), path = url.pathname, method = route.request().method();
  if (url.hostname === 'cdn.jsdelivr.net' && path.endsWith('/manifest.json')) return route.fulfill({ json: { version: '1.0.0', wallets: [] } });
  if (url.origin !== origin) return route.abort();
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: readFileSync(join(dist, 'index.html')) });
  if (path === '/report') return route.fulfill({ contentType: 'text/html', body: readFileSync(join(dist, 'index.html')) });
  if (/^\/invoice-ui\/static\/[\w./-]+$/.test(path)) return route.fulfill({ path: join(dist, path.slice('/invoice-ui'.length)) });
  if (path === '/api/session') return route.fulfill({ json: { account: signedIn ? 'payee.near' : null, agreed: true } });
  if (path === '/api/signin/challenge') return route.fulfill({ json: { nonce: 'AAAA', message: 'Offline sign-in', recipient: 'localhost' } });
  if (path === '/api/signin') { signedIn = true; return route.fulfill({ json: { account: 'payee.near', agreed: true } }); }
  if (path === '/api/compensation' && method === 'POST') {
    const body = route.request().postDataJSON(); reportPosts.push(body);
    if (!requests.has(body.id)) requests.set(body.id, { id: body.id, version: 1, payee: 'payee.near', agreementVersion: 1, report: body.report, state: 'submitted', feedback: '', reviewedBy: null, payment: null, at: '2026-10-16T12:00:00Z' });
    return route.fulfill(planted(path) ?? { json: requests.get(body.id) });
  }
  if (path === '/api/compensation') return route.fulfill({ json: { account: 'payee.near', agreements: [agreement], requests: [...requests.values()], history: [], payments: [] } });
  if (path === '/api/work-orders') return route.fulfill({ json: { orders: [{ id: orderId, amount: '2000000', note: 'Fixture order', until: '2030-01-01T00:00:00.000Z', createdAt: '2026-10-16T12:00:00Z' }] } });
  if (path === `/api/work-orders/${orderId}`) return route.fulfill({ json: { id: orderId, amount: '2000000', note: 'Fixture order', until: '2030-01-01T00:00:00.000Z', createdAt: '2026-10-16T12:00:00Z', invoice: orderInvoice, ready: true, unavailable: false } });
  if (path === `/api/work-orders/${orderId}/file` && method === 'POST') {
    filings.push(orderId);
    orderInvoice ??= { id: 'order-inv-1', amount: '2000000', note: 'Fixture order', filedAt: new Date().toISOString(), status: 'waiting', revisionConflict: false };
    return route.fulfill(planted(path) ?? { json: { id: orderInvoice.id, status: orderInvoice.status } });
  }
  if (path === '/api/invoices' && method === 'POST') {
    const body = route.request().postDataJSON(), fault = planted(path); posts.push(body);
    // A 401 or a 409 is answered before anything is recorded; other faults follow the recorded submission.
    if (![401, 409].includes(fault?.status) && !invoices.has(body.submission))
      invoices.set(body.submission, { id: `inv-${invoices.size + 1}`, status: 'waiting', amount: '1250000', note: body.note, filedAt: new Date().toISOString(), revisionConflict: false });
    return route.fulfill(fault ?? { json: { id: invoices.get(body.submission).id, status: 'waiting' } });
  }
  if (path === '/api/invoices') return route.fulfill({ json: { invoices: [...invoices.values()], agreements: [], agreed: true } });
  return route.fulfill({ status: 404, json: { error: 'Not found' } });
});
let signedIn = false;
// The step script answers the page's confirmations; this client listens without answering so it never dismisses them.
context.pages()[0].on('dialog', () => {});
const log = [];
// One flow: it must run to completion, or the process fails (an await that never settles would otherwise exit 0).
const ran = new Set();
requireEvery('workflow', [{ name: 'workflow' }], ran, () => ({ scenario: ran.size ? undefined : 'workflow', pages: [{ page: context.pages()[0], log }] }));
context.pages()[0].on('console', message => log.push(`[${message.type()}] ${message.text()}`));
context.pages()[0].on('pageerror', error => log.push(`[pageerror] ${error.stack ?? error.message}`));
await context.pages()[0].goto(origin + '/');

try {
  let r = await step('a.json', 'signin');
  assert.equal(r.out.account, 'payee.near', r.out);
  r = await step('a.json', 'invoice', 'submit');
  assert.deepEqual([r.out.outcome, r.out.invoiceId, r.out.status], ['recorded', 'inv-1', 'waiting'], JSON.stringify(r.out));
  r = await step('a.json', 'invoice', 'submit');
  assert.ok(!r.ok && /already holds invoice/.test(r.out), 'a receipt never submits twice');
  r = await step('a.json', 'invoice', 'resume');
  assert.ok(!r.ok && /never resends a recorded submission/.test(r.out), 'resume refuses a recorded invoice');
  r = await step('a.json', 'invoice', 'status');
  assert.deepEqual([r.out.found, r.out.status], [true, 'waiting']);
  console.log('PASS workflow: submission recorded once, status read, replacement and resume refused');

  // Lost response: Proto recorded it, the script saw nothing. Observe first; resume resends the same identity only.
  r = await step('b.json', 'invoice', 'submit', '--fault', 'lost-response');
  assert.equal(r.out.outcome, 'unknown', JSON.stringify(r.out));
  const lost = receipt('b.json').identities.invoice.submission;
  assert.equal(invoices.size, 2);
  r = await step('b.json', 'invoice', 'status');
  assert.equal(r.out.found, false, 'without a returned id the list cannot be matched');
  r = await step('b.json', 'invoice', 'submit');
  assert.ok(!r.ok && /already holds invoice/.test(r.out), 'no replacement after an unknown outcome');
  r = await step('b.json', 'invoice', 'resume');
  assert.deepEqual([r.out.outcome, r.out.invoiceId], ['recorded', 'inv-2'], JSON.stringify(r.out));
  assert.equal(posts.at(-1).submission, lost);
  assert.deepEqual(posts.at(-1), posts.at(-2), 'resume resent the identical retained submission');
  assert.equal(invoices.size, 2, 'no second invoice was created');
  console.log('PASS workflow: lost response stays unknown, replacement refused, resume reuses the retained identity');

  // Answers classified as the page does: a 5xx page or an unreadable 200 is unknown and resumable; a 401 ends the
  // session with the identity kept; a 4xx JSON error is a refusal that resume never resends.
  for (const [fault, outcome, http] of [['502-html', 'unknown', 502], ['invalid-200', 'unknown', 200], ['401', 'session', 401]]) {
    const name = `fault-${fault}.json`;
    answerNext['/api/invoices'] = fault;
    r = await step(name, 'invoice', 'submit');
    assert.deepEqual([r.out.outcome, r.out.http, r.out.invoiceId], [outcome, http, undefined], `${fault}: ${JSON.stringify(r.out)}`);
    assert.equal(r.ok, outcome === 'unknown', `${fault}: only access ending exits non-zero`);
    const held = receipt(name).identities.invoice;
    assert.deepEqual([held.outcome, held.submission], [outcome, posts.at(-1).submission], `${fault}: the receipt keeps the identity`);
    r = await step(name, 'invoice', 'resume');
    assert.equal(r.out.outcome, 'recorded', `${fault} resume: ${JSON.stringify(r.out)}`);
    assert.deepEqual(posts.at(-1), posts.at(-2), `${fault}: resume resent the identical submission`);
  }
  answerNext['/api/invoices'] = '409';
  r = await step('fault-409.json', 'invoice', 'submit');
  assert.deepEqual([r.ok, r.out.outcome, r.out.http, r.out.code], [false, 'refused', 409, 'conflict'], JSON.stringify(r.out));
  const sent = posts.length;
  r = await step('fault-409.json', 'invoice', 'resume');
  assert.ok(!r.ok && /never resends/.test(r.out), 'resume never resends a refused submission');
  assert.equal(posts.length, sent);
  console.log('PASS workflow: 502 HTML and invalid 200 are unknown and resumable, 401 ends the session with the identity kept, 409 is refused and never resent');

  // Report and order: a lost answer is resumed with the same identity, and Proto keeps one record.
  r = await step('report.json', 'report', 'submit', '--fault', 'lost-response');
  assert.equal(r.out.outcome, 'unknown', JSON.stringify(r.out));
  const report = receipt('report.json').identities.report;
  r = await step('report.json', 'report', 'resume');
  assert.deepEqual([r.out.outcome, r.out.requestId, r.out.commandId, r.out.state], ['recorded', report.id, report.commandId, 'submitted'], JSON.stringify(r.out));
  assert.equal(reportPosts.length, 2);
  assert.deepEqual(reportPosts[1], reportPosts[0], 'report resume resent the identical command');
  assert.equal(requests.size, 1, 'one request');
  r = await step('order.json', 'order', 'file', '--order', orderId, '--fault', 'lost-response');
  assert.equal(r.out.outcome, 'unknown', JSON.stringify(r.out));
  r = await step('order.json', 'order', 'resume');
  // Proto recorded the lost filing: resume reads the order's one invoice and files nothing again.
  assert.deepEqual([r.out.outcome, r.out.invoiceId], ['already_filed', 'order-inv-1'], JSON.stringify(r.out));
  assert.equal(filings.length, 1, 'resume sent no second filing');
  console.log('PASS workflow: report and order resume after a lost answer keep one record and the same identity');

  writeFileSync(session, JSON.stringify({ cdp: `http://127.0.0.1:${port}`, invoices: 'https://invoices.example.com' }));
  r = await step('c.json', 'signin');
  assert.ok(!r.ok && /Refusing non-local payee origin/.test(r.out), 'non-local origins are refused');
  console.log('PASS workflow: non-local payee origin refused');
} catch (error) {
  console.error(`Kept failure diagnostics: ${await keepFailure('workflow', 'workflow', error, [{ page: context.pages()[0], log }])}`);
  throw error;
} finally { ran.add('workflow'); await context.close(); }
