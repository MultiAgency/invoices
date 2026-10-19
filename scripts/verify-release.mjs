// Verify a frozen release against its record: rebuild it from the recorded source tree and require the same digest,
// and require the frozen directory itself to still match its id. Also reports where the working tree has moved on.
// Usage: node scripts/verify-release.mjs <id>
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCandidate } from './candidate.mjs';
import { changedSince } from './source-tree.mjs';

const id = process.argv[2], root = resolve(process.env.RELEASES_ROOT ?? '.test-artifacts/releases');
if (!/^[0-9a-f]{64}$/.test(id ?? '')) { console.error('Usage: node scripts/verify-release.mjs <release id>'); process.exit(2); }
const record = JSON.parse(readFileSync(join(root, `${id}.provenance.json`), 'utf8'));
const candidate = await buildCandidate({ tree: record.source.tree, archive: join(root, `${id}.source.tar`) });
try {
  const problems = [];
  const rebuilt = candidate.releaseServer.digest(candidate.dist), frozen = candidate.releaseServer.digest(join(root, id));
  if (frozen !== id) problems.push(`the frozen directory digests to ${frozen}, not its id`);
  if (rebuilt !== id) problems.push(`the recorded source tree ${record.source.tree} rebuilds to ${rebuilt}, not ${id}`);
  if (candidate.sha256 !== record.sdk.sha256) problems.push(`the recorded tree pins SDK ${candidate.sha256}, not the recorded ${record.sdk.sha256}`);
  const moved = changedSince(record.source.tree);
  console.log(JSON.stringify({ id, verified: problems.length === 0, problems, source: { tree: record.source.tree, from: candidate.from }, workingTreeChangedSince: moved }, null, 2));
  if (problems.length) process.exitCode = 1;
} finally { rmSync(candidate.dir, { recursive: true, force: true }); }
