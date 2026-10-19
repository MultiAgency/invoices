import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stage, activate, releaseServer } from '@multiagency/sdk/release-server';

// The built release under Proto's shared release server: retained hashed assets keep an open page loading
// across a switch, rollback is a pointer change, and the entries stay the explicit set Invoices declares.
test('releases switch and roll back while pages opened under the earlier release keep their assets', async () => {
  const work = mkdtempSync(join(tmpdir(), 'invoices-release-')), root = join(work, 'releases'), b = join(work, 'b');
  cpSync('dist', b, { recursive: true });
  // Release B: a changed app bundle under a new content hash, as any rebuild with changed code produces.
  const js = join(b, 'static/js'), old = readdirSync(js).find(n => /^index\.[a-f0-9]+\.js$/.test(n)), next = old.replace(/\.[a-f0-9]+\.js$/, '.0123456789.js');
  writeFileSync(join(js, old), readFileSync(join(js, old), 'utf8') + '\n// release B\n'); renameSync(join(js, old), join(js, next));
  writeFileSync(join(b, 'index.html'), readFileSync(join(b, 'index.html'), 'utf8').replace(old, next));
  const a = stage(root, 'dist'), idB = stage(root, b);
  activate(root, a);
  const server = releaseServer(root); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, get = path => fetch(origin + path);
  const assets = html => [...html.matchAll(/\/invoice-ui\/static\/[\w./-]+/g)].map(m => m[0]);
  try {
    const pageA = await (await get('/report')).text(), assetsA = assets(pageA);
    assert.ok(assetsA.length >= 3 && assetsA.some(p => p.includes(old)));
    assert.equal((await get('/report')).headers.get('x-release-id'), a);
    activate(root, idB);
    const pageB = await (await get('/i/own-' + 'a'.repeat(24) + '/report')).text();
    assert.ok(pageB.includes(next) && !pageB.includes(old), 'new loads get release B');
    // Retained means release A's own bytes, not merely a 200.
    for (const path of assetsA) {
      const response = await get(path);
      assert.equal(response.status, 200, `open release-A page still loads ${path}`);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join('dist', path.slice('/invoice-ui'.length)))), `${path} is release A's bytes`);
    }
    assert.equal((await get('/invoice-ui/static/js/' + next)).status, 200);
    activate(root, a);
    assert.equal((await get('/report')).headers.get('x-release-id'), a, 'rollback is a pointer change');
    // A page opened under B before the rollback keeps loading B's own bytes.
    const assetsB = assets(pageB);
    assert.ok(assetsB.some(p => p.includes(next)));
    for (const path of assetsB) {
      const response = await get(path);
      assert.equal(response.status, 200, `open release-B page still loads ${path} after rollback`);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(readFileSync(join(b, path.slice('/invoice-ui'.length)))), `${path} is release B's bytes after rollback`);
    }
    for (const path of ['/api/invoices', '/server.mjs', '/release-server.mjs', '/.env', '/i/unknown/']) assert.equal((await get(path)).status, 404, path);
  } finally { await new Promise(r => server.close(r)); }
});
