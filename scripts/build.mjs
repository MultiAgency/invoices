import { writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRsbuild, loadConfig } from '@rsbuild/core';
import { builtWith } from './release-mode.mjs';
// Every release is built from an empty directory, so its contents depend only on the source.
await rm('dist', { recursive: true, force: true });
const web = resolve('web'), { content } = await loadConfig({ cwd: web });
await (await createRsbuild({ cwd: web, rsbuildConfig: content })).build();
// The payee skill for a contributor's agent, served by this app on its own host.
await copyFile('public/skill.md', 'dist/skill.md');
// Capabilities for Proto's gateway check; entries, strip and assetPrefix for the shared release server (P2 D5).
await writeFile('dist/contract.json', JSON.stringify({version:1, product:'invoices', required:['supplier-session-v1','supplier-invoices-v1','supplier-work-orders-v1','supplier-work-order-requests-v1','supplier-compensation-v2'],
  // Used only when the platform offers it; the page hides the control otherwise.
  optional:['supplier-agent-connections-v1'],
  entries:{'/':'index.html','/submit':'index.html','/report':'index.html','/skill.md':'skill.md'}, strip:'/i/own-[a-f0-9]{24}', assetPrefix:'/invoice-ui',
  // Which SDK built this: the pinned tarball for a release candidate, or `link` for a development build.
  sdk:builtWith()},null,2));
