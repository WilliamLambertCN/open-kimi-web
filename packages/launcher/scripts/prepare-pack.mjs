// prepack: stage legal files beside package.json. The official web bundle is
// resolved and cached at runtime, so the package has no bundled frontend.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('..', import.meta.url));
for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  copyFileSync(fileURLToPath(new URL(`../../../${f}`, import.meta.url)), `${pkg}/${f}`);
}
console.log('staged LICENSE, THIRD_PARTY_NOTICES.md');
