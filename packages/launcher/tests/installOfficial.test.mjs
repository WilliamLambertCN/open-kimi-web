import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalNpmCmd, discoverOfficial, OFFICIAL_INTEGRITY, OFFICIAL_URL, OFFICIAL_VERSION, officialPaths,
  prepareOfficial, officialCommand, runIntegrationCommand, verifyOfficial } from '../../../scripts/install/official.mjs';
import { fileDigest, nodeSupported } from '../../../scripts/install/npm.mjs';
import { assertDownloadUrl } from '../../../scripts/install/network.mjs';

const hashing = vi.hoisted(() => ({ archiveIntegrity: null }));
vi.mock('node:crypto', async (original) => {
  const module = await original();
  return { ...module, createHash: (algorithm, ...args) => {
    const hash = module.createHash(algorithm, ...args);
    if (algorithm === 'sha512' && hashing.archiveIntegrity) hash.digest = () => hashing.archiveIntegrity;
    return hash;
  } };
});

const LEGACY_INTEGRITY = 'xClqcnTQUKgKDbeOGPU78qcwxGzL8wA2rqWuOX3CLpyQ1/NhSX7jAh6hZo/JFwThSX8obkgef3uw/li5JaJNyw==';
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

async function npm(ctx, version = '2.1.1') {
  const paths = officialPaths(ctx);
  await mkdir(dirname(paths.entry), { recursive: true });
  await writeFile(join(paths.root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version,
    bin: { kimi: 'dist/main.mjs' } }));
  await writeFile(paths.entry, '#!/usr/bin/env node\n');
  await mkdir(dirname(paths.kimi), { recursive: true });
  if (ctx.platform === 'win32') await writeFile(paths.kimi, canonicalNpmCmd());
  else { await chmod(paths.entry, 0o755); await symlink(paths.entry, paths.kimi); }
  return paths;
}

function officialOutput(args, version) {
  if (args[0].endsWith('ptyProbe.mjs')) return '{"status":"ok"}';
  return args.includes('web') ? 'Usage: kimi web --host --port' : `kimi, version ${version}`;
}

async function owned(ctx, version = '2.1.1', integrity = LEGACY_INTEGRITY) {
  const paths = await npm(ctx, version);
  const record = { schema: 1, version, integrity, prefix: paths.prefix, entry: paths.entry, kimi: paths.kimi,
    entryDigest: await fileDigest(paths.entry), shimDigest: await fileDigest(paths.kimi) };
  await writeFile(paths.record, `${JSON.stringify(record)}\n`);
  ctx.env.KIMI_SHELL_PATH = join(ctx.home, 'fixture-bash.exe');
  ctx.run.mockImplementation(async (_command, args) => officialOutput(args, version));
  ctx.downloadOfficial = vi.fn();
  return { paths, record };
}

function installFixture(ctx, version = OFFICIAL_VERSION) {
  hashing.archiveIntegrity = OFFICIAL_INTEGRITY;
  ctx.env.KIMI_SHELL_PATH = join(ctx.home, 'fixture-bash.exe');
  ctx.downloadOfficial = vi.fn(async () => Buffer.from('verified archive fixture'));
  ctx.run.mockImplementation(async (_command, args) => {
    if (args[0] === ctx.npm && args[1] === 'install') { await npm(ctx, version); return ''; }
    return officialOutput(args, version);
  });
}

afterEach(async () => {
  hashing.archiveIntegrity = null;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('official dependency discovery', () => {
  it('requires Node 22.19+ and allows only the exact pinned npm archive', () => {
    for (const version of ['22.18.9', '21.19.0', '20.99.0', '22.19.0-rc.1', '22.19.x']) {
      expect(nodeSupported(version)).toBe(false);
    }
    for (const version of ['22.19.0', '22.23.3', '24.0.0']) expect(nodeSupported(version)).toBe(true);
    expect(OFFICIAL_VERSION).toBe('2.3.1');
    expect(OFFICIAL_URL).toBe('https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.3.1.tgz');
    expect(OFFICIAL_INTEGRITY).toBe('Ikk41ROPta1eQ6gCXOZd7Ag7fg8B0vawjwA0+MVMi8CphFBbvAz8emr7Lc9cI2dAbBSmvAX16U7Jc/+mPVw7Cg==');
    expect(assertDownloadUrl(OFFICIAL_URL).hostname).toBe('registry.npmjs.org');
    for (const version of ['2.1.1', '2.2.0', '2.3.0', '2.3.2', 'latest']) {
      expect(() => assertDownloadUrl(OFFICIAL_URL.replace('2.3.1', version))).toThrow('not allowed');
    }
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

describe('new pinned official installation', () => {
  it('installs only verified 2.3.1 with scripts disabled and records ownership after its PTY probe', async () => {
    const ctx = await fixture();
    installFixture(ctx);
    const paths = officialPaths(ctx);
    const progress = {};
    await prepareOfficial(ctx, await discoverOfficial(ctx), ctx.home, progress);
    expect(ctx.downloadOfficial).toHaveBeenCalledExactlyOnceWith(OFFICIAL_URL, { env: ctx.env });
    const archive = join(ctx.home, 'official-kimi.tgz');
    expect(await readFile(archive, 'utf8')).toBe('verified archive fixture');
    const [command, args, settings] = ctx.run.mock.calls[0];
    expect(command).toBe(ctx.node);
    expect(args.slice(0, 2)).toEqual([ctx.npm, 'install']);
    expect(args).toEqual(expect.arrayContaining(['--global', '--prefix', paths.prefix, '--ignore-scripts', archive]));
    expect(settings).toMatchObject({ cwd: ctx.home, timeoutMs: 300000 });
    expect(ctx.run.mock.calls.at(-1)[1][0]).toContain('ptyProbe.mjs');
    expect(ctx.run).toHaveBeenCalledTimes(4);
    expect(ctx.kimi).toBe(paths.kimi);
    expect(JSON.parse(await readFile(paths.record, 'utf8'))).toEqual({
      schema: 1, version: OFFICIAL_VERSION, integrity: OFFICIAL_INTEGRITY,
      prefix: paths.prefix, entry: paths.entry, kimi: paths.kimi,
      entryDigest: await fileDigest(paths.entry), shimDigest: await fileDigest(paths.kimi),
    });
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('Official Kimi 2.3.1 installed'));
  });

  it('does not mark a mismatched newly installed package as owned even when its CLI would agree', async () => {
    const ctx = await fixture();
    installFixture(ctx, '2.1.1');
    await expect(prepareOfficial(ctx, { kind: 'missing' }, ctx.home, {})).rejects.toThrow('package version is not pinned');
    expect(ctx.run).toHaveBeenCalledOnce();
    await expect(readFile(officialPaths(ctx).record)).rejects.toThrow();
  });

  it('does not record ownership when a new installation fails its PTY probe', async () => {
    const ctx = await fixture();
    installFixture(ctx);
    const run = ctx.run.getMockImplementation();
    ctx.run.mockImplementation(async (command, args) => args[0].endsWith('ptyProbe.mjs') ?
      '{"status":"failed"}' : run(command, args));
    await expect(prepareOfficial(ctx, { kind: 'missing' }, ctx.home, {})).rejects.toThrow('no unapproved native build');
    await expect(readFile(officialPaths(ctx).record)).rejects.toThrow();
  });
});

describe('strict current and legacy owned official reuse', () => {
  it.each([
    ['win32', '2.1.1', LEGACY_INTEGRITY], ['linux', '2.1.1', LEGACY_INTEGRITY],
    ['win32', OFFICIAL_VERSION, OFFICIAL_INTEGRITY], ['linux', OFFICIAL_VERSION, OFFICIAL_INTEGRITY],
  ])('reuses owned %s %s unchanged without download, npm or upgrade', async (platform, version, integrity) => {
    const ctx = await fixture();
    ctx.platform = platform;
    const { paths } = await owned(ctx, version, integrity);
    const files = [paths.record, paths.entry, paths.kimi, join(paths.root, 'package.json')];
    const before = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const found = await discoverOfficial(ctx);
    expect(found).toEqual({ kind: 'npm', path: paths.kimi, version: `kimi, version ${version}` });
    await prepareOfficial(ctx, found, '/unused', {});
    expect(ctx.kimi).toBe(paths.kimi);
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(ctx.run).toHaveBeenCalledTimes(3);
    expect(ctx.run.mock.calls.at(-1)[1][0]).toContain('ptyProbe.mjs');
    expect(await Promise.all(files.map((file) => readFile(file, 'utf8')))).toEqual(before);
    expect(ctx.log).not.toHaveBeenCalled();
  });

  it.each(['missing', 'failed'])('refuses legacy owned PTY status %s without rebuilding or updating', async (status) => {
    const ctx = await fixture();
    const { paths } = await owned(ctx);
    const found = await discoverOfficial(ctx);
    const before = await readFile(paths.record, 'utf8');
    ctx.run.mockClear().mockResolvedValue(`{"status":"${status}"}`);
    await expect(prepareOfficial(ctx, found, '/unused', {})).rejects.toThrow('no automatic rebuild or reinstall');
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(ctx.run.mock.calls[0][1][0]).toContain('ptyProbe.mjs');
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(paths.record, 'utf8')).toBe(before);
    expect(ctx.kimi).toBeUndefined();
  });
});

describe('strict owned release record boundaries', () => {
  it.each([
    ['schema', { schema: 2 }], ['version', { version: '2.2.0' }], ['integrity', { integrity: 'tampered' }],
    ['crossed release pair', { integrity: OFFICIAL_INTEGRITY }], ['missing integrity', { integrity: undefined }],
    ['prefix', { prefix: '/different' }], ['entry', { entry: '/different' }], ['shim', { kimi: '/different' }],
  ])('refuses a changed %s before running or replacing the legacy package', async (_name, changes) => {
    const ctx = await fixture();
    const { paths, record } = await owned(ctx);
    await writeFile(paths.record, JSON.stringify({ ...record, ...changes }));
    const before = await readFile(paths.record, 'utf8');
    await expect(discoverOfficial(ctx)).rejects.toThrow('unknown or partial; no automatic resume');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(paths.record, 'utf8')).toBe(before);
  });

  it.each([
    ['2.1.1', LEGACY_INTEGRITY, OFFICIAL_VERSION], [OFFICIAL_VERSION, OFFICIAL_INTEGRITY, '2.1.1'],
  ])('requires package version to match record %s, not merely another supported release', async (version, integrity, actual) => {
    const ctx = await fixture();
    await owned(ctx, actual, integrity);
    const paths = officialPaths(ctx);
    const record = JSON.parse(await readFile(paths.record, 'utf8'));
    await writeFile(paths.record, JSON.stringify({ ...record, version }));
    await expect(discoverOfficial(ctx)).rejects.toThrow('ownership or version changed');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });

  it.each(['entry', 'kimi'])('rejects changed legacy %s content by its recorded digest', async (key) => {
    const ctx = await fixture();
    const { paths } = await owned(ctx);
    await writeFile(paths[key], 'tampered fixture');
    await expect(discoverOfficial(ctx)).rejects.toThrow(key === 'entry' ? 'ownership or version changed' : 'shim changed');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(paths[key], 'utf8')).toBe('tampered fixture');
  });

  it('still requires the canonical npm shim when its record digest has been changed to match injected content', async () => {
    const ctx = await fixture();
    const { paths, record } = await owned(ctx);
    await writeFile(paths.kimi, canonicalNpmCmd() + 'echo injected\n');
    await writeFile(paths.record, JSON.stringify({ ...record, shimDigest: await fileDigest(paths.kimi) }));
    await expect(discoverOfficial(ctx)).rejects.toThrow('standard kimi npm target');
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('rejects a legacy CLI version different from its otherwise intact manifest and record', async () => {
    const ctx = await fixture();
    await owned(ctx);
    ctx.run.mockResolvedValue('kimi, version 2.3.1');
    await expect(discoverOfficial(ctx)).rejects.toThrow('matching version');
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });
});
