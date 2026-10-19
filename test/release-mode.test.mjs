// The SDK mode gate: only the pinned tarball is a release candidate, and a candidate freezes only with a dist/
// built in release mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { freezeRefusal } from '../scripts/release-mode.mjs';

const gate = resolve('scripts/release-mode.mjs');
const check = spec => {
  const dir = mkdtempSync(join(tmpdir(), 'invoices-mode-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@multiagency/sdk': spec } }));
  return spawnSync(process.execPath, [gate], { cwd: dir, encoding: 'utf8' });
};

test('release steps refuse a dev link and anything but the vendored tarball', () => {
  const linked = check('link:../../proto/packages/sdk');
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /^dev link: build from a release candidate \(@multiagency\/sdk is link:\.\.\/\.\.\/proto\/packages\/sdk\)/);
  const other = check('^0.0.1');
  assert.equal(other.status, 1);
  assert.match(other.stderr, /must be a link: \(development\) or file:vendor\/multiagency-sdk-<version>\.tgz \(release\)/);
  const pinned = check('file:vendor/multiagency-sdk-0.0.1.tgz');
  assert.deepEqual([pinned.status, pinned.stdout.trim()], [0, '@multiagency/sdk: multiagency-sdk-0.0.1.tgz']);
});

test('a candidate freezes only from a dist/ built in release mode', () => {
  const tarball = 'multiagency-sdk-0.0.1.tgz';
  assert.equal(freezeRefusal({ tarball, built: tarball }), null);
  assert.match(freezeRefusal({ tarball, built: 'link' }), /^dist\/ was built with link, not multiagency-sdk-0\.0\.1\.tgz: rebuild in release mode$/);
  assert.match(freezeRefusal({ tarball, built: undefined }), /built with no recorded SDK/);
  assert.match(freezeRefusal({ tarball, built: 'multiagency-sdk-0.0.0.tgz' }), /built with multiagency-sdk-0\.0\.0\.tgz/);
});
