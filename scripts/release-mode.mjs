// The SDK dependency spec decides the mode: `link:` for development against Proto's SDK checkout, or the vendored
// tarball for a release candidate. Release steps (freeze, Docker, CI) run only on a release candidate.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SDK = '@multiagency/sdk';

export function sdkMode(dir = '.') {
  const spec = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies?.[SDK] ?? '';
  if (spec.startsWith('link:')) return { mode: 'dev', spec };
  const tarball = spec.match(/^file:vendor\/(multiagency-sdk-[\d.]+\.tgz)$/)?.[1];
  if (tarball) return { mode: 'release', spec, tarball };
  throw new Error(`${SDK} must be a link: (development) or file:vendor/multiagency-sdk-<version>.tgz (release), not ${JSON.stringify(spec)}`);
}

export function requireRelease(dir = '.') {
  const current = sdkMode(dir);
  if (current.mode !== 'release') throw new Error(`dev link: build from a release candidate (${SDK} is ${current.spec})`);
  return current;
}

/** The marker a build records in contract.json: the pinned tarball, or `link` (never a local path). */
export function builtWith() {
  const current = sdkMode();
  return current.mode === 'release' ? current.tarball : 'link';
}

/** Why a build can't be frozen as a release candidate, or null: its dist/ must record the pinned tarball. */
export function freezeRefusal({ tarball, built }) {
  if (built !== tarball) return `dist/ was built with ${built ?? 'no recorded SDK'}, not ${tarball}: rebuild in release mode`;
  return null;
}

/**
 * CI only: test a development commit against the vendored tarball for this run, by pointing package.json at it in
 * the runner's checkout. Nothing is committed, and a build made this way is never a release candidate.
 */
export function useVendored(dir = '.') {
  const tarballs = readdirSync(join(dir, 'vendor')).filter(file => /^multiagency-sdk-[\d.]+\.tgz$/.test(file));
  if (tarballs.length !== 1) throw new Error(`exactly one vendored SDK tarball is needed, found ${tarballs.join(', ') || 'none'}`);
  const file = join(dir, 'package.json'), pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.dependencies[SDK] = `file:vendor/${tarballs[0]}`;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  return tarballs[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--use-vendored') console.log(`development commit: testing against vendor/${useVendored()}`);
    else console.log(`${SDK}: ${requireRelease().tarball}`);
  } catch (error) { console.error(error.message); process.exit(1); }
}
