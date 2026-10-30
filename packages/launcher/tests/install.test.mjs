import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMain, installRelease, isolatedNpmEnv, makeInstallContext, parseInstallArgs,
  assertDownloadUrl, validateInstallRelease, runInstallProcess } from '../../../scripts/install.mjs';
import { writeWrappers } from '../src/integration/wrapperGen.mjs';

const roots = [];
const bytes = Buffer.from('verified fixture archive');
const digest = createHash('sha256').update(bytes).digest('hex');
const repository = 'https://github.com/WilliamLambertCN/open-kimi-web';
const options = { integrate: false, switchInstallation: false };

export function metadata(version = '2.1.1-r9') {
  const name = `open-kimi-web-${version}.tgz`;
  return { draft: false, prerelease: false, tag_name: `v${version}`, html_url: `${repository}/releases/tag/v${version}`,
    assets: [{ name, state: 'uploaded', digest: `sha256:${digest}`,
      browser_download_url: `${repository}/releases/download/v${version}/${name}` }] };
}

async function put(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'okw installer fixture-'));
  roots.push(home);
  const tools = join(home, 'tools');
  for (const name of ['kimi', 'curl', 'tar']) await put(join(tools, `${name}.exe`), 'MZ fixture executable');
  const run = vi.fn(async (command, args) => {
    if (args.includes('install')) return '';
    if (command.endsWith('kimi.exe')) return args.includes('web') ? 'kimi web --host --port' : 'kimi, version 2.1.1';
    if (command.endsWith('curl.exe')) return 'curl 8.0.0';
    if (command.endsWith('tar.exe')) return 'bsdtar 3.0.0';
    return '11.0.0';
  });
  return { env: { OPEN_KIMI_WEB_HOME: home, PATH: tools }, platform: 'win32', run,
    adjacentNpm: vi.fn(async () => join(tools, 'npm-cli.js')), windowsPaths: vi.fn(async () => ({ user: '', system: '' })),
    releaseMetadata: vi.fn(async () => metadata()), download: vi.fn(async () => bytes),
    verifyInstalled: vi.fn(async () => undefined), integrateInstalled: vi.fn(async () => undefined),
    acquireUpdateLock: vi.fn(async () => async () => undefined), ensureGitBash: vi.fn(async () => undefined),
    log: vi.fn(), error: vi.fn() };
}

async function installed(f, version = '2.1.1-r9') {
  const ctx = makeInstallContext(f);
  await put(join(ctx.root, 'package.json'), {
    name: 'open-kimi-web', version, bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' },
  });
  await put(ctx.entry, 'fixture entry');
  await put(ctx.recordFile, { schema: 1, version, prefix: ctx.prefix, entry: ctx.entry });
  return ctx;
}

async function integration(f, target) {
  const ctx = makeInstallContext(f);
  await put(target, 'fixture entry');
  const state = { schema: 1, node: ctx.node, realKimi: join(ctx.env.PATH, 'kimi.exe'), wrapperDir: ctx.bin,
    wrapperFiles: ['kimi.cmd', 'open-kimi-web.cmd'] };
  await writeWrappers(ctx.bin, ctx.platform, { node: ctx.node, entry: target, realKimi: state.realKimi });
  await put(join(ctx.home, 'integration.json'), state);
}

afterEach(async () => {
  for (const home of roots.splice(0)) await rm(home, { recursive: true, force: true });
});

describe('installer CLI and release boundaries', () => {
  it('parses only supported explicit flags and reports help without touching state', async () => {
    expect(parseInstallArgs(['--version', 'v2.1.1-r9', '--switch-installation', '--no-integrate']))
      .toEqual({ version: '2.1.1-r9', integrate: false, switchInstallation: true });
    const f = await fixture();
    expect(await installMain(['--help'], f)).toBe(0);
    expect(f.releaseMetadata).not.toHaveBeenCalled();
    for (const args of [['--version'], ['--version', 'latest'], ['--url', 'https://example.invalid'],
      ['--skip-digest'], ['--help', '--no-integrate'], ['--no-integrate', '--no-integrate']]) {
      expect(await installMain(args, f)).toBe(2);
    }
  });

  it('requires exact release repository, formal version, unique name/url and digest', () => {
    expect(validateInstallRelease(metadata()).version).toBe('2.1.1-r9');
    for (const patch of [{ draft: true }, { prerelease: true }, { html_url: 'https://example.invalid' },
      { tag_name: 'v2.1.1-beta' }, { assets: [] }, { assets: [metadata().assets[0], metadata().assets[0]] },
      { assets: [{ ...metadata().assets[0], digest: null }] },
      { assets: [{ ...metadata().assets[0], browser_download_url: 'https://example.invalid/x.tgz' }] }]) {
      expect(() => validateInstallRelease({ ...metadata(), ...patch })).toThrow();
    }
    expect(() => validateInstallRelease(metadata(), '2.1.1-r8')).toThrow('match');
  });

  it('refuses unsafe redirect destinations', () => {
    expect(assertDownloadUrl(metadata().assets[0].browser_download_url).hostname).toBe('github.com');
    expect(assertDownloadUrl('https://release-assets.githubusercontent.com/x?signature=fixture').protocol).toBe('https:');
    for (const url of ['http://github.com/x', 'https://example.invalid/x', 'https://user:password@github.com/x',
      'https://github.com:443/x', 'https://github.com/other/releases/download/x', 'https://127.0.0.1/x']) {
      expect(() => assertDownloadUrl(url)).toThrow();
    }
  });

  it('isolates dangerous npm config while retaining supported TLS networking', () => {
    const env = isolatedNpmEnv({ npm_config_ignore_scripts: 'false', npm_config_prefix: '/other', NODE_OPTIONS: '--require bad',
      NODE_TLS_REJECT_UNAUTHORIZED: '0', npm_config_registry: 'https://registry.npmjs.org',
      HTTPS_PROXY: 'http://proxy.invalid', npm_config_https_proxy: 'http://proxy.invalid', PATH: '/tools' }, '/stage', '/node');
    expect(env.npm_config_ignore_scripts).toBeUndefined();
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(env.npm_config_strict_ssl).toBe('true');
    expect(env.npm_config_https_proxy).toBe('http://proxy.invalid');
    expect(env.npm_config_cache).toContain('stage');
    expect(() => isolatedNpmEnv({ npm_config_registry: 'http://registry.invalid' }, '/stage', '/node')).toThrow('HTTPS');
  });
});

describe('full coordinator orchestration', () => {
  it('installs a verified archive via selected node/npm and reports package-only accurately', async () => {
    const f = await fixture();
    const result = await installRelease(options, f);
    expect(result.integrated).toBe(false);
    const call = f.run.mock.calls.find(([, args]) => args.includes('install'));
    expect(call[0]).toBe(process.execPath);
    expect(call[1]).toContain('--ignore-scripts');
    expect(call[1]).toContain('--global');
    expect(call[1]).toContain(result.prefix);
    expect(call[2].env.npm_config_strict_ssl).toBe('true');
    expect(f.verifyInstalled).toHaveBeenCalledOnce();
    expect(f.integrateInstalled).not.toHaveBeenCalled();
    const lines = f.log.mock.calls.flat().join('\n');
    expect(lines).toContain('NOT installed or changed');
    expect(lines).toContain('OKW release: downloading');
    expect(lines).toContain('Official Kimi: reusing');
    expect(lines).toContain('no official CLI download or upgrade');
    expect(f.download).toHaveBeenCalledOnce();
    const home = f.env.OPEN_KIMI_WEB_HOME;
    expect(await readdir(home)).toEqual(['bootstrap-install.json', 'npm', 'tools']);
    expect(JSON.parse(await readFile(join(home, 'bootstrap-install.json'), 'utf8')).version).toBe('2.1.1-r9');
  });

  it('supports same-prefix reinstall without downgrading self-updated installations', async () => {
    const f = await fixture();
    await installed(f);
    await expect(installRelease(options, f)).resolves.toMatchObject({ version: '2.1.1-r9' });
    await installed(f, '2.1.1-r10');
    f.run.mockClear();
    await expect(installRelease(options, f)).rejects.toThrow('downgrade');
    expect(f.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
  });

  it('refuses unknown dedicated prefixes and corrupt records even with switch opt-in', async () => {
    const f = await fixture();
    await put(join(f.env.OPEN_KIMI_WEB_HOME, 'npm', 'sentinel'), 'keep');
    await expect(installRelease({ ...options, switchInstallation: true }, f)).rejects.toThrow('unknown or partial');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
    expect(await readFile(join(f.env.OPEN_KIMI_WEB_HOME, 'npm', 'sentinel'), 'utf8')).toBe('keep');
  });

  it('refuses linked npm prefixes before touching unknown target directories', async () => {
    const f = await fixture();
    const unknown = join(f.env.OPEN_KIMI_WEB_HOME, 'unknown');
    await mkdir(unknown);
    await symlink(unknown, join(f.env.OPEN_KIMI_WEB_HOME, 'npm'), 'junction');
    await expect(installRelease(options, f)).rejects.toThrow('linked');
    expect(await readdir(unknown)).toEqual([]);
  });

  it('checks foreign integration before downloads and only switches on explicit opt-in', async () => {
    const f = await fixture();
    await integration(f, join(f.env.OPEN_KIMI_WEB_HOME, 'source', 'bin/open-kimi-web.mjs'));
    await expect(installRelease(options, f)).rejects.toThrow('--switch-installation');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
    await installRelease({ integrate: true, switchInstallation: true }, f);
    expect(f.integrateInstalled.mock.calls[0][1].kind).toBe('foreign');
  });

  it('uses repair seam only for a fully confirmed same target', async () => {
    const f = await fixture();
    const ctx = await installed(f);
    await integration(f, ctx.entry);
    await installRelease({ ...options, integrate: true }, f);
    expect(f.integrateInstalled.mock.calls[0][1].kind).toBe('same');
  });

});

describe('coordinator persistent-state boundaries', () => {
  it('refuses persistent Windows PATH traces without wrappers/state before downloading', async () => {
    const f = await fixture();
    f.windowsPaths.mockResolvedValue({ user: join(f.env.OPEN_KIMI_WEB_HOME, 'bin'), system: '' });
    await expect(installRelease(options, f)).rejects.toThrow('persistent integration PATH trace');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
  });

  it('refuses linked package entry directories even with a valid ownership record', async () => {
    const f = await fixture();
    const ctx = await installed(f);
    await rm(dirname(ctx.entry), { recursive: true });
    const target = join(ctx.home, 'unknown-entry');
    await mkdir(target);
    await symlink(target, dirname(ctx.entry), 'junction');
    await expect(installRelease(options, f)).rejects.toThrow('linked');
    expect(await readdir(target)).toEqual([]);
  });

  it('keeps the lock/stage if child termination cannot be confirmed', async () => {
    const f = await fixture();
    const run = f.run.getMockImplementation();
    f.run.mockImplementation(async (command, args, settings) => {
      if (args.includes('install')) throw Object.assign(new Error('termination unconfirmed'), { keepLock: true });
      return run(command, args, settings);
    });
    await expect(installRelease(options, f)).rejects.toThrow('termination unconfirmed');
    expect((await readdir(f.env.OPEN_KIMI_WEB_HOME)).some((name) => name === '.bootstrap-install.lock')).toBe(true);
    await expect(installRelease(options, f)).rejects.toThrow('lock');
  });
});

describe('coordinator failure and concurrency boundaries', () => {
  it('refuses partial integration even with explicit switch', async () => {
    const f = await fixture();
    await put(join(f.env.OPEN_KIMI_WEB_HOME, 'bin/kimi.cmd'), 'unknown wrapper');
    await expect(installRelease({ ...options, switchInstallation: true }, f)).rejects.toThrow('partial');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
  });

  it('refuses other commands and validates prerequisites before npm/PATH changes', async () => {
    const f = await fixture();
    await put(join(f.env.PATH, 'open-kimi-web.cmd'), 'other command');
    await expect(installRelease(options, f)).rejects.toThrow('another open-kimi-web');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
    f.run.mockImplementation(async () => 'unrecognized');
    await expect(installRelease({ ...options, switchInstallation: true }, f)).rejects.toThrow('npm did not report');
  });

  it('cleans own stages/lock on checksum/network/install failures and reports bounded stage', async () => {
    const f = await fixture();
    f.download.mockResolvedValue(Buffer.from('corrupt'));
    await expect(installRelease(options, f)).rejects.toThrow('SHA256');
    expect(await readdir(f.env.OPEN_KIMI_WEB_HOME)).toEqual(['tools']);
    f.download.mockRejectedValue(new Error('network failed'));
    await expect(installRelease(options, f)).rejects.toThrow('verified release download');
    f.download.mockResolvedValue(bytes);
    f.run.mockImplementation(async (command, args) => {
      if (args.includes('install')) throw new Error('npm unavailable');
      if (command.endsWith('kimi.exe')) return args.includes('web') ? 'kimi web --port' : '2.1.1';
      if (command.endsWith('curl.exe')) return 'curl 8';
      if (command.endsWith('tar.exe')) return 'tar 3';
      return '11.0.0';
    });
    expect(await installMain(['--no-integrate'], f)).toBe(1);
    expect(f.error.mock.calls.flat().join('\n')).toContain('npm replacement (may be partial)');
    expect((await readdir(f.env.OPEN_KIMI_WEB_HOME)).some((name) => name.includes('stage') || name.includes('lock'))).toBe(false);
  });

  it('locks concurrent installs and leaves the first operation intact', async () => {
    const f = await fixture();
    let resume;
    let reached;
    const pending = new Promise((resolve) => { reached = resolve; });
    f.download.mockImplementation(() => { reached(); return new Promise((resolve) => { resume = resolve; }); });
    const first = installRelease(options, f);
    await pending;
    await expect(installRelease(options, f)).rejects.toThrow('lock');
    resume(bytes);
    await first;
    expect(f.verifyInstalled).toHaveBeenCalledOnce();
  });

  it('reports post-install verification and integration failures without deleting the installed package', async () => {
    const f = await fixture();
    f.verifyInstalled.mockRejectedValue(new Error('identity mismatch'));
    await expect(installRelease(options, f)).rejects.toThrow('installed package verification');
    f.verifyInstalled.mockResolvedValue(undefined);
    f.integrateInstalled.mockRejectedValue(new Error('PATH shadowed'));
    await expect(installRelease({ ...options, integrate: true }, f)).rejects.toThrow('integration (package installed)');
    expect(JSON.parse(await readFile(join(f.env.OPEN_KIMI_WEB_HOME, 'bootstrap-install.json'), 'utf8')).schema).toBe(1);
  });

});

describe('official preparation orchestration', () => {
  it('keeps repeated preflight side-effect free and prepares a missing official once after archive verification', async () => {
    const f = await fixture();
    f.discoverOfficial = vi.fn(async () => ({ kind: 'missing' }));
    f.prepareOfficial = vi.fn(async (ctx, found, stage, progress) => {
      expect(found.kind).toBe('missing');
      expect(await readFile(join(stage, 'release.tgz'))).toEqual(bytes);
      expect(progress.label).toBe('Git Bash preparation');
      ctx.kimi = join(ctx.home, 'official/kimi.cmd');
    });
    await installRelease(options, f);
    expect(f.discoverOfficial).toHaveBeenCalledTimes(3);
    expect(f.prepareOfficial).toHaveBeenCalledOnce();
    expect(f.ensureGitBash).toHaveBeenCalledOnce();
    expect(f.prepareOfficial.mock.invocationCallOrder[0]).toBeGreaterThan(f.download.mock.invocationCallOrder[0]);
  });

  it('uses the prepared Git Bash PATH and selected Node in launcher npm environment', async () => {
    const f = await fixture();
    const gitCmd = join(f.env.OPEN_KIMI_WEB_HOME, 'git/cmd');
    await mkdir(gitCmd, { recursive: true });
    f.env.Path = 'stale mixed PATH';
    f.env.path = 'stale lower PATH';
    f.ensureGitBash.mockImplementation(async (ctx) => { ctx.env.PATH = `${gitCmd};${ctx.env.PATH}`; });
    await installRelease(options, f);
    const env = f.run.mock.calls.find(([, args]) => args.includes('install'))[2].env;
    expect(env.PATH).toBe(`${dirname(process.execPath)};${gitCmd};${f.env.PATH}`);
    expect(Object.keys(env).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
  });

  it('refuses a new PATH official after Git Bash preparation instead of silently installing another', async () => {
    const f = await fixture();
    const gitCmd = join(f.env.OPEN_KIMI_WEB_HOME, 'git/cmd');
    await put(join(gitCmd, 'kimi.exe'), 'MZ unexpected official');
    f.ensureGitBash.mockImplementation(async (ctx) => { ctx.env.PATH = `${gitCmd};${ctx.env.PATH}`; });
    await expect(installRelease(options, f)).rejects.toThrow('changed during Git Bash preparation');
    expect(f.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
    expect(f.verifyInstalled).not.toHaveBeenCalled();
    expect(await readFile(join(gitCmd, 'kimi.exe'), 'utf8')).toBe('MZ unexpected official');
  });

  it('refuses changed official versions during Git Bash preparation before npm replacement', async () => {
    const f = await fixture();
    const official = { kind: 'native', path: join(f.env.PATH, 'kimi.exe'), version: '2.1.1' };
    f.discoverOfficial = vi.fn().mockResolvedValueOnce(official).mockResolvedValueOnce(official)
      .mockResolvedValueOnce({ ...official, version: '2.1.2' });
    await expect(installRelease(options, f)).rejects.toThrow('changed during Git Bash preparation');
    expect(f.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
  });
});

describe('bash login preflight and real subprocess boundaries', () => {
  it('fails unsafe bash login profiles before downloads or npm replacement without claiming success', async () => {
    const f = await fixture();
    f.platform = 'linux';
    f.env.HOME = f.env.OPEN_KIMI_WEB_HOME;
    f.env.SHELL = '/bin/bash';
    f.env.OPEN_KIMI_REAL_KIMI = join(f.env.PATH, 'kimi.exe');
    await put(join(f.env.HOME, '.bash_profile'), '');
    expect(await installMain([], f)).toBe(1);
    expect(f.error.mock.calls.flat().join('\n')).toContain('use --no-integrate');
    expect(f.releaseMetadata).not.toHaveBeenCalled();
    expect(f.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
    expect(f.log).not.toHaveBeenCalled();
    expect(await readFile(join(f.env.HOME, '.bash_profile'), 'utf8')).toBe('');
  });

  it('runs real subprocesses without leaking stderr and times out a fixture process', async () => {
    expect(await runInstallProcess(process.execPath, ['-e', 'console.log("fixture")'])).toBe('fixture');
    await expect(runInstallProcess(process.execPath, ['-e', 'console.error("private fixture");process.exit(1)']))
      .rejects.toThrow('no command output logged');
    await expect(runInstallProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], { timeoutMs: 100 }))
      .rejects.toThrow('timed out');
  });
});
