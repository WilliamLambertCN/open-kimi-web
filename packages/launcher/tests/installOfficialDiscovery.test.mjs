import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalNpmCmd, canonicalNpmPs1, discoverOfficial, prepareOfficial } from '../../../scripts/install/official.mjs';
import { verifyOfficialShell } from '../../../scripts/install/officialShell.mjs';
import { canonicalNpmSh } from '../../../scripts/install/officialShims.mjs';

const roots = [];
async function fixture(platform = 'win32') {
  const home = await mkdtemp(join(tmpdir(), 'okw-discovery-'));
  roots.push(home);
  const tools = join(home, 'tools');
  await mkdir(tools);
  return { home, bin: join(home, 'bin'), prefixBin: join(home, 'npm'), platform, node: join(tools, 'node.exe'),
    env: { PATH: tools, HOME: home, USERPROFILE: home }, log: vi.fn(), downloadOfficial: vi.fn(),
    windowsPaths: vi.fn(async () => ({ system: '', user: '' })),
    run: vi.fn(async (_command, args) => args.includes('web') ? 'kimi web --host' : 'kimi, version 2.4.1') };
}
async function native(ctx, dir) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, ctx.platform === 'win32' ? 'kimi.exe' : 'kimi');
  await writeFile(file, ctx.platform === 'win32' ? 'MZ fixture' : Buffer.from('7f454c460000', 'hex'));
  await chmod(file, 0o755);
  return file;
}
async function npm(ctx, dir) {
  const root = join(dir, 'node_modules/@moonshot-ai/kimi-code');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.4.1',
    bin: { kimi: 'dist/main.mjs' } }));
  await writeFile(join(root, 'dist/main.mjs'), 'fixture entry');
  await writeFile(join(dir, 'kimi.cmd'), canonicalNpmCmd());
  await writeFile(join(dir, 'kimi.ps1'), canonicalNpmPs1());
  return join(dir, 'kimi.cmd');
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('bounded read-only official command discovery', () => {
  it.each(['default', 'custom', 'uv', 'xdg-bin', 'xdg-data', 'local', 'appdata', 'node'])
  ('discovers and reuses %s directory without downloading or writing official files', async (kind) => {
    const ctx = await fixture();
    const dirs = { default: join(ctx.home, '.kimi-code/bin'), custom: join(ctx.home, 'custom/bin'),
      uv: join(ctx.home, 'uv/bin'), 'xdg-bin': join(ctx.home, 'xdg-bin'), 'xdg-data': join(ctx.home, 'xdg/bin'),
      local: join(ctx.home, '.local/bin'), appdata: join(ctx.home, 'appdata/npm'), node: dirname(ctx.node) };
    Object.assign(ctx.env, { KIMI_INSTALL_DIR: join(ctx.home, 'custom'), UV_TOOL_BIN_DIR: dirs.uv,
      XDG_BIN_HOME: dirs['xdg-bin'], XDG_DATA_HOME: join(ctx.home, 'xdg/share'), APPDATA: join(ctx.home, 'appdata') });
    const file = await native(ctx, dirs[kind]);
    const before = await readFile(file);
    const found = await discoverOfficial(ctx);
    expect(found.path).toBe(file);
    await prepareOfficial(ctx, found, '/unused', {});
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(ctx.run).toHaveBeenCalledTimes(2);
    expect(await readFile(file)).toEqual(before);
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining('no official CLI download or upgrade'));
  });

  it('finds USERPROFILE default bin when HOME differs, reusing without official downloads', async () => {
    const ctx = await fixture();
    ctx.env.USERPROFILE = join(ctx.home, 'windows-profile');
    const file = await native(ctx, join(ctx.env.USERPROFILE, '.kimi-code/bin'));
    const before = await readFile(file);
    const found = await discoverOfficial(ctx);
    expect(found.path).toBe(file);
    await prepareOfficial(ctx, found, '/unused', {});
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
    expect(await readFile(file)).toEqual(before);
  });

  it('refuses different HOME and USERPROFILE installs without assigning either implicit precedence', async () => {
    const ctx = await fixture();
    ctx.env.USERPROFILE = join(ctx.home, 'windows-profile');
    await native(ctx, join(ctx.env.HOME, '.kimi-code/bin'));
    await native(ctx, join(ctx.env.USERPROFILE, '.kimi-code/bin'));
    await expect(discoverOfficial(ctx)).rejects.toThrow('multiple official Kimi');
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });

  it('collects expanded persistent Machine/User PATH only as unordered candidates without changing active PATH', async () => {
    const ctx = await fixture();
    ctx.env.FIXTURE_ROOT = ctx.home;
    const file = await native(ctx, join(ctx.home, 'persisted'));
    ctx.windowsPaths.mockResolvedValue({ system: '%FIXTURE_ROOT%/absent', user: '%FIXTURE_ROOT%/persisted' });
    const before = { ...ctx.env };
    expect((await discoverOfficial(ctx)).path).toBe(file);
    expect(ctx.env).toEqual(before);
    expect(ctx.windowsPaths).toHaveBeenCalledOnce();
    expect(ctx.run.mock.calls.every(([, , settings]) => settings.env.PATH.endsWith(before.PATH))).toBe(true);
  });

  it('preserves active PATH precedence over persisted and known installations without inspecting them', async () => {
    const ctx = await fixture();
    const file = await native(ctx, ctx.env.PATH);
    await native(ctx, join(ctx.home, '.kimi-code/bin'));
    ctx.windowsPaths.mockRejectedValue(new Error('persistent paths should not be read'));
    expect((await discoverOfficial(ctx)).path).toBe(file);
    expect(ctx.windowsPaths).not.toHaveBeenCalled();
  });

  it('refuses unordered different targets and accepts realpath aliases to the same target', async () => {
    const ctx = await fixture();
    const first = join(ctx.home, '.kimi-code/bin');
    const second = join(ctx.home, '.local/bin');
    const file = await native(ctx, first);
    await mkdir(dirname(second), { recursive: true });
    await symlink(first, second, 'junction');
    expect((await discoverOfficial(ctx)).path).toBe(file);
    const extra = join(ctx.home, 'extra');
    ctx.env.UV_TOOL_BIN_DIR = extra;
    await native(ctx, extra);
    ctx.run.mockClear();
    await expect(discoverOfficial(ctx)).rejects.toThrow('multiple official Kimi');
    expect(ctx.run).not.toHaveBeenCalled();
    ctx.env.OPEN_KIMI_REAL_KIMI = file;
    expect((await discoverOfficial(ctx)).path).toBe(file);
  });

});

describe('official discovery fail-closed target boundaries', () => {
  it('checks every known-directory target and rejects native/npm ambiguity instead of choosing a version', async () => {
    const ctx = await fixture();
    const dir = join(ctx.home, '.kimi-code/bin');
    const cmd = await npm(ctx, dir);
    await writeFile(join(dir, 'kimi'), canonicalNpmSh());
    expect((await discoverOfficial(ctx)).path).toBe(cmd);
    await native(ctx, dir);
    ctx.run.mockClear();
    await expect(discoverOfficial(ctx)).rejects.toThrow('multiple official Kimi');
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('preserves PATHEXT order and refuses an unsupported first command extension', async () => {
    const ctx = await fixture();
    const cmd = await npm(ctx, ctx.env.PATH);
    await native(ctx, ctx.env.PATH);
    ctx.env.PATHEXT = '.CMD;.EXE';
    expect((await discoverOfficial(ctx)).path).toBe(cmd);
    ctx.env.PATHEXT = '.VBS;.CMD;.EXE';
    await writeFile(join(ctx.env.PATH, 'kimi.vbs'), 'unknown script');
    ctx.run.mockClear();
    await expect(discoverOfficial(ctx)).rejects.toThrow('standard kimi npm target');
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it.each(['wrapper', 'broken-link', 'function', 'too-many'])
  ('rejects %s instead of classifying as missing or trying a later installation', async (kind) => {
    const ctx = await fixture('linux');
    const file = join(ctx.env.PATH, 'kimi');
    if (kind === 'function') ctx.env['BASH_FUNC_kimi%%'] = '() { echo unknown; }';
    else if (kind === 'too-many') ctx.env.PATH = Array(258).fill(ctx.env.PATH).join(':');
    else if (kind === 'broken-link') await symlink(join(ctx.home, 'absent'), file);
    else { await writeFile(file, '#!/bin/sh\nexec unknown --extra "$@"\n'); await chmod(file, 0o755); }
    await native(ctx, join(ctx.home, '.local/bin'));
    await expect(discoverOfficial(ctx)).rejects.toThrow();
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });
});

describe('PowerShell standard npm shims are parsed, never executed', () => {
  it('resolves a standard ps1 hint to its verified cmd runtime without executing PowerShell', async () => {
    const ctx = await fixture();
    const cmd = await npm(ctx, ctx.env.PATH);
    ctx.env.OPEN_KIMI_INSTALL_COMMAND = join(ctx.env.PATH, 'kimi.ps1');
    expect((await discoverOfficial(ctx)).path).toBe(cmd);
    expect(ctx.run.mock.calls.every(([command]) => command === ctx.node)).toBe(true);
  });

  it.each(['unknown', 'missing-cmd'])('refuses %s ps1 without executing it or downloading a replacement', async (kind) => {
    const ctx = await fixture();
    if (kind === 'missing-cmd') {
      const other = join(ctx.home, 'other');
      await npm(ctx, other);
      await writeFile(join(ctx.env.PATH, 'kimi.ps1'), canonicalNpmPs1());
    } else await writeFile(join(ctx.env.PATH, 'kimi.ps1'), 'throw "never execute me"');
    await expect(discoverOfficial(ctx)).rejects.toThrow(/standard|runtime/);
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.downloadOfficial).not.toHaveBeenCalled();
  });

  it('accepts matching cmd/ps1 explicit-registration identity but refuses a different target', async () => {
    const ctx = await fixture();
    ctx.kimi = await npm(ctx, ctx.env.PATH);
    ctx.env.OPEN_KIMI_REAL_KIMI = join(ctx.env.PATH, 'kimi.ps1');
    expect((await discoverOfficial(ctx)).path).toBe(ctx.kimi);
    ctx.env.OPEN_KIMI_REAL_KIMI = await native(ctx, join(ctx.home, 'other'));
    await expect(discoverOfficial(ctx)).rejects.toThrow('conflicts with integration');
  });
});

describe('child_process shell verification', () => {
  it('uses prepared profile-free Git Bash and a filtered environment with bounded tree-aware runner timeout', async () => {
    const ctx = await fixture();
    ctx.env = { ...ctx.env, KIMI_SHELL_PATH: join(ctx.home, 'bash.exe'), BASH_ENV: 'injected', ENV: 'injected',
      NODE_OPTIONS: '--require injected', NODE_PATH: '/injected', LD_PRELOAD: '/injected' };
    ctx.run.mockResolvedValue('open-kimi-shell-ok');
    await verifyOfficialShell(ctx, ctx.home);
    const [command, args, settings] = ctx.run.mock.calls[0];
    expect(command).toBe(ctx.node);
    expect(args).toEqual(['-e', expect.stringContaining("['--noprofile', '--norc', '-c']"), ctx.env.KIMI_SHELL_PATH, 'win32']);
    expect(settings).toMatchObject({ cwd: ctx.home, timeoutMs: 20000 });
    for (const key of ['BASH_ENV', 'ENV', 'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD']) expect(settings.env[key]).toBeUndefined();
    ctx.run.mockResolvedValue('wrong marker');
    await expect(verifyOfficialShell(ctx, ctx.home)).rejects.toThrow('repair manually');
    delete ctx.env.KIMI_SHELL_PATH;
    await expect(verifyOfficialShell(ctx, ctx.home)).rejects.toThrow('requires prepared Git Bash');
  });
});
