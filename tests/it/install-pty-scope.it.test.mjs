import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { adjacentNpm, makeInstallContext } from '../../scripts/install.mjs';
import { ensureGitBash } from '../../scripts/install/gitBash.mjs';
import { isolatedNpmEnv } from '../../scripts/install/npm.mjs';

async function packageFixture(root, name, marker, extra = {}) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '1.1.0',
    scripts: { install: 'node lifecycle.cjs install', postinstall: 'node lifecycle.cjs postinstall' }, ...extra }));
  await writeFile(join(root, 'lifecycle.cjs'),
    `require('node:fs').appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name)} + ':' + process.argv[2] + '\\n');`);
}

it('real npm exact-directory rebuild does not execute root, sibling or nested bundled lifecycle scripts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'okw-pty-scope-'));
  try {
    const stage = join(home, 'stage');
    await mkdir(stage);
    for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(join(stage, name), '');
    const marker = join(home, 'lifecycle.log');
    const root = join(home, 'official');
    const pty = join(root, 'node_modules/node-pty');
    await packageFixture(root, '@moonshot-ai/kimi-code', marker,
      { dependencies: { 'node-pty': '1.1.0', other: '1.1.0' } });
    await packageFixture(pty, 'node-pty', marker,
      { dependencies: { 'node-pty': '1.1.0' }, bundleDependencies: ['node-pty'] });
    await packageFixture(join(root, 'node_modules/other'), 'other', marker);
    await packageFixture(join(pty, 'node_modules/node-pty'), 'nested-node-pty', marker);
    const ctx = makeInstallContext({ env: { ...process.env, OPEN_KIMI_WEB_HOME: home }, log: () => {} });
    const npm = await adjacentNpm(ctx.node);
    await ensureGitBash(ctx);
    const shell = process.platform === 'win32' ? ctx.env.KIMI_SHELL_PATH : '/bin/sh';
    await ctx.run(ctx.node, [npm, 'rebuild', pty, '--prefix', root, '--global=false', '--ignore-scripts=false',
      '--rebuild-bundle=false', '--bin-links=false', '--workspaces=false', `--script-shell=${shell}`, '--strict-ssl=true'],
    { cwd: root, env: isolatedNpmEnv(ctx.env, stage, ctx.node, ctx.platform), timeoutMs: 30000 });
    expect((await readFile(marker, 'utf8')).trim().split('\n')).toEqual(['node-pty:install', 'node-pty:postinstall']);
  } finally { await rm(home, { recursive: true, force: true }); }
}, 60000);
