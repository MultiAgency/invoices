#!/usr/bin/env node
// Payee workflow steps for local demos. Each step drives the actual Invoices page in the payee's
// wallet context of an isolated Proto stack (attached over CDP), captures what Proto returned, prints one
// JSON result line and appends it to a receipt. Proto keeps every record; this keeps only identities it was given.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileResult, requestRecord } from '@multiagency/sdk/payee';

const USAGE = `Usage: node workflow/payee.mjs <step> --session <state.json> --scenario <scenario.json> [--receipt <file>] [options]
Steps (submit/file run once per receipt; resume resends only the page's retained identity after a lost response):
  signin                          sign in on the invoice page and the report page
  invoice submit|status|resume    direct invoice from the scenario's "invoice" {amount, note}
  report submit|status|resume     contribution report from the scenario's "report"
  order list                      work orders for the signed-in payee
  order file|status|resume        the fixed-term invoice of one work order (--order ID)
Options:
  --until S                       status only: poll (reads only) until status/state S or --timeout seconds
  --fault lost-response           SIMULATED: Proto processes the next submission, the browser never receives its response
  --confirm step|human            order file: the step accepts the page's confirmation (default), or leaves it to a person (filming)`;
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  session: { type: 'string' }, scenario: { type: 'string' }, receipt: { type: 'string' }, order: { type: 'string' },
  until: { type: 'string' }, timeout: { type: 'string', default: '180' }, fault: { type: 'string' }, confirm: { type: 'string', default: 'step' }, help: { type: 'boolean' } } });
const step = positionals.join(' ');
if (values.help || !step) { console.log(USAGE); process.exit(values.help ? 0 : 2); }
if (!values.session || !values.scenario) throw new Error('--session and --scenario are required');
if (values.fault && values.fault !== 'lost-response') throw new Error(`Unknown fault ${values.fault}`);
if (!['step', 'human'].includes(values.confirm)) throw new Error(`Unknown --confirm ${values.confirm}`);

// Proto's shared stack (`stack/state.json`) names the payee origin `payee`; explore sessions call it `invoices`.
const session = JSON.parse(readFileSync(values.session, 'utf8'));
const scenario = JSON.parse(readFileSync(values.scenario, 'utf8'));
const payee = typeof scenario.payee === 'string' ? { account: scenario.payee } : scenario.payee;
const name = scenario.name ?? basename(values.scenario, '.json');
// Payables' story files carry the request at top level (`amountUsdc`, `note`); Invoices' examples use `invoice`.
const invoiceInput = scenario.invoice ?? (scenario.amountUsdc && { amount: scenario.amountUsdc, note: scenario.note });
const origin = new URL(session.payee ?? session.invoices).origin;
// Local simulated stacks only: deployment is paused and this script must never reach a live executor.
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error(`Refusing non-local payee origin ${origin}`);
const base = origin + (payee.base ?? '');
const receiptPath = resolve(values.receipt ?? `.test-artifacts/workflow/${name}.json`);
const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8'))
  : { version: 1, scenario: name, payeeOrigin: base, simulated: session.simulated ?? 'simulated provider, chain and wallet', identities: {}, steps: [] };
if (receipt.payeeOrigin !== base) throw new Error(`Receipt belongs to ${receipt.payeeOrigin}; use a new receipt for ${base}`);
function save(result, identities = {}) {
  Object.assign(receipt.identities, identities);
  if (values.fault) result = { fault: `${values.fault} (simulated)`, ...result };
  receipt.steps.push({ at: new Date().toISOString(), step, ...result });
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ step, ...result }));
}
const UNKNOWN = { outcome: 'unknown', next: 'The response was lost, failed or unreadable, so the outcome is unknown. Do not submit a replacement. Run the status step; resume resends only the same retained identity.' };
const ACCESS = {
  session: 'The session ended before this was confirmed. Sign in again as the payee, then run resume: it resends the same retained identity.',
  forbidden: 'This account may not do that here. Sign in as the payee named in the scenario, then run resume with the same retained identity.',
};
/**
 * Proto's answer to a submission, classified as the page's platform client does: no answer, a 5xx, an unreadable
 * body or a 2xx that isn't the expected record leaves the outcome unknown (resumable); 401 and 403 end access with
 * the identity kept; only another 4xx is a definitive refusal.
 */
function classify({ response, status, json, readable }, schema) {
  if (!response) return { kind: 'unknown' };
  if (status === 401) return { kind: 'session', http: status, error: json?.error };
  if (status === 403) return { kind: 'forbidden', http: status, error: json?.error };
  if (!readable) return { kind: 'unknown', http: status };
  if (response.ok()) { const parsed = schema.safeParse(json); return parsed.success ? { kind: 'recorded', value: parsed.data } : { kind: 'unknown', http: status }; }
  if (status >= 500) return { kind: 'unknown', http: status };
  return { kind: 'refused', http: status, code: json?.code, error: json?.error };
}
/** The step result for an outcome that keeps the identity: unknown, or access ended. */
function kept({ kind, http, error }) {
  if (kind === 'unknown') return { ...UNKNOWN, ...(http && { http }) };
  process.exitCode = 1;
  return { outcome: kind, http, error, next: ACCESS[kind] };
}
const KEPT = new Set(['unknown', 'session', 'forbidden']);
// Statuses Proto reports when the payment outcome itself is unproven: observe, never replace.
const RECONCILE = new Set(['unknown', 'needs_review', 'failed']);
const guidance = status => RECONCILE.has(status) ? { next: 'Needs reconciliation by the operator. Do not create a replacement; keep observing this identity.' } : {};

// Attach to the payee's own wallet context: the one whose page is on the payee origin, never the owner's.
const browser = await chromium.connectOverCDP(session.cdp);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(origin));
if (!page) { await browser.close(); throw new Error(`No payee wallet page on ${origin} in the attached browser`); }
const api = (path, method = 'GET') => response => response.url().split('?')[0] === base + path && response.request().method() === method;

// A wallet chooser appears only when the connector has no remembered wallet; otherwise sign-in completes directly.
async function chooseWallet(signedIn) {
  const chooser = page.getByText('Local test wallet', { exact: true });
  await Promise.race([chooser.click().catch(() => {}), signedIn.waitFor()]);
  await signedIn.waitFor();
}
async function openInvoices(query = '') {
  const loaded = page.waitForResponse(api('/api/session'));
  await page.goto(base + '/' + query);
  const { account } = await (await loaded).json();
  if (!account) { await page.getByRole('button', { name: 'Sign in with NEAR' }).click(); await chooseWallet(page.locator('#portal-session')); }
  const signed = (await page.locator('#account').textContent()).trim();
  if (signed !== payee.account) throw new Error(`Signed in as ${signed}, scenario expects ${payee.account}`);
  return signed;
}
async function openReports() {
  const loaded = page.waitForResponse(api('/api/session')), view = page.waitForResponse(api('/api/compensation'));
  await page.goto(base + '/report');
  const { account } = await (await loaded).json();
  if (!account) { await page.getByRole('button', { name: 'Sign in with NEAR' }).click(); await chooseWallet(page.locator('#portal-session')); }
  const value = await (await view).json();
  if (value.account !== payee.account) throw new Error(`Signed in as ${value.account}, scenario expects ${payee.account}`);
  return value;
}

/** SIMULATED fault: fail the browser's connection after Proto has answered the next POST to `path`. Returns when armed. */
async function loseNextResponse(path) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*${path}`, requestStage: 'Response' }] });
  return { lost: new Promise(resolve => cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== base + path) return cdp.send('Fetch.continueRequest', { requestId }).catch(() => {});
    await cdp.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' }).catch(() => {});
    await cdp.send('Fetch.disable').catch(() => {});
    resolve(null);
  })) };
}
/** Clicks the page's own control and returns the exact submitted body and Proto's response (null when lost). */
async function submitted(path, click, waitMs = 15_000) {
  const target = r => r.url().split('?')[0] === base + path && r.method() === 'POST';
  const posted = page.waitForRequest(target, { timeout: waitMs }).catch(() => null);
  // Another client (the stack's wallet boundary) also intercepts these requests, so only `response` and
  // `requestfailed` reliably reach this attached client; a silent loss falls back to a bounded wait.
  const outcomes = [page.waitForResponse(r => target(r.request()), { timeout: 120_000 }).catch(() => null),
    page.waitForEvent('requestfailed', { predicate: target, timeout: 120_000 }).then(() => null, () => null)];
  if (values.fault) outcomes.push((await loseNextResponse(path)).lost);
  await click();
  const request = await posted;
  if (!request) return { notSent: true };
  const response = await Promise.race(outcomes);
  if (!response) return { body: request.postDataJSON(), response };
  const text = await response.text().catch(() => null);
  let json, readable = text !== null;
  try { json = readable ? JSON.parse(text) : undefined; } catch { readable = false; }
  return { body: request.postDataJSON(), response, status: response.status(), json, readable };
}
// Status reads only: polling never submits, confirms or retries anything.
async function until(read, done) {
  const deadline = Date.now() + Number(values.timeout) * 1000;
  for (;;) {
    const value = await read();
    if (!values.until || done(value) || Date.now() > deadline) return value;
    await page.waitForTimeout(3_000);
  }
}
const once = (kind, hint) => { if (receipt.identities[kind]) throw new Error(`This receipt already holds ${kind} ${JSON.stringify(receipt.identities[kind])}. Run "${kind} status"${hint ?? ''}.`); };
const resumable = kind => {
  const held = receipt.identities[kind];
  if (!KEPT.has(held?.outcome)) throw new Error(!held ? `Nothing to resume: no ${kind} in this receipt.`
    : held.outcome === 'refused' ? `Proto refused this ${kind}; resume never resends a refused submission. Correct it in the page instead.`
    : `Proto recorded this ${kind}; resume never resends a recorded submission. Run "${kind} status".`);
  return held;
};

// Direct invoice. The page mints one submission identity per filled-in form and retains it until Proto answers.
const invoiceDraftKey = account => `invoice-draft:${payee.base ? payee.base + ':' : ''}${account}`;
const clickInvoice = () => page.getByRole('button', { name: /^(Submit invoice|Send request)$/ }).click();
function recordInvoice(result, submission = result.body?.submission) {
  if (result.notSent) throw new Error('The page sent no invoice request; nothing was submitted.');
  const answer = classify(result, fileResult);
  if (KEPT.has(answer.kind)) return save({ ...kept(answer), submission }, { invoice: { submission, outcome: answer.kind } });
  if (answer.kind === 'refused') { process.exitCode = 1; return save({ outcome: 'refused', submission, http: answer.http, code: answer.code, error: answer.error }, { invoice: { submission, outcome: 'refused' } }); }
  const { id, status } = answer.value;
  save({ outcome: 'recorded', submission, invoiceId: id, status, ...guidance(status) }, { invoice: { submission, id, status } });
}
// Contribution report. The page keeps its draft and command identity until Proto returns the saved record.
const reportDraftKey = account => `report:${base}:${account}`;
const clickReport = () => page.getByRole('button', { name: /^(Submit|Resubmit)$/ }).click();
function recordReport(result) {
  if (result.notSent) throw new Error('The page sent no report request; nothing was submitted.');
  const { body } = result, answer = classify(result, requestRecord);
  if (KEPT.has(answer.kind)) return save({ ...kept(answer), requestId: body.id, commandId: body.commandId }, { report: { id: body.id, commandId: body.commandId, outcome: answer.kind } });
  if (answer.kind === 'refused') { process.exitCode = 1; return save({ outcome: 'refused', http: answer.http, code: answer.code, error: answer.error }, { report: { id: body.id, commandId: body.commandId, outcome: 'refused' } }); }
  const { id, version, state } = answer.value;
  save({ outcome: 'recorded', requestId: id, commandId: body.commandId, version, state }, { report: { id, commandId: body.commandId, version, state } });
}
// Work order filing. The order fixes recipient, amount and deadline; filing carries no terms of its own.
async function openOrder(id) {
  const detail = page.waitForResponse(api(`/api/work-orders/${id}`));
  await openInvoices(`?workOrder=${id}`);
  return (await detail).json();
}
async function fileOrder(id) {
  // The page's own confirmation of the fixed terms. By default running this step is the payee's decision;
  // with --confirm human a person answers it. A listener is always registered: without one this client dismisses it.
  let confirmation;
  page.once('dialog', dialog => { confirmation = dialog.message(); if (values.confirm === 'step') dialog.accept().catch(() => {}); });
  if (values.confirm === 'human') console.error('Waiting up to 5 minutes for the payee to answer the page confirmation…');
  const result = await submitted(`/api/work-orders/${id}/file`, () => page.getByRole('button', { name: /work order invoice$/ }).click(), values.confirm === 'human' ? 300_000 : 15_000);
  if (result.notSent) { process.exitCode = 1; return save({ outcome: 'not_sent', orderId: id, confirmation, note: 'The confirmation was declined or dismissed; nothing was filed.' }); }
  const answer = classify(result, fileResult);
  if (KEPT.has(answer.kind)) return save({ ...kept(answer), orderId: id }, { order: { id, outcome: answer.kind } });
  if (answer.kind === 'refused') { process.exitCode = 1; return save({ outcome: 'refused', orderId: id, http: answer.http, code: answer.code, error: answer.error }, { order: { id, outcome: 'refused' } }); }
  const { id: invoiceId, status } = answer.value;
  save({ outcome: 'recorded', orderId: id, invoiceId, status, ...guidance(status) }, { order: { id, invoiceId, status } });
}

try {
  if (step === 'signin') {
    const account = await openInvoices();
    const reports = await openReports();
    save({ account, agreements: reports.agreements.length });
  } else if (step === 'invoice submit') {
    once('invoice');
    await openInvoices();
    if (!invoiceInput) throw new Error('The scenario has no invoice inputs ("invoice" or "amountUsdc").');
    await page.getByLabel('Amount (USDC)').fill(invoiceInput.amount);
    await page.getByLabel("What's it for? (optional)").fill(invoiceInput.note ?? '');
    recordInvoice(await submitted('/api/invoices', clickInvoice));
  } else if (step === 'invoice status') {
    const held = receipt.identities.invoice;
    if (!held) throw new Error('No retained invoice in this receipt. Run "invoice submit" first.');
    await openInvoices();
    const list = async () => { const answer = page.waitForResponse(api('/api/invoices')); await page.getByRole('button', { name: 'Check invoice status again' }).click(); return (await (await answer).json()).invoices; };
    const invoice = await until(async () => (await list()).find(i => i.id === held.id), i => i?.status === values.until);
    if (!invoice) save({ found: false, submission: held.submission, note: held.id ? 'Recorded invoice not listed; ask the operator to check it.' : 'The invoice list does not expose submission identities, so a lost response cannot be matched here. See "invoice resume".' });
    else save({ found: true, invoiceId: invoice.id, status: invoice.status, ...guidance(invoice.status) }, { invoice: { ...held, id: invoice.id, status: invoice.status } });
  } else if (step === 'invoice resume') {
    const held = resumable('invoice');
    const account = await openInvoices();
    const draft = JSON.parse(await page.evaluate(key => localStorage.getItem(key), invoiceDraftKey(account)) ?? 'null');
    if (draft?.submission !== held.submission) throw new Error('The page no longer retains this submission. Do not create a replacement; ask the operator to reconcile.');
    recordInvoice(await submitted('/api/invoices', clickInvoice), held.submission);
  } else if (step === 'report submit') {
    once('report');
    const report = scenario.report;
    await openReports();
    // The page opens the form itself when there are no requests yet; otherwise it lists them and offers "New report".
    const form = page.locator('#request-form'), start = page.getByRole('button', { name: 'New report' });
    await form.or(start).first().waitFor();
    if (!(await form.isVisible())) await start.click();
    if (report.amount) { await page.getByLabel('Submission type').selectOption('invoice'); await page.getByLabel('Amount requested · USDC').fill(report.amount); }
    if (report.start) await page.getByLabel('Work period starts').fill(report.start);
    if (report.end) await page.getByLabel('Work period ends').fill(report.end);
    await page.getByLabel('Contributions', { exact: true }).fill(report.contributions);
    await page.getByLabel('Assessment', { exact: true }).fill(report.assessment);
    if (report.evidence?.length) await page.getByLabel('Evidence links').fill(report.evidence.join('\n'));
    recordReport(await submitted('/api/compensation', clickReport));
  } else if (step === 'report status') {
    const held = receipt.identities.report;
    if (!held) throw new Error('No retained report in this receipt. Run "report submit" first.');
    await openReports();
    const read = async () => {
      const view = page.waitForResponse(api('/api/compensation'));
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      const value = await (await view).json(), request = value.requests.find(r => r.id === held.id);
      return request && { requestId: request.id, version: request.version, state: request.state, approvedAmount: request.approvedAmount ?? null,
        payment: request.payment, paymentStatus: value.payments.find(p => p.requestId === request.id)?.status ?? null };
    };
    const found = await until(read, r => r && [r.state, r.paymentStatus].includes(values.until));
    save(found ? { found: true, ...found } : { found: false, requestId: held.id, next: held.outcome === 'unknown' ? 'Not recorded or not yet visible. Run "report resume" to resend the same command.' : undefined },
      found ? { report: { ...held, outcome: undefined, version: found.version, state: found.state, payment: found.payment, paymentStatus: found.paymentStatus } } : {});
  } else if (step === 'report resume') {
    const held = resumable('report');
    const { account } = await openReports();
    const draft = JSON.parse(await page.evaluate(key => localStorage.getItem(key), reportDraftKey(account)) ?? 'null');
    if (draft?.id !== held.id || draft?.attempt?.commandId !== held.commandId) throw new Error('The page no longer retains this command. Do not create a replacement; read "report status".');
    // With requests on record the page lists them first; the retained draft opens with "Resume draft".
    const form = page.locator('#request-form'), resumeDraft = page.getByRole('button', { name: 'Resume draft' });
    await form.or(resumeDraft).first().waitFor();
    if (!(await form.isVisible())) await resumeDraft.click();
    const result = await submitted('/api/compensation', clickReport);
    if (result.notSent) throw new Error('The page sent no report request; nothing was resent.');
    if (result.body.commandId !== held.commandId) throw new Error(`The page sent command ${result.body.commandId}, not the retained ${held.commandId}`);
    recordReport(result);
  } else if (step === 'order list') {
    await openInvoices();
    const answer = page.waitForResponse(api('/api/work-orders'));
    await page.getByRole('button', { name: 'Check work orders' }).click();
    const { orders } = await (await answer).json();
    save({ orders: orders.map(({ id, note, amount, until }) => ({ id, note, amount, until })) });
  } else if (step === 'order file') {
    once('order', ', or file from another receipt to model a second tab');
    const id = values.order;
    if (!id) throw new Error('Name the work order with --order ID (from "order list").');
    const order = await openOrder(id);
    // Another tab or an earlier run already filed it: report that one invoice identity and send nothing.
    if (order.invoice?.id) save({ outcome: 'already_filed', orderId: id, invoiceId: order.invoice.id, status: order.invoice.status, ...guidance(order.invoice.status) },
      { order: { id, invoiceId: order.invoice.id, status: order.invoice.status } });
    else if (!order.ready) { process.exitCode = 1; save({ outcome: 'not_ready', orderId: id, unavailable: order.unavailable, invoice: order.invoice, note: 'Waiting for owner authorization or funding. Nothing was filed.' }); }
    else await fileOrder(id);
  } else if (step === 'order status') {
    const held = receipt.identities.order ?? (values.order && { id: values.order });
    if (!held) throw new Error('No retained work order in this receipt; pass --order ID.');
    const order = await until(() => openOrder(held.id), o => o.invoice?.status === values.until);
    save({ orderId: held.id, ready: order.ready, unavailable: order.unavailable, invoiceStatus: order.invoice?.status ?? null, ...guidance(order.invoice?.status) },
      receipt.identities.order ? { order: { ...held, status: order.invoice?.status ?? null } } : {});
  } else if (step === 'order resume') {
    const held = resumable('order'), order = await openOrder(held.id);
    // The lost filing was recorded: report the order's one invoice and send nothing.
    if (order.invoice?.id) save({ outcome: 'already_filed', orderId: held.id, invoiceId: order.invoice.id, status: order.invoice.status, ...guidance(order.invoice.status) },
      { order: { id: held.id, invoiceId: order.invoice.id, status: order.invoice.status } });
    else await fileOrder(held.id); // The order has exactly one invoice identity; filing it again cannot create another.
  } else throw new Error(`Unknown step "${step}".\n${USAGE}`);
} finally { await browser.close(); }
