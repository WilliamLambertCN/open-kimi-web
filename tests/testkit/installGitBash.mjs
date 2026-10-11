import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let assertGitDownloadUrl;
let downloadGitAsset;
let ensureGitBash;

const hashing = vi.hoisted(() => ({ fixture: false }));
vi.mock('node:crypto', async (original) => {
  const module = await original();
  return { ...module, createHash: (...args) => {
    const hash = module.createHash(...args);
    if (hashing.fixture) hash.digest = () => '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b';
    return hash;
  } };
});

const x64 = { name: 'PortableGit-2.56.0.2-64-bit.7z.exe', size: 60027568,
  digest: '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b' };
const release = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/';
let root;
let ctx;

async function pair(directory, shell = 'bin/bash.exe') {
  for (const relative of ['cmd/git.exe', shell]) {
    const path = join(directory, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'fixture');
  }
  return join(directory, shell);
}

function requests(responses) {
  return vi.fn((_url, _options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = vi.fn();
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      const source = responses.shift();
      Object.assign(response, { statusCode: 200, headers: {}, complete: true, ...source });
      response.resume = vi.fn();
      callback(response);
      if (source.error) response.emit('error', new Error('fixture'));
      else {
        response.emit('data', Buffer.from(source.body ?? 'fixture'));
        response.emit('end');
      }
    });
    return request;
  });
}

function network(response, options = {}) {
  const agent = { destroy: vi.fn() };
  const request = requests(response);
  return { request, agent, dependencies: { request, agentFactory: () => agent, ...options } };
}

export function installGitBashScenarios() {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'okw-git-'));
    hashing.fixture = false;
    vi.resetModules();
    ({ assertGitDownloadUrl, downloadGitAsset, ensureGitBash } = await import('../../scripts/install/gitBash.mjs'));
    ctx = { platform: 'win32', home: join(root, 'home'), env: {
      PATH: '', ProgramFiles: join(root, 'program'), 'ProgramFiles(x86)': join(root, 'program86'),
      LOCALAPPDATA: join(root, 'local'), PROCESSOR_ARCHITECTURE: 'AMD64',
    }, run: vi.fn(async (_command, args) => args[0] === '--version' ? 'git version 2.56.0.windows.2' : 'okw-git-bash'),
    gitBashDownload: vi.fn(async () => Buffer.from('corrupt fixture')) };
  });
  afterEach(async () => { hashing.fixture = false; await rm(root, { recursive: true, force: true }); });
  discoveryScenarios();
  portableScenarios();
  extractionConfigurationScenarios();
  networkScenarios();
}

function discoveryScenarios() {
  describe('Git Bash discovery and strict override', () => {
    it('does nothing on POSIX without reading or changing dependencies', async () => {
      ctx.platform = 'linux';
      ctx.env.KIMI_SHELL_PATH = 'invalid';
      const before = { ...ctx.env };
      expect(await ensureGitBash(ctx)).toBeUndefined();
      expect(ctx.env).toEqual(before);
      expect(ctx.run).not.toHaveBeenCalled();
    });

    it.each(['missing.exe', ' ', 'relative/bin/bash.exe'])('rejects bad explicit shell %s without download', async (value) => {
      ctx.env.KIMI_SHELL_PATH = value;
      await expect(ensureGitBash(ctx)).rejects.toThrow(/KIMI_SHELL_PATH/);
      expect(ctx.env.KIMI_SHELL_PATH).toBe(value);
      expect(ctx.gitBashDownload).not.toHaveBeenCalled();
    });

    it.each(['bin/bash.exe', 'usr/bin/bash.exe'])
    ('reuses validated explicit %s and exposes discoverable cmd PATH', async (name) => {
      const git = join(root, 'Git with spaces');
      ctx.env.KIMI_SHELL_PATH = await pair(git, name);
      ctx.env.PATH = join(git, 'cmd');
      ctx.env.BASH_ENV = join(root, 'must-not-load');
      const found = await ensureGitBash(ctx);
      expect(found.kind).toBe('existing');
      expect(found.pathDirectory).toBe(join(git, 'cmd'));
      expect(ctx.gitBashPathDirectories).toEqual([found.pathDirectory]);
      expect(ctx.env.PATH).toBe(found.pathDirectory);
      expect(ctx.run.mock.calls[1][1]).toEqual(['--noprofile', '--norc', '-c', expect.any(String)]);
      expect(ctx.run.mock.calls[1][2].env.BASH_ENV).toBe('');
      expect(ctx.env.BASH_ENV).toContain('must-not-load');
      expect(ctx.gitBashDownload).not.toHaveBeenCalled();
    });

    it('rejects a present but incapable explicit shell', async () => {
      ctx.env.KIMI_SHELL_PATH = await pair(join(root, 'Git'));
      ctx.run.mockResolvedValue('wrong executable');
      await expect(ensureGitBash(ctx)).rejects.toThrow(/KIMI_SHELL_PATH/);
    });

    it('tries all PATH candidates and preserves Windows env key casing', async () => {
      const git = join(root, 'Git');
      await pair(git);
      delete ctx.env.PATH;
      ctx.env.Path = `${join(root, 'missing')};"${join(git, 'cmd')}"`;
      const found = await ensureGitBash(ctx);
      expect(found.root).toBe(git);
      expect(ctx.env.Path).toMatch(/^.*Git[\\/]cmd;/);
      expect(ctx.env.PATH).toBeUndefined();
    });

    it.each(['ucrt64', 'clangarm64', 'other'])('resolves a Git shim through %s exec-path', async (prefix) => {
      const git = join(root, 'Git');
      await pair(git);
      const shim = join(root, 'shim');
      await mkdir(shim);
      await writeFile(join(shim, 'git.exe'), 'shim');
      ctx.env.PATH = shim;
      ctx.run.mockImplementation(async (_command, args) => {
        if (args[0] === '--exec-path') return join(git, prefix, 'libexec/git-core');
        return args[0] === '--version' ? 'git version 2.56.0.windows.2' : 'okw-git-bash';
      });
      if (prefix === 'other') {
        await expect(ensureGitBash(ctx)).rejects.toThrow(/SHA256/);
      } else expect((await ensureGitBash(ctx)).root).toBe(git);
    });

    it('reuses the standard per-user Git location', async () => {
      const git = join(ctx.env.LOCALAPPDATA, 'Programs/Git');
      await pair(git);
      expect((await ensureGitBash(ctx)).root).toBe(git);
    });
  });
}

function verifiedFixtureDownload() {
  hashing.fixture = true;
  const bytes = Buffer.alloc(x64.size);
  Buffer.from(';!@Install@!UTF-8!\nRunProgram="git-bash.exe post-install.bat"\n;!@InstallEnd@!\n').copy(bytes);
  Buffer.from('377abcaf271c', 'hex').copy(bytes, bytes.indexOf(Buffer.from(';!@InstallEnd@!')) + 15);
  ctx.gitBashDownload.mockResolvedValue(bytes);
}

function portableScenarios() {
  describe('Portable Git ownership and verification', () => {
    it.each(['AMD64', 'ARM64'])('selects the fixed real %s asset and rejects digest before execution', async (native) => {
      ctx.env.PROCESSOR_ARCHITEW6432 = native;
      ctx.env.PROCESSOR_ARCHITECTURE = 'x86';
      await expect(ensureGitBash(ctx)).rejects.toThrow(/SHA256/);
      const asset = ctx.gitBashDownload.mock.calls[0][0];
      expect(asset.name).toContain(native === 'ARM64' ? '-arm64.' : '-64-bit.');
      expect(asset.digest).toHaveLength(64);
      expect(ctx.run).not.toHaveBeenCalled();
      expect(await readdir(join(ctx.home, 'runtime'))).toEqual([]);
    });

    it('rejects an unsupported native architecture', async () => {
      ctx.env.PROCESSOR_ARCHITECTURE = 'x86';
      await expect(ensureGitBash(ctx)).rejects.toThrow(/x64 or arm64/);
    });

    it.each(['unknown', 'corrupt', 'broken'])('preserves an existing %s private runtime', async (mode) => {
      const destination = join(ctx.home, 'runtime/git-2.56.0.2-win-x64');
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, 'keep'), 'untouched');
      if (mode !== 'unknown') await writeFile(join(destination, '.open-kimi-web-git.json'), mode === 'corrupt' ? '{' :
        JSON.stringify({ version: '2.56.0.2', digest: x64.digest, asset: x64.name }));
      await expect(ensureGitBash(ctx)).rejects.toThrow(/unrecognized|broken/);
      expect(await readFile(join(destination, 'keep'), 'utf8')).toBe('untouched');
      expect(ctx.gitBashDownload).not.toHaveBeenCalled();
    });

    it('does not remove another installer lock', async () => {
      const runtime = join(ctx.home, 'runtime');
      await mkdir(runtime, { recursive: true });
      await writeFile(join(runtime, 'git-2.56.0.2-win-x64.lock'), 'other');
      await expect(ensureGitBash(ctx)).rejects.toThrow(/locked/);
      expect(await readdir(runtime)).toEqual(['git-2.56.0.2-win-x64.lock']);
    });

    it('cleans a failed download so retry is possible', async () => {
      ctx.gitBashDownload.mockRejectedValueOnce(new Error('offline'));
      await expect(ensureGitBash(ctx)).rejects.toThrow('offline');
      await expect(ensureGitBash(ctx)).rejects.toThrow(/SHA256/);
      expect(await readdir(join(ctx.home, 'runtime'))).toEqual([]);
    });

    it.each(['success', 'layout', 'capability', 'extract'])('stages verified bytes and handles %s atomically', async (mode) => {
      verifiedFixtureDownload();
      ctx.run.mockImplementation(async (command, args, options) => {
        if (args.includes('-EncodedCommand')) {
          const text = Buffer.from(args.at(-1), 'base64').toString('utf16le');
          expect(text).toContain('-y -o"');
          const extraction = await readFile(join(options.cwd, x64.name));
          const config = extraction.subarray(0, 200).toString();
          expect(config).toContain('RunProgram="usr\\\\bin\\\\true.exe"');
          expect(config).not.toContain('git-bash.exe');
          expect(options.env.USERPROFILE).not.toBe(process.env.USERPROFILE);
          expect(options.env.PATH).not.toBe(process.env.PATH);
          if (mode === 'extract') throw new Error('extract failed');
          if (mode === 'layout') return '';
          const unpacked = join(options.cwd, 'unpacked');
          await pair(unpacked);
          await pair(unpacked, 'usr/bin/bash.exe');
          await writeFile(join(unpacked, 'post-install.bat'), 'official fixture');
          return '';
        }
        if (args[0] === '--version') return mode === 'capability' ? 'wrong' : 'git version 2.56.0.windows.2';
        if (command.endsWith('bash.exe')) return 'okw-git-bash';
        throw new Error('unexpected process');
      });
      if (mode !== 'success') {
        await expect(ensureGitBash(ctx)).rejects.toThrow(/layout|invalid|failed/);
        expect(await readdir(join(ctx.home, 'runtime'))).toEqual([]);
      } else {
        const found = await ensureGitBash(ctx);
        expect(found.kind).toBe('portable');
        expect(await readdir(join(ctx.home, 'runtime'))).toEqual(['git-2.56.0.2-win-x64']);
        ctx.env.PATH = '';
        delete ctx.env.KIMI_SHELL_PATH;
        await ensureGitBash(ctx);
        expect(ctx.gitBashDownload).toHaveBeenCalledTimes(1);
      }
    });
  });
}

function extractionConfigurationScenarios() {
  describe('Verified SFX extraction configuration', () => {
    it('preserves the exact module and 7z payload while replacing only the default command', async () => {
      const { portableExtractionBytes } = await import('../../scripts/install/gitBash.mjs');
      const module = Buffer.from('verified executable module');
      const config = Buffer.from(';!@Install@!UTF-8!\nRunProgram="git-bash.exe post-install.bat"\n;!@InstallEnd@!\n');
      const payload = Buffer.concat([Buffer.from('377abcaf271c', 'hex'), Buffer.from('verified payload')]);
      const rewritten = portableExtractionBytes(Buffer.concat([module, config, payload]));
      expect(rewritten.subarray(0, module.length)).toEqual(module);
      expect(rewritten.subarray(-payload.length)).toEqual(payload);
      expect(rewritten.toString()).toContain('RunProgram="usr\\\\bin\\\\true.exe"');
      expect(rewritten.toString()).not.toContain('post-install.bat');
    });

    it.each(['missing', 'bad-payload'])('rejects %s SFX before any execution', async (mode) => {
      const { portableExtractionBytes } = await import('../../scripts/install/gitBash.mjs');
      const bytes = mode === 'missing' ? Buffer.from('exe') :
        Buffer.from(';!@Install@!UTF-8!\n;!@InstallEnd@!\nnot-7z');
      expect(() => portableExtractionBytes(bytes)).toThrow(/SFX/);
    });
  });
}

function networkScenarios() {
  describe('Portable Git network boundary', () => {
    it.each(['http://github.com/a', 'https://example.test/a', `${release}wrong.exe`,
      'https://github.com/other/repo/releases/download/v1/a.exe', 'https://user@objects.githubusercontent.com/a'])
    ('rejects unapproved URL %s', (url) => { expect(() => assertGitDownloadUrl(url)).toThrow(); });

    it('only permits release-asset hosts after an official redirect', () => {
      expect(() => assertGitDownloadUrl('https://objects.githubusercontent.com/a')).toThrow();
      expect(assertGitDownloadUrl('https://release-assets.githubusercontent.com/a', true).protocol).toBe('https:');
    });

    it('follows one approved redirect and closes its agent', async () => {
      const mock = network([{ statusCode: 302, headers: { location: 'https://release-assets.githubusercontent.com/a' } },
        { body: 'fixture' }]);
      expect((await downloadGitAsset(x64, {}, mock.dependencies)).toString()).toBe('fixture');
      expect(mock.request).toHaveBeenCalledTimes(2);
      expect(mock.agent.destroy).toHaveBeenCalledOnce();
    });

    it('enforces its total deadline and aborts the request', async () => {
      const agent = { destroy: vi.fn() };
      const request = new EventEmitter();
      request.setTimeout = vi.fn();
      request.end = vi.fn();
      request.destroy = vi.fn();
      await expect(downloadGitAsset(x64, {}, {
        agentFactory: () => agent, request: () => request, timeoutMs: 5,
      })).rejects.toThrow(/timed out/);
      expect(request.destroy).toHaveBeenCalledOnce();
      expect(agent.destroy).toHaveBeenCalledOnce();
    });

    it.each(['redirect', 'status', 'size', 'interrupted', 'error', 'missing-location', 'redirect-loop'])
    ('rejects %s responses with cleanup', async (mode) => {
      const response = {
        redirect: [{ statusCode: 302, headers: { location: 'https://example.test/a' } }],
        status: [{ statusCode: 404 }], size: [{ body: 'too much' }], interrupted: [{ complete: false }],
        error: [{ error: true }], 'missing-location': [{ statusCode: 302 }],
        'redirect-loop': Array.from({ length: 5 }, () => ({ statusCode: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/a' } })),
      }[mode];
      const mock = network(response);
      const asset = mode === 'size' ? { ...x64, size: 1 } : x64;
      await expect(downloadGitAsset(asset, {}, mock.dependencies)).rejects.toThrow();
      expect(mock.agent.destroy).toHaveBeenCalledOnce();
    });
  });
}
