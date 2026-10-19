const { isDeepStrictEqual } = require('node:util');
const contract = require('@multiagency/sdk/payee');

/** Successful payee API answers a fixture may serve, keyed by method and route, with the platform schema they must satisfy. */
const routes = [
  ['GET', /^\/api\/session$/, contract.session],
  ['POST', /^\/api\/signin\/challenge$/, contract.signInChallenge],
  ['POST', /^\/api\/(compensation\/)?signin$/, contract.signInResult],
  ['POST', /^\/api\/signout$/, contract.signOutResult],
  ['GET', /^\/api\/invoices$/, contract.invoicesView],
  ['POST', /^\/api\/invoices(\/[^/]+\/continue)?$/, contract.fileResult],
  ['GET', /^\/api\/work-orders$/, contract.workOrderList],
  ['POST', /^\/api\/work-orders$/, contract.workOrderRequestResult],
  ['GET', /^\/api\/work-orders\/[^/]+$/, contract.publicWorkOrder],
  ['POST', /^\/api\/work-orders\/[^/]+\/file$/, contract.fileResult],
  ['GET', /^\/api\/compensation\/session$/, contract.compensationSession],
  ['GET', /^\/api\/compensation$/, contract.payeeCompensationView],
  ['POST', /^\/api\/compensation$/, contract.requestRecord],
  ['GET', /^\/api\/capabilities$/, contract.capabilities],
  ['GET', /^\/api\/agent-connections$/, contract.agentConnectionList],
  ['POST', /^\/api\/agent-connections$/, contract.agentConnectionStarted],
  ['DELETE', /^\/api\/agent-connections\/[^/]+$/, contract.agentConnectionRevoked],
];
/** Throws when a fixture would serve a successful payee response that Proto's contract does not allow. */
function assertConforms(method, url, options) {
  const status = options?.status ?? 200;
  if (status >= 300 || options?.json === undefined) return;
  const path = new URL(url).pathname.replace(/^\/i\/own-[a-f0-9]{24}(?=\/)/, '');
  const route = routes.find(([m, pattern]) => m === method && pattern.test(path));
  if (!route) return;
  const parsed = route[2].safeParse(options.json);
  if (!parsed.success) throw new Error(`Fixture ${method} ${path} does not conform to the platform contract: ${parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  // What the page receives is the client's parsed value: a field the contract would strip or default is drift too.
  if (!isDeepStrictEqual(parsed.data, options.json)) throw new Error(`Fixture ${method} ${path} has fields the platform contract strips or defaults: ${JSON.stringify(options.json)} parses to ${JSON.stringify(parsed.data)}`);
}
/** Wraps a route so every fulfilled payee answer is checked against the contract first. */
function conformingRoute(route) {
  const fulfill = route.fulfill.bind(route);
  route.fulfill = options => { assertConforms(route.request().method(), route.request().url(), options); return fulfill(options); };
  return route;
}
module.exports = { assertConforms, conformingRoute };
