import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalNpmCmd, discoverOfficial, OFFICIAL_URL, officialPaths, prepareOfficial,
  officialCommand, runIntegrationCommand, verifyOfficial } from '../../../scripts/install/official.mjs';
import { nodeSupported } from '../../../scripts/install/npm.mjs';
import { assertDownloadUrl } from '../../../scripts/install/network.mjs';

const roots = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'okw-official-unit-'));
  roots.push(home);
  const tools = join(home, 'tools');
  await mkdir(tools);
  const run = vi.fn(async (_command, args) => args.includes('web') ? 'Usage: kimi web --host --port' : 'kimi, version 2.1.1');
  return { home, bin: join(home, 'bin'), prefixBin: join(home, 'npm'), platform: 'win32',
    env: { PATH: tools }, node: process.execPath, npm: join(home, 'npm-cli.js'), run, log: vi.fn() };
}

async function native(ctx, dir = ctx.env.PATH) {
  const file = join(dir, ctx.platform === 'win32' ? 'kimi.exe' : 'kimi');
  await writeFile(file, 'native fixture');
  await chmod(file, 0o755);
  return file;
}

async function npm(ctx) {
  const paths = officialPaths(ctx);
  await mkdir(dirname(paths.entry), { recursive: true });
  await writeFile(join(paths.root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.1.1',
    bin: { kimi: 'dist/main.mjs' } }));
  await writeFile(paths.entry, '#!/usr/bin/env node\n');
  await mkdir(dirname(paths.kimi), { recursive: true });
  await writeFile(paths.kimi, canonicalNpmCmd());
  return paths;
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('official dependency discovery', () => {
  it('requires Node 22.19+ and allows only the exact pinned npm archive', () => {
    for (const version of ['22.18.9', '21.19.0', '20.99.0', '22.19.0-rc.1', '22.19.x']) {
      expect(nodeSupported(version)).toBe(false);
    }
    for (const version of ['22.19.0', '22.23.3', '24.0.0']) expect(nodeSupported(version)).toBe(true);
    expect(assertDownloadUrl(OFFICIAL_URL).hostname).toBe('registry.npmjs.org');
    expect(() => assertDownloadUrl(OFFICIAL_URL.replace('2.1.1', '2.1.2'))).toThrow('not allowed');
  });

  it('discovers missing without writes and preserves existing native installations', async () => {
    const ctx = await fixture();
    expect(await discoverOfficial(ctx)).toEqual({ kind: 'missing' });
    expect(await readdir(ctx.home)).toEqual(['tools']);
    const file = await native(ctx);
    const found = await discoverOfficial(ctx);
    expect(found).toMatchObject({ kind: 'native', path: file });
    await prepareOfficial(ctx, found, '/unused', {});
    expect(ctx.kimi).toBe(file);
    expect(ctx.run).toHaveBeenCalledTimes(2);
  });

  it('does not skip a broken first PATH command to select a later native', async () => {
    const ctx = await fixture();
    const later = join(ctx.home, 'later');
    await mkdir(later);
    const first = await native(ctx);
    await native(ctx, later);
    ctx.env.PATH += `;${later}`;
    ctx.run.mockRejectedValue(new Error('broken first executable'));
    await expect(discoverOfficial(ctx)).rejects.toThrow('broken first');
    expect(ctx.run.mock.calls[0][0]).toBe(first);
  });

  it('rejects absent/relative overrides and mismatched version or missing web capability', async () => {
    const ctx = await fixture();
    ctx.env.OPEN_KIMI_REAL_KIMI = 'relative';
    await expect(discoverOfficial(ctx)).rejects.toThrow('absolute');
    ctx.env.OPEN_KIMI_REAL_KIMI = join(ctx.home, 'missing.exe');
    await expect(discoverOfficial(ctx)).rejects.toThrow('missing');
    const file = await native(ctx);
    ctx.env.OPEN_KIMI_REAL_KIMI = file;
    ctx.run.mockResolvedValue('open-kimi-web 2.1.1-r9');
    await expect(discoverOfficial(ctx)).rejects.toThrow('recognizable');
    ctx.run.mockImplementation(async (_command, args) => args.includes('web') ? 'no web here' : 'kimi, version 2.1.1');
    await expect(discoverOfficial(ctx)).rejects.toThrow('web command');
  });
});

describe('official version and environment boundaries', () => {
  it('compares the complete reported npm version with its manifest instead of a substring', async () => {
    const ctx = await fixture();
    const paths = await npm(ctx);
    for (const version of ['12.1.10', '2.1.10', '2.1.1-beta', '2.1.1+other']) {
      ctx.run.mockResolvedValue(`kimi, version ${version}`);
      await expect(verifyOfficial(ctx, paths.kimi)).rejects.toThrow('matching version');
    }
    for (const version of ['2.1.1', 'v2.1.1', 'kimi, version 2.1.1']) {
      ctx.run.mockImplementation(async (_command, args) => args.includes('web') ? 'kimi web --port' : version);
      await expect(verifyOfficial(ctx, paths.kimi)).resolves.toMatchObject({ kind: 'npm' });
    }
    await writeFile(join(paths.root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code',
      bin: { kimi: 'dist/main.mjs' } }));
    await expect(verifyOfficial(ctx, paths.kimi)).rejects.toThrow('matching version');
  });

  it('rejects real targets inside a differently cased Windows launcher prefix', async () => {
    const ctx = await fixture();
    const protectedRoot = join(ctx.home, 'ProtectedPrefix');
    await mkdir(join(protectedRoot, 'nested'), { recursive: true });
    const target = await native(ctx, join(protectedRoot, 'nested'));
    const linked = join(ctx.env.PATH, 'linked');
    await symlink(protectedRoot, linked, 'junction');
    ctx.prefixBin = protectedRoot.toUpperCase();
    await expect(verifyOfficial(ctx, join(linked, 'nested/kimi.exe'))).rejects.toThrow('resolves into');
    expect(await readFile(target, 'utf8')).toBe('native fixture');
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('uses a single canonical Windows PATH for verification and integration forwarding', async () => {
    const ctx = await fixture();
    const paths = await npm(ctx);
    ctx.env = { ...ctx.env, Path: 'wrong mixed path', path: 'wrong lower path' };
    await verifyOfficial(ctx, paths.kimi);
    const expected = `${dirname(ctx.node)};${ctx.env.PATH}`;
    for (const [, , settings] of ctx.run.mock.calls) {
      expect(settings.env.PATH).toBe(expected);
      expect(Object.keys(settings.env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    }
    await runIntegrationCommand(ctx, paths.kimi, ['--version'], { env: { Path: 'stale', PATH: 'forwarded' } });
    const env = ctx.run.mock.calls.at(-1)[2].env;
    expect(env.PATH).toBe(`${dirname(ctx.node)};forwarded`);
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
  });

});

describe('npm shim and dedicated ownership safety', () => {
  it('verifies exact Windows npm shim via selected Node and rejects injected commands', async () => {
    const ctx = await fixture();
    const paths = await npm(ctx);
    const found = await verifyOfficial(ctx, paths.kimi);
    expect(found.kind).toBe('npm');
    expect(ctx.run.mock.calls[0].slice(0, 2)).toEqual([ctx.node, [paths.entry, '--version']]);
    await runIntegrationCommand(ctx, paths.kimi, ['web', '--help'], { env: ctx.env });
    expect(ctx.run.mock.calls.at(-1)[0]).toBe(ctx.node);
    expect(officialCommand(ctx)).toContain(paths.entry);
    expect(officialCommand({ ...ctx, kimi: paths.kimi, officialInvocation: undefined })).toContain('& ');
    await writeFile(paths.kimi, canonicalNpmCmd() + 'echo injected\n');
    await expect(verifyOfficial(ctx, paths.kimi)).rejects.toThrow('standard kimi npm target');
  });

  it('recognizes POSIX npm symlink target but refuses a foreign package identity', async () => {
    const ctx = await fixture();
    ctx.platform = 'linux';
    const paths = officialPaths(ctx);
    await mkdir(dirname(paths.entry), { recursive: true });
    await mkdir(dirname(paths.kimi));
    await writeFile(paths.entry, '#!/usr/bin/env node\n');
    await writeFile(join(paths.root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.1.1',
      bin: { kimi: 'dist/main.mjs' } }));
    await symlink(paths.entry, paths.kimi);
    expect((await verifyOfficial(ctx, paths.kimi)).kind).toBe('npm');
    await writeFile(join(paths.root, 'package.json'), '{}');
    await expect(verifyOfficial(ctx, paths.kimi)).rejects.toThrow('identity');
  });

  it('refuses partial dedicated prefix even when another native installation exists', async () => {
    const ctx = await fixture();
    await native(ctx);
    await mkdir(officialPaths(ctx).prefix);
    await writeFile(join(officialPaths(ctx).prefix, 'sentinel'), 'keep');
    await expect(discoverOfficial(ctx)).rejects.toThrow('unknown or partial; no automatic resume');
    await expect(discoverOfficial(ctx)).rejects.toThrow('move the partial prefix aside manually');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(await readFile(join(officialPaths(ctx).prefix, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('rejects invalid state and override conflicting with the previous integration', async () => {
    const ctx = await fixture();
    const file = await native(ctx);
    ctx.kimi = file;
    ctx.env.OPEN_KIMI_REAL_KIMI = join(ctx.home, 'other.exe');
    await expect(discoverOfficial(ctx)).rejects.toThrow('conflicts');
    await writeFile(officialPaths(ctx).record, '{bad');
    await expect(discoverOfficial(ctx)).rejects.toThrow('corrupt');
  });

  it('does not create a prefix or run npm on a digest mismatch', async () => {
    const ctx = await fixture();
    ctx.downloadOfficial = vi.fn(async () => Buffer.from('corrupt archive'));
    const progress = {};
    await expect(prepareOfficial(ctx, { kind: 'missing' }, ctx.home, progress)).rejects.toThrow('SHA512');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(progress.label).toBe('official Kimi verified download');
    expect(await readdir(ctx.home)).toEqual(['tools']);
  });
});
