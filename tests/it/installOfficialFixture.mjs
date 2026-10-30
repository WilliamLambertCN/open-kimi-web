import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function posixOfficialFixture(home) {
  const root = join(home, 'official/lib/node_modules/@moonshot-ai/kimi-code');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.1.1',
    bin: { kimi: 'dist/main.mjs' } }));
  const entry = join(root, 'dist/main.mjs');
  await writeFile(entry, '#!/usr/bin/env node\n' +
    'console.log(process.argv[2] === "web" ? "kimi web --host --port" : "kimi, version 2.1.1");\n');
  await chmod(entry, 0o755);
  const bin = join(home, 'official/bin');
  await mkdir(bin);
  const kimi = join(bin, 'kimi');
  await symlink(entry, kimi);
  return kimi;
}
