// Builds a release candidate from its recorded source (a tree object, or that tree's archive), in a directory holding
// exactly that source, against the pinned SDK tarball. Freeze and verify share this path, so a frozen release can
// always be rebuilt from its record.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeRefusal, requireRelease } from './release-mode.mjs';
import { exportSource } from './source-tree.mjs';

export async function buildCandidate(source) {
  const { dir, from } = exportSource(source), run = (command, ...args) => execFileSync(command, args, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  const { tarball } = requireRelease(dir);
  const [recorded] = readFileSync(join(dir, 'vendor', `${tarball}.sha256`), 'utf8').trim().split(/\s+/);
  const sha256 = createHash('sha256').update(readFileSync(join(dir, 'vendor', tarball))).digest('hex');
  if (sha256 !== recorded) throw new Error(`vendor/${tarball} does not match its recorded sha256`);
  run('pnpm', 'install', '--frozen-lockfile', '--prefer-offline');
  run(process.execPath, 'scripts/build.mjs');
  const refusal = freezeRefusal({ tarball, built: JSON.parse(readFileSync(join(dir, 'dist/contract.json'), 'utf8')).sdk });
  if (refusal) throw new Error(refusal);
  // The candidate's own installed SDK, through its exported entry.
  const releaseServer = await import(pathToFileURL(createRequire(join(dir, 'package.json')).resolve('@multiagency/sdk/release-server')));
  return { dir, from, dist: join(dir, 'dist'), tarball, sha256, releaseServer,
    snapshot: JSON.parse(readFileSync(join(dir, 'vendor', tarball.replace(/\.tgz$/, '.provenance.json')), 'utf8')).snapshot };
}
