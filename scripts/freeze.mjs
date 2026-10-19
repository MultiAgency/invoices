// Freeze a release candidate under .test-artifacts/releases/<digest>/ from the working tree's exact source: a tree
// object (tracked and untracked files, minus .gitignore) built in its own directory against the pinned SDK tarball.
// Nothing is committed, stashed or moved; the record names the base commit, the tree and the paths that differ.
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCandidate } from './candidate.mjs';
import { requireRelease } from './release-mode.mjs';
import { archiveTree, captureTree } from './source-tree.mjs';

requireRelease();
const root = resolve(process.env.RELEASES_ROOT ?? '.test-artifacts/releases');
const source = captureTree();
const candidate = await buildCandidate({ tree: source.tree });
try {
  mkdirSync(root, { recursive: true });
  const id = candidate.releaseServer.stage(root, candidate.dist);
  const readOnly = path => { if (statSync(path).isDirectory()) for (const entry of readdirSync(path)) readOnly(join(path, entry)); chmodSync(path, statSync(path).mode & ~0o222); };
  readOnly(join(root, id));
  // The recorded source survives `git gc` beside the release: <id>.source.tar and its sha256 sidecar.
  archiveTree(source.tree, join(root, `${id}.source.tar`));
  const record = join(root, `${id}.provenance.json`);
  if (!existsSync(record)) writeFileSync(record, JSON.stringify({
    id, frozenAt: new Date().toISOString(), node: process.version,
    sdk: { tarball: candidate.tarball, sha256: candidate.sha256, provenance: candidate.snapshot },
    source,
  }, null, 2) + '\n');
  console.log(id);
} finally { rmSync(candidate.dir, { recursive: true, force: true }); }
