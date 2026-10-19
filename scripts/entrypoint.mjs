// The image's entrypoint. The image bakes its release outside RELEASES_ROOT (in /app/baked); RELEASES_ROOT is the
// service's persistent volume, which keeps every staged release, ACTIVE and HISTORY across deploys.
// - Each baked release is staged into RELEASES_ROOT unless it is already there (stage verifies an existing copy).
// - An empty volume activates the baked release. A volume with an active release keeps it: a restart or a new image
//   never overrides a rollback; switching is always an explicit `activate <id>`.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { activate, releaseServer, stage } from './release-server.mjs';

const baked = process.env.BAKED_RELEASES ?? '/app/baked', root = process.env.RELEASES_ROOT;
if (!root) throw new Error('RELEASES_ROOT is required');
mkdirSync(root, { recursive: true });
const ids = readdirSync(baked).filter(name => /^[0-9a-f]{64}$/.test(name));
for (const id of ids) if (stage(root, join(baked, id)) !== id) throw new Error(`Baked release ${id} does not match its id`);
const carried = readFileSync(join(baked, 'ACTIVE'), 'utf8').trim();
if (!existsSync(join(root, 'ACTIVE'))) activate(root, carried);
const active = readFileSync(join(root, 'ACTIVE'), 'utf8').trim();
console.log(active === carried ? `Active release ${active}` : `Active release ${active}; this image also carries ${carried} (activate it to switch)`);
const host = process.env.HOST || '127.0.0.1', server = releaseServer(root);
server.listen(Number(process.env.PORT || 0), host, () => console.log(`Release asset server ready on http://${host}:${server.address().port}`));
