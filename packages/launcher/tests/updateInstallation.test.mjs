import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { npmCmdShim } from '../src/update/binEvidence.mjs';
import { identifyInstallation } from '../src/update/installation.mjs';
import { inspectLocalOwner } from '../src/update/localOwner.mjs';
import { resolveTool } from '../src/update/toolResolver.mjs';

const directories = [];
const manifest = { name: 'open-kimi-web', version: '2.1.1-r9', bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' } };
async function temp() {
  const directory = await mkdtemp(join(tmpdir(), 'okw-update-identity-'));
  directories.push(directory);
  return directory;
}
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
}
async function installed(root, platform, bin) {
  const entry = join(root, 'bin/open-kimi-web.mjs');
  const modulePath = join(root, 'src/update/installation.mjs');
  await put(join(root, 'package.json'), manifest);
  await put(entry, '#!/usr/bin/env node\n');
  await put(modulePath, '');
  if (platform === 'win32') await put(bin, npmCmdShim(relative(dirname(bin), entry)));
  else { await mkdir(dirname(bin), { recursive: true }); await symlink(entry, bin); }
  return { modulePath, entryPath: entry, platform, env: {} };
}
async function owner(path, category = 'dependencies') {
  const spec = 'https://github.com/WilliamLambertCN/open-kimi-web/releases/download/v2.1.1-r9/open-kimi-web-2.1.1-r9.tgz';
  const value = { name: 'fixture-owner', version: '1.0.0', [category]: { 'open-kimi-web': spec } };
  await put(join(path, 'package.json'), value);
  await put(join(path, 'package-lock.json'), { lockfileVersion: 3, packages: {
    '': value, 'node_modules/open-kimi-web': { version: manifest.version, bin: manifest.bin,
      ...(category === 'devDependencies' ? { dev: true } : {}) },
  } });
}

afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('actual installation identity, independent of cwd/default prefix', () => {
  it.each(['win32', 'linux'])('recognizes standard custom-prefix global layout on %s', async (platform) => {
    const prefix = join(await temp(), 'prefix with spaces & % value');
    const root = join(prefix, platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'open-kimi-web');
    const bin = join(prefix, platform === 'win32' ? 'open-kimi-web.cmd' : 'bin/open-kimi-web');
    const identity = await identifyInstallation(await installed(root, platform, bin));
    expect(identity).toMatchObject({ kind: 'global', prefix, root, version: manifest.version });
  });
  it.each(['dependencies', 'devDependencies'])('accepts one direct locked local %s', async (category) => {
    const path = await temp();
    await owner(path, category);
    const root = join(path, 'node_modules/open-kimi-web');
    const options = await installed(root, 'win32', join(path, 'node_modules/.bin/open-kimi-web.cmd'));
    expect(await identifyInstallation(options)).toMatchObject({ kind: 'local', owner: path, category });
  });
  it('identifies only the exact source monorepo', async () => {
    const repo = await temp();
    const root = join(repo, 'packages/launcher');
    const options = await installed(root, 'win32', join(repo, 'unused.cmd'));
    await put(join(repo, 'package.json'), { name: 'open-kimi-web-monorepo', private: true, packageManager: 'pnpm@10.33.0' });
    for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.git']) await put(join(repo, name), '');
    expect(await identifyInstallation(options)).toMatchObject({ kind: 'source', repo });
    await put(join(repo, 'package.json'), { name: 'other', private: true });
    await expect(identifyInstallation(options)).rejects.toThrow('monorepo identity');
  });
  it('rejects arbitrary extraction, mismatched entry, npx, links and unknown bin evidence', async () => {
    const prefix = await temp();
    const root = join(prefix, 'node_modules/open-kimi-web');
    const bin = join(prefix, 'open-kimi-web.cmd');
    const options = await installed(root, 'win32', bin);
    await expect(identifyInstallation({ ...options, env: { npm_command: 'exec' } })).rejects.toThrow('npx');
    await expect(identifyInstallation({ ...options, entryPath: options.modulePath })).rejects.toThrow('conflict');
    await put(bin, npmCmdShim(relative(dirname(bin), options.entryPath)) + 'echo unverified\n');
    await expect(identifyInstallation(options)).rejects.toThrow('unknown Windows');
    const extracted = await installed(join(prefix, 'extract'), 'win32', join(prefix, 'other.cmd'));
    await expect(identifyInstallation(extracted)).rejects.toThrow('arbitrary');
    const renamed = await installed(join(prefix, 'node_modules/renamed'), 'win32', join(prefix, 'renamed.cmd'));
    await expect(identifyInstallation(renamed)).rejects.toThrow('renamed');
    const linked = join(prefix, 'linked');
    await symlink(root, linked, 'junction');
    await expect(identifyInstallation({ ...options, modulePath: join(linked, 'src/update/installation.mjs') })).rejects.toThrow();
  });
});

describe('local owner safety evidence', () => {
  it.each([
    ['workspace', (value) => { value.workspaces = ['packages/*']; }],
    ['transitive', (value) => { delete value.dependencies; }],
    ['mixed category', (value) => { value.devDependencies = value.dependencies; }],
    ['official Kimi', (value) => { value.dependencies['@moonshot-ai/kimi-code'] = '2.1.1'; }],
    ['official Kimi owner', (value) => { value.name = '@moonshot-ai/kimi-code'; }],
    ['linked dependency', (value) => { value.dependencies.other = 'file:../other'; }],
    ['other manager', (value) => { value.packageManager = 'pnpm@10.33.0'; }],
  ])('rejects %s owners', async (label, alter) => {
    const path = await temp();
    await owner(path);
    const value = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    alter(value);
    await put(join(path, 'package.json'), value);
    await expect(inspectLocalOwner(path, manifest)).rejects.toThrow();
  });
  it.each(['pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'])('rejects %s conflict', async (name) => {
    const path = await temp();
    await owner(path);
    await put(join(path, name), '');
    await expect(inspectLocalOwner(path, manifest)).rejects.toThrow('conflict');
  });
  it.each([
    (lock) => { lock.lockfileVersion = 1; },
    (lock) => { lock.packages[''].dependencies['open-kimi-web'] = 'stale'; },
    (lock) => { lock.packages['node_modules/open-kimi-web'].version = '2.1.1-r8'; },
    (lock) => { lock.packages['node_modules/open-kimi-web'].bin = {}; },
    (lock) => { lock.packages['node_modules/open-kimi-web'].link = true; },
    (lock) => { lock.lockfileVersion = 2; lock.dependencies = {}; },
  ])('rejects stale lock evidence %#', async (alter) => {
    const path = await temp();
    await owner(path);
    const lock = JSON.parse(await readFile(join(path, 'package-lock.json'), 'utf8'));
    alter(lock);
    await put(join(path, 'package-lock.json'), lock);
    await expect(inspectLocalOwner(path, manifest)).rejects.toThrow();
  });
});

describe('positive tool manifest/bin resolution', () => {
  it('resolves real npm/Corepack to the current Node and JavaScript CLI', async () => {
    for (const name of ['npm', 'corepack']) {
      const tool = await resolveTool(name);
      expect(tool.command).toBe(process.execPath);
      expect(tool.args[0]).toMatch(/\.(?:js|cjs)$/);
    }
  });
  it('rejects an unknown wrapper rather than executing it or trying another copy', async () => {
    const path = await temp();
    await put(join(path, 'node_modules/npm/package.json'), { name: 'npm', bin: { npm: 'bin/npm-cli.js' } });
    await put(join(path, 'node_modules/npm/bin/npm-cli.js'), '#!/usr/bin/env node\n');
    await put(join(path, 'npm.cmd'), '@echo injected\n');
    await expect(resolveTool('npm', { nodePath: join(path, 'node.exe'), platform: 'win32', env: {} })).rejects.toThrow('unknown');
    await expect(resolveTool('other')).rejects.toThrow('unsupported');
    await expect(resolveTool('npm', { nodePath: join(await temp(), 'node'), env: {} })).rejects.toThrow('unavailable');
  });
});
