// Builds the Module Federation remote into dist-remote/ (remoteEntry.js exposing ./Invoices). Separate from `pnpm build`,
// whose dist/ is the immutable standalone release: this never touches it.
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRsbuild, loadConfig } from '@rsbuild/core';
await rm('dist-remote', { recursive: true, force: true });
const web = resolve('web'), { content } = await loadConfig({ cwd: web, path: resolve(web, 'rsbuild.remote.config.ts') });
await (await createRsbuild({ cwd: web, rsbuildConfig: content })).build();
