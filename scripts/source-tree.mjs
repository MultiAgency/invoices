// The exact source a release candidate is built from: a git tree object of the working tree as it is, tracked and
// untracked files alike (minus what .gitignore excludes). It is written through a temporary index, so no ref, the
// real index and the working files are untouched; nothing is committed or stashed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const git = (args, env = {}) => execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 << 20 }).trim();

/** The working tree's source as a tree object, with its base commit and the paths that differ from it. */
export function captureTree() {
  const scratch = mkdtempSync(join(tmpdir(), 'invoices-index-')), env = { GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    const sourceHead = git(['rev-parse', 'HEAD']);
    git(['read-tree', sourceHead], env);
    git(['add', '-A'], env);
    const tree = git(['write-tree'], env);
    const dirtyPaths = git(['diff', '--name-status', '--no-renames', sourceHead, tree]).split('\n').filter(Boolean);
    return { sourceHead, tree, dirtyPaths };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const sha256Of = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const hasTree = tree => { try { execFileSync('git', ['cat-file', '-e', `${tree}^{tree}`], { stdio: 'ignore' }); return true; } catch { return false; } };

/**
 * Keeps `tree` as a tar archive at `file`, with a `<file>.sha256` sidecar, both read-only. A tree object that no commit
 * references may be pruned by `git gc`; the archive keeps the recorded source without a commit or ref.
 */
export function archiveTree(tree, file) {
  if (!existsSync(file)) {
    execFileSync('git', ['archive', '--format=tar', '--output', file, tree]);
    writeFileSync(`${file}.sha256`, `${sha256Of(file)}  ${basename(file)}\n`);
    for (const path of [file, `${file}.sha256`]) chmodSync(path, 0o444);
  }
  return readFileSync(`${file}.sha256`, 'utf8').split(/\s+/)[0];
}

/**
 * Writes exactly the recorded source into a new temporary directory and returns it with where it came from: the tree
 * object when the repository still has it, otherwise its archive, whose bytes must match the archive's sidecar.
 */
export function exportSource({ tree, archive }) {
  const dir = mkdtempSync(join(tmpdir(), 'invoices-source-'));
  if (hasTree(tree)) { execFileSync('sh', ['-c', 'git archive --format=tar "$0" | tar -x -C "$1"', tree, dir]); return { dir, from: 'tree' }; }
  if (!archive || !existsSync(archive)) throw new Error(`Source tree ${tree} is not in this repository and has no archive`);
  const recorded = readFileSync(`${archive}.sha256`, 'utf8').split(/\s+/)[0];
  if (sha256Of(archive) !== recorded) throw new Error(`${basename(archive)} does not match its recorded sha256`);
  execFileSync('tar', ['-x', '-f', archive, '-C', dir]);
  return { dir, from: 'archive' };
}

/** The paths where the working tree now differs from `tree`, or null when that can't be compared here. */
export function changedSince(tree) {
  if (!hasTree(tree)) return null;
  return git(['diff', '--name-status', '--no-renames', tree, captureTree().tree]).split('\n').filter(Boolean);
}
