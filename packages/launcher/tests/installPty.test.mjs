import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePty, verifyOwnedPty, verifyPty } from '../../../scripts/install/pty.mjs';
import { auditPtyBuild } from '../../../scripts/install/ptyAudit.mjs';

vi.mock('../../../scripts/install/ptyAudit.mjs', () => ({ auditPtyBuild: vi.fn() }));
const roots = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'okw-pty-unit-'));
  roots.push(home);
  const root = join(home, 'official/lib/node_modules/@moonshot-ai/kimi-code');
  const tools = join(home, 'tools');
  await mkdir(root, { recursive: true });
  await mkdir(tools);
  for (const name of ['python3', 'make', 'cc', 'c++']) {
    await writeFile(join(tools, name), 'fixture tool');
    await chmod(join(tools, name), 0o755);
  }
  const paths = { prefix: join(home, 'official'), root };
  const ctx = { platform: 'linux', node: process.execPath, npm: join(home, 'npm-cli.js'), env: { PATH: tools },
    run: vi.fn(async (_command, args) => args.includes('-c') ? '3.10.12' : '{"status":"ok"}') };
  auditPtyBuild.mockResolvedValue(join(root, 'node_modules/node-pty'));
  return { ctx, paths, home, tools };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('restricted official PTY dependency preparation', () => {
  it('probes an existing binary without running lifecycle or build', async () => {
    const { ctx, paths, home } = await fixture();
    await preparePty(ctx, paths, home, {});
    expect(ctx.run).toHaveBeenCalledOnce();
    expect(auditPtyBuild).not.toHaveBeenCalled();
  });

  it('rebuilds only the exact audited local node-pty with isolated build configuration', async () => {
    const { ctx, paths, home, tools } = await fixture();
    ctx.env = { ...ctx.env, npm_config_global: 'true', npm_config_script_shell: 'evil', npm_config_python: 'evil',
      NODE_OPTIONS: '--require evil', PYTHONPATH: 'evil', CC: 'evil', GYP_DEFINES: 'evil', BASH_ENV: 'evil',
      CPATH: 'evil', CPLUS_INCLUDE_PATH: 'evil', LIBRARY_PATH: 'evil', COMPILER_PATH: 'evil', MAKEFILES: '/evil/injected.mk',
      MAKEFLAGS: '--eval=evil', GNUMAKEFLAGS: '--eval=evil', MFLAGS: '-e', MAKEOVERRIDES: 'evil', MAKELEVEL: '99',
      MAKE_RESTARTS: '99', MAKE_TERMOUT: '/evil', MAKE_TERMERR: '/evil' };
    ctx.run.mockResolvedValueOnce('{"status":"missing"}');
    await preparePty(ctx, paths, home, {});
    const [, args, settings] = ctx.run.mock.calls.find(([, args]) => args.includes('rebuild'));
    expect(args).toContain(join(paths.root, 'node_modules/node-pty'));
    expect(args).toContain('--prefix');
    expect(args).toContain(paths.root);
    for (const flag of ['--global=false', '--ignore-scripts=false', '--rebuild-bundle=false', '--bin-links=false']) {
      expect(args).toContain(flag);
    }
    expect(settings.cwd).toBe(paths.root);
    expect(settings.timeoutMs).toBe(300000);
    expect(settings.env.npm_config_python).toBe(join(tools, 'python3'));
    expect(settings.env.npm_config_script_shell).toBe('/bin/sh');
    expect(settings.env.npm_config_disturl).toBe('https://nodejs.org/download/release');
    for (const key of ['NODE_OPTIONS', 'PYTHONPATH', 'GYP_DEFINES', 'BASH_ENV', 'npm_config_global',
      'CPATH', 'CPLUS_INCLUDE_PATH', 'LIBRARY_PATH', 'COMPILER_PATH', 'MAKEFILES', 'MAKEFLAGS', 'GNUMAKEFLAGS', 'MFLAGS',
      'MAKEOVERRIDES', 'MAKELEVEL', 'MAKE_RESTARTS', 'MAKE_TERMOUT', 'MAKE_TERMERR']) {
      expect(settings.env[key]).toBeUndefined();
    }
    expect(ctx.run.mock.calls.at(-1)[1][0]).toContain('ptyProbe.mjs');
  });

  it('fails missing tools clearly without npm rebuild, sudo or downloads', async () => {
    const { ctx, paths, home } = await fixture();
    ctx.env.PATH = '';
    ctx.run.mockResolvedValueOnce('{"status":"missing"}');
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('standard Python, C/C++ compiler and make');
    expect(ctx.run).toHaveBeenCalledOnce();
  });

  it('refuses modified build sources before running tools or npm', async () => {
    const { ctx, paths, home } = await fixture();
    ctx.run.mockResolvedValueOnce('{"status":"missing"}');
    auditPtyBuild.mockRejectedValueOnce(new Error('audited PTY build file changed'));
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('audited PTY');
    expect(ctx.run).toHaveBeenCalledOnce();
  });

});

describe('official PTY failure boundaries', () => {
  it('rejects Python 2 before npm rebuild', async () => {
    const { ctx, paths, home } = await fixture();
    ctx.run.mockResolvedValueOnce('{"status":"missing"}').mockResolvedValueOnce('2.7.18');
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('requires Python 3');
    expect(ctx.run).toHaveBeenCalledTimes(2);
  });

  it('requires a successful real probe after rebuild', async () => {
    const { ctx, paths, home } = await fixture();
    ctx.run.mockResolvedValueOnce('{"status":"missing"}').mockResolvedValueOnce('3.10.12')
      .mockResolvedValueOnce('rebuilt').mockResolvedValueOnce('{"status":"failed"}');
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('verification failed after audited rebuild');
    expect(ctx.run).toHaveBeenCalledTimes(4);
  });

  it('retains the installer lock when child cleanup is unconfirmed', async () => {
    const { ctx, paths } = await fixture();
    ctx.run.mockResolvedValue('{"status":"unconfirmed"}');
    await expect(verifyPty(ctx, paths.root)).rejects.toMatchObject({ keepLock: true });
  });

  it('requires prepared Git Bash on Windows before spawning any child', async () => {
    const { ctx, paths } = await fixture();
    ctx.platform = 'win32';
    await expect(verifyPty(ctx, paths.root)).rejects.toThrow('requires prepared Git Bash');
    expect(ctx.run).not.toHaveBeenCalled();
  });

  it('does not rebuild arbitrary spawn failures or an unsupported platform', async () => {
    const { ctx, paths, home } = await fixture();
    ctx.run.mockResolvedValue('{"status":"failed"}');
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('no unapproved');
    ctx.platform = 'darwin';
    ctx.run.mockResolvedValue('{"status":"missing"}');
    await expect(preparePty(ctx, paths, home, {})).rejects.toThrow('no unapproved');
    expect(auditPtyBuild).not.toHaveBeenCalled();
  });

  it('requires repair manually for broken owned installation and rejects invalid probes', async () => {
    const { ctx, paths } = await fixture();
    ctx.run.mockResolvedValue('{"status":"missing"}');
    await expect(verifyOwnedPty(ctx, paths)).rejects.toThrow('repair manually');
    expect(auditPtyBuild).not.toHaveBeenCalled();
    ctx.run.mockResolvedValue('invalid');
    await expect(verifyPty(ctx, paths.root)).rejects.toThrow('invalid result');
  });
});
