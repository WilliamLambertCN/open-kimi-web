// postpack: remove the legal-file copies staged by prepare-pack.mjs so the
// working tree stays clean (they are gitignored regardless).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('..', import.meta.url));
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  rmSync(`${pkg}/${f}`, { force: true });
}
