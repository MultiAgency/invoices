// Local preview: stage and activate dist/ as a release, then run Proto's shared release server on it.
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const server = createRequire(import.meta.url).resolve('@multiagency/sdk/release-server');
const env = { HOST: process.env.HOST ?? '127.0.0.1', PORT: process.env.PORT ?? '3011', RELEASES_ROOT: process.env.RELEASES_ROOT ?? '.test-artifacts/local-releases' };
const cli = (...args) => execFileSync(process.execPath, [server, ...args], { env, encoding: 'utf8' }).trim();
cli('activate', cli('stage', 'dist'));
spawn(process.execPath, [server], { env, stdio: 'inherit' }).on('exit', code => process.exit(code ?? 1));
