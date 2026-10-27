import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { embeddedBase } from '../web/src/shared/embed.ts';

test('the embedding base is a plain path on the host\'s own origin, and nothing else', () => {
  assert.equal(embeddedBase('/invoices-api'), '/invoices-api');
  assert.equal(embeddedBase('/a/b_c-d'), '/a/b_c-d');
  assert.equal(embeddedBase('/'), '', 'the host root');
  for (const bad of [undefined, null, 1, '', 'invoices-api', 'https://gateway.example', '//gateway.example', 'http://x/y', '/a/../b', '/a b', '/a?x=1',
    '/a#x', '/a//b', '/a/', '\\\\x', '/%2e%2e/x', 'javascript:alert(1)']) assert.equal(embeddedBase(bad), null, String(bad));
});

// Needs `pnpm build:remote` first (CI does it); the standalone release in dist/ is not involved.
const manifest = 'dist-remote/mf-manifest.json';
test('the federation build exposes the Invoices mount and shares React', { skip: existsSync(manifest) ? false : 'run pnpm build:remote first' }, () => {
  const built = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(built.name, 'invoices');
  assert.equal(built.metaData.remoteEntry.name, 'remoteEntry.js');
  assert.deepEqual(built.exposes.map(e => e.path), ['./Invoices']);
  const shared = Object.fromEntries(built.shared.map(s => [s.name, s.singleton]));
  assert.deepEqual([shared.react, shared['react-dom']], [true, true]);
});
