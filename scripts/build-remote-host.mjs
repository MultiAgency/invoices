// Test helper: builds the stand-in host app (test/remote-host) into .test-artifacts/remote-host.
import { resolve } from 'node:path';
import { createRsbuild, loadConfig } from '@rsbuild/core';
const cwd = resolve('test/remote-host'), { content } = await loadConfig({ cwd, path: resolve(cwd, 'rsbuild.config.ts') });
await (await createRsbuild({ cwd, rsbuildConfig: content })).build();
