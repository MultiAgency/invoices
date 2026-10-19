import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve('dist'), contract = JSON.parse(readFileSync(join(dist, 'contract.json'), 'utf8'));
const releaseServer = createRequire(import.meta.url).resolve('@multiagency/sdk/release-server');

test('the build is a complete release for the shared release server, with no server or API of its own', () => {
  assert.deepEqual([contract.version, contract.product], [1, 'invoices']);
  assert.ok(contract.required.includes('supplier-compensation-v2'));
  // One app: every payee entry is the same page; the router resolves the route in the browser.
  assert.deepEqual(contract.entries, { '/': 'index.html', '/submit': 'index.html', '/report': 'index.html', '/skill.md': 'skill.md' });
  for (const file of Object.values(contract.entries)) assert.ok(existsSync(join(dist, file)), file);
  for (const file of ['server.mjs', 'invoice-browser.js', 'contributor.html']) assert.ok(!existsSync(join(dist, file)), `${file} is not part of a release`);
  const html = readFileSync(join(dist, 'index.html'), 'utf8'), scripts = [...html.matchAll(/src="\/invoice-ui(\/static\/js\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.length > 0 && scripts.every(file => /\.[a-f0-9]{10}\.js$/.test(file) && existsSync(join(dist, file))), 'the page loads only content-hashed bundles from the release');
  assert.ok(!html.includes('AGENT_GRANT_TOKEN'));
});

test('the release runs as its own process with only HOST, PORT and RELEASES_ROOT; private routes and writes do not exist', async () => {
  const env = { HOST: '127.0.0.1', PORT: '0', RELEASES_ROOT: join(mkdtempSync(join(tmpdir(), 'invoices-build-')), 'releases') };
  const cli = (...args) => execFileSync(process.execPath, [releaseServer, ...args], { env, cwd: tmpdir(), encoding: 'utf8' }).trim();
  const id = cli('stage', dist); cli('activate', id);
  const child = spawn(process.execPath, [releaseServer], { env, cwd: tmpdir(), stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const origin = await new Promise((resolve, reject) => { let out = ''; child.stdout.on('data', c => { out += c; const m = out.match(/ready on (http:\S+)/); if (m) resolve(m[1]); }); child.once('exit', code => reject(new Error(`exited ${code}`))); });
    assert.deepEqual(await (await fetch(origin + '/health')).json(), { ok: true, product: 'invoices', release: id });
    const scoped = '/i/own-' + 'a'.repeat(24);
    for (const path of ['/', '/submit', '/report', scoped + '/', scoped + '/report']) assert.equal((await fetch(origin + path)).status, 200, path);
    const served = await fetch(origin + '/skill.md'), skill = await served.text();
    assert.equal(served.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.match(skill, /^---\nname: multiagency-builder-onboarding\n/);
    assert.ok(!skill.includes('payables.multiagency.ai/skill.md'));
    for (const path of ['/api/invoices', '/internal/agreements', '/.env', '/i/unknown/', '/server.mjs']) assert.equal((await fetch(origin + path)).status, 404, path);
    assert.equal((await fetch(origin + '/', { method: 'POST' })).status, 405);
    const html = await (await fetch(origin + '/report')).text();
    for (const [script] of html.matchAll(/\/invoice-ui\/static\/js\/[^"]+\.js/g)) assert.equal((await fetch(origin + script)).status, 200, script);
  } finally { child.kill(); }
});
