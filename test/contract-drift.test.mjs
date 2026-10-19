// The platform contract. On a release candidate the vendored tarball is the one installed and comes from a clean,
// recorded Proto snapshot; in development the SDK is linked from Proto's checkout. Either way it provides
// everything this release declares and imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SDK, sdkMode } from '../scripts/release-mode.mjs';

const require = createRequire(import.meta.url), name = SDK, mode = sdkMode().mode;
const releaseOnly = { skip: mode === 'release' ? false : 'dev link: tarball and provenance are checked on release candidates' };
const tarballs = readdirSync('vendor').filter(file => /^multiagency-sdk-[\d.]+\.tgz$/.test(file));
// The package exports no package.json; its root is two levels above the payee entry (dist/contract/payee-entry.js).
const installed = join(dirname(require.resolve(`${name}/payee`)), '..', '..');
const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));

test('one vendored contract tarball is pinned, verified and installed', releaseOnly, () => {
  assert.equal(tarballs.length, 1, `exactly one vendored tarball, found ${tarballs.join(', ')}`);
  const [tarball] = tarballs, bytes = readFileSync(join('vendor', tarball));
  const [recorded, file] = readFileSync(join('vendor', `${tarball}.sha256`), 'utf8').trim().split(/\s+/);
  assert.equal(file, `vendor/${tarball}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), recorded, 'tarball matches its recorded sha256');
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).dependencies[name], `file:vendor/${tarball}`);
  // pnpm installs only the bytes whose integrity the lockfile records for this exact tarball.
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  assert.ok(readFileSync('pnpm-lock.yaml', 'utf8').includes(`resolution: {integrity: ${integrity}, tarball: file:vendor/${tarball}}`), 'lockfile pins this tarball');
  assert.equal(tarball, `multiagency-sdk-${pkg.version}.tgz`, 'installed package is the vendored version');
});

test('the contract comes from a clean, recorded Proto snapshot', releaseOnly, () => {
  const vendored = JSON.parse(readFileSync(join('vendor', tarballs[0].replace(/\.tgz$/, '.provenance.json')), 'utf8'));
  assert.deepEqual(JSON.parse(readFileSync(join(installed, 'provenance.json'), 'utf8')), vendored, 'installed provenance equals the vendored record');
  assert.deepEqual([vendored.name, vendored.version], [name, pkg.version]);
  assert.match(vendored.sourceHead, /^[0-9a-f]{40}$/);
  assert.match(vendored.snapshot?.runDigest ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual([vendored.dirtyPaths, vendored.sourcesDirty], [[], []], 'built from a clean snapshot');
});

test('everything the release declares and the build imports exists in the pinned contract', async () => {
  // Invoices uses only the payee side: zod alone, no owner procedures and no oRPC or AG-UI peers.
  const contract = await import(`${name}/payee`), declared = JSON.parse(readFileSync('dist/contract.json', 'utf8'));
  assert.deepEqual([declared.version, declared.product], [contract.payeeContract.version, contract.payeeContract.product]);
  for (const capability of [...declared.required, ...(declared.optional ?? [])]) assert.ok(contract.payeeContract.capabilities.includes(capability), `capability ${capability}`);
  assert.ok(contract.compatiblePayeeFrontend(declared), 'the pinned contract accepts this release manifest');

  // Everything taken from the package in shipped, build and step-script sources: named, namespace or re-exported,
  // runtime or type-only. A namespace (`*`) needs only an allowed, exported entry.
  const typings = readdirSync(join(installed, 'dist'), { recursive: true }).filter(f => String(f).endsWith('.d.ts')).map(f => readFileSync(join(installed, 'dist', String(f)), 'utf8')).join('\n');
  const exported = new Set([...Object.keys(contract), ...[...typings.matchAll(/export (?:declare )?(?:type|const|function|interface) (\w+)/g)].map(m => m[1])]);
  const files = ['src', 'web/src', 'scripts', 'workflow'].filter(dir => existsSync(dir)).flatMap(dir => readdirSync(dir, { recursive: true }).map(f => join(dir, String(f)))).filter(f => /\.(m?js|tsx?)$/.test(f) && statSync(f).isFile());
  const used = new Map();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const [, n] of source.matchAll(/import\("@multiagency\/sdk\/payee"\)\.(\w+)/g)) used.set(`/payee:${n}`, file);
    for (const [, subpath = ''] of source.matchAll(/(?:import|export)\s+(?:type\s+)?\*\s+(?:as\s+\w+\s+)?from\s+["']@multiagency\/sdk(\/[\w-]+)?["']/g)) used.set(`${subpath}:*`, file);
    for (const [, names, subpath = ''] of source.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@multiagency\/sdk(\/[\w-]+)?["']/g))
      for (const n of names.split(',').map(n => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean)) used.set(`${subpath}:${n}`, file);
    for (const [, n] of source.matchAll(/import\("@multiagency\/sdk"\)\.(\w+)/g)) used.set(`:${n}`, file);
  }
  assert.ok(used.size > 0, 'the build consumes the contract');
  for (const [key, file] of used) assert.ok(key.startsWith('/payee:') || key.startsWith('/release-server:'), `${file} imports ${key.split(':')[1]} from the contract's ${key.split(':')[0] || 'root'} entry; use @multiagency/sdk/payee`);
  for (const file of files) assert.ok(!/@multiagency\/sdk\/(?!payee\b|release-server\b)|owner-(client|contract|inputs|outputs|capabilities)/.test(readFileSync(file, 'utf8')), `${file} must not reach owner procedures`);
  for (const [key, file] of used) {
    const [subpath, n] = key.split(':');
    assert.ok(pkg.exports[`.${subpath}`], `${name}${subpath} is an exported entry`);
    const runtime = await import(`${name}${subpath}`);
    assert.ok(n === '*' || n in runtime || (subpath === '/payee' && exported.has(n)), `${n} from ${name}${subpath} (used in ${file}) is exported by ${pkg.version}`);
  }
});
