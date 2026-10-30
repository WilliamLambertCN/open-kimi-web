import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjacentNpm, makeInstallContext, runInstallProcess } from '../../scripts/install.mjs';
import { ensureGitBash } from '../../scripts/install/gitBash.mjs';
import { verifyPty } from '../../scripts/install/pty.mjs';
import { dependencyRoot } from '../../scripts/install/ptyAudit.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { canonicalNpmCmd, discoverOfficial, officialPaths, prepareOfficial } from '../../scripts/install/official.mjs';
import { verifyOfficialShell } from '../../scripts/install/officialShell.mjs';
import { preparePty } from '../../scripts/install/pty.mjs';
import { fileDigest, installNpmArgs, isolatedNpmEnv } from '../../scripts/install/npm.mjs';
import { createHash } from 'node:crypto';

const LEGACY_INTEGRITY = 'Ikk41ROPta1eQ6gCXOZd7Ag7fg8B0vawjwA0+MVMi8CphFBbvAz8emr7Lc9cI2dAbBSmvAX16U7Jc/+mPVw7Cg==';
let legacy;

let directory;
let ctx;
let stage;

function isolatedEnv(root, source = process.env) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)',
    'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'KIMI_SHELL_PATH']) {
    const key = Object.keys(source).find((key) => key.toLowerCase() === name.toLowerCase());
    if (key) env[name] = source[key];
  }
  const stage = join(root, 'stage');
  const home = join(stage, 'home');
  return { ...env, HOME: home, USERPROFILE: home,
    APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'),
    XDG_CACHE_HOME: join(home, '.cache'), XDG_STATE_HOME: join(home, '.local/state'),
    XDG_RUNTIME_DIR: join(stage, 'runtime'), TEMP: join(stage, 'tmp'), TMP: join(stage, 'tmp'), TMPDIR: join(stage, 'tmp'),
    OPEN_KIMI_WEB_HOME: root, KIMI_CODE_HOME: join(stage, 'kimi-code'),
    npm_config_userconfig: join(stage, 'user.npmrc'), npm_config_globalconfig: join(stage, 'global.npmrc'),
    npm_config_cache: join(stage, 'cache'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(stage, 'gitconfig'),
    BASH_ENV: '', ENV: '' };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'okw-official-real-'));
  stage = join(directory, 'stage');
  const env = isolatedEnv(directory);
  for (const key of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'TEMP', 'KIMI_CODE_HOME']) {
    await mkdir(env[key], { recursive: true, mode: 0o700 });
  }
  for (const name of ['user.npmrc', 'global.npmrc', 'gitconfig']) await writeFile(join(stage, name), '', { mode: 0o600 });
  ctx = makeInstallContext({ env, log: () => {}, windowsPaths: async () => ({ user: '', system: '' }),
    run: (command, args, settings) => runInstallProcess(command, args, { cwd: directory, ...settings }) });
  ctx.npm = await adjacentNpm(ctx.node);
  if (process.env.OPEN_KIMI_TEST_OFFICIAL_ARCHIVE) {
    ctx.downloadOfficial = async (url) => {
      expect(url).toBe('https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.4.1.tgz');
      return readFile(process.env.OPEN_KIMI_TEST_OFFICIAL_ARCHIVE);
    };
  }
  await ensureGitBash(ctx);
}, 30000);

afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port === 58627 ? freePort() : port;
}

async function authHeaders() {
  try {
    const token = (await readFile(join(ctx.env.KIMI_CODE_HOME, 'server.token'), 'utf8')).trim();
    return token ? { authorization: `Bearer ${token}` } : undefined;
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('isolated official server token is unreadable'); }
}

async function ready(url, child) {
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error('isolated official Web exited before health check');
    const headers = await authHeaders();
    if (headers) {
      try {
        const response = await fetch(`${url}/api/v1/meta`, { headers });
        if (response.ok) return { response, headers };
      } catch {}
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('isolated official Web readiness timed out');
}

describe('real pinned official npm dependency', () => {
  it('keeps top-level scripts disabled, verifies real CLI/child_process shell and reuses owned 2.4.1', async () => {
    const progress = {};
    await prepareOfficial({ ...ctx, env: { ...ctx.env, OPEN_KIMI_REAL_KIMI: undefined, PATH: '' } },
      { kind: 'missing' }, stage, progress);
    const paths = officialPaths(ctx);
    const record = JSON.parse(await readFile(paths.record, 'utf8'));
    expect(record).toMatchObject({ schema: 1, version: '2.4.1', entry: paths.entry });
    const manifest = JSON.parse(await readFile(join(paths.root, 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: '@moonshot-ai/kimi-code', version: '2.4.1', engines: { node: '>=22.19.0' } });
    expect(manifest.dependencies?.['node-pty']).toBeUndefined();
    await verifyOfficialShell(ctx, paths.root);
    expect(await verifyPty(ctx, paths.root)).toBe('missing');
    expect(await ctx.run(ctx.node, [paths.entry, '--version'], { env: ctx.env })).toContain('2.4.1');
    expect(await ctx.run(ctx.node, [paths.entry, 'web', '--help'], { env: ctx.env })).toContain('--no-open');
    const found = await discoverOfficial({ ...ctx, env: { ...ctx.env, PATH: '' }, kimi: undefined });
    expect(found).toMatchObject({ kind: 'npm', path: paths.kimi });
    const snapshot = await readFile(paths.record, 'utf8');
    await prepareOfficial(ctx, found, stage, progress);
    expect(ctx.kimi).toBe(paths.kimi);
    expect(await readFile(paths.record, 'utf8')).toBe(snapshot);
    expect((await readdir(directory)).sort()).toEqual(['bootstrap-official.json', 'official', 'stage']);
  }, 180000);

  it('runs authenticated real official Web health without lifecycle scripts, login or model calls', async () => {
    await ensureGitBash(ctx);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(ctx.node, [officialPaths(ctx).entry, 'web', '--host', '127.0.0.1', '--port', String(port),
      '--no-open'], { cwd: directory, env: ctx.env, stdio: 'ignore' });
    const stopped = once(child, 'exit');
    let headers;
    try {
      const readyState = await ready(url, child);
      headers = readyState.headers;
      expect(readyState.response.status).toBe(200);
      const meta = await readyState.response.json();
      expect(meta).toBeTypeOf('object');
      expect((await fetch(`${url}/api/v1/meta`)).status).toBe(401);
      const page = await fetch(`${url}/`, { headers });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<html');
    } finally {
      headers ??= await authHeaders().catch(() => undefined);
      if (headers) await fetch(`${url}/api/v1/shutdown`, { method: 'POST', headers }).catch(() => {});
      if (child.exitCode === null) child.kill();
      await stopped;
    }
  }, 30000);

});

async function prepareLegacy() {
  const home = join(stage, 'legacy');
  legacy = { ...ctx, home, kimi: undefined, env: { ...ctx.env, HOME: home, USERPROFILE: home, PATH: '' } };
  const paths = officialPaths(legacy);
  let bytes;
  if (process.env.OPEN_KIMI_TEST_LEGACY_ARCHIVE) bytes = await readFile(process.env.OPEN_KIMI_TEST_LEGACY_ARCHIVE);
  else {
    const response = await fetch('https://registry.npmjs.org/@moonshot-ai/kimi-code/-/kimi-code-2.3.1.tgz');
    expect(response.status).toBe(200);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  expect(createHash('sha512').update(bytes).digest('base64')).toBe(LEGACY_INTEGRITY);
  const archive = join(stage, 'legacy-kimi.tgz');
  await writeFile(archive, bytes);
  await ctx.run(ctx.node, installNpmArgs({ ...ctx, prefix: paths.prefix }, archive), {
    cwd: stage, env: isolatedNpmEnv(ctx.env, stage, ctx.node, ctx.platform), timeoutMs: 300000 });
  await preparePty(ctx, paths, stage, {});
  await writeFile(paths.record, JSON.stringify({ schema: 1, version: '2.3.1', integrity: LEGACY_INTEGRITY,
    prefix: paths.prefix, entry: paths.entry, kimi: paths.kimi,
    entryDigest: await fileDigest(paths.entry), shimDigest: await fileDigest(paths.kimi) }));
  return paths;
}

describe('real owned official dependency failures', () => {
  it('retains legacy 2.3.1 PTY and rejects a missing owned binary without rewriting or rebuilding', async () => {
    const paths = await prepareLegacy();
    const pty = dependencyRoot(paths.root, 'node-pty');
    const binding = process.platform === 'win32' ? 'conpty.node' : 'pty.node';
    const binary = process.platform === 'linux' ? join(pty, 'build/Release', binding) :
      join(pty, `prebuilds/${process.platform}-${process.arch}`, binding);
    const disabled = `${binary}.qa-disabled`;
    const snapshot = await readFile(paths.record, 'utf8');
    await rename(binary, disabled);
    try {
      await expect(prepareOfficial(legacy, { kind: 'npm', path: paths.kimi }, stage, {})).rejects.toThrow('repair manually');
      expect(await readFile(paths.record, 'utf8')).toBe(snapshot);
      await expect(readFile(binary)).rejects.toThrow();
    } finally { await rename(disabled, binary); }
    expect(await verifyPty(ctx, paths.root)).toBe('ok');
    await prepareOfficial(legacy, await discoverOfficial(legacy), stage, {});
  }, 180000);

  it('rejects changed owned entry rather than reinstalling over a partial or modified install', async () => {
    await writeFile(officialPaths(ctx).entry, 'modified fixture');
    await expect(discoverOfficial(ctx)).rejects.toThrow('ownership or version changed');
  });
});

async function syntheticContext(name) {
  const home = join(stage, name);
  await mkdir(home);
  const env = { ...ctx.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), PATH: '' };
  return { ...ctx, home, bin: join(home, 'bin'), prefixBin: join(home, 'npm'), kimi: undefined, env,
    windowsPaths: async () => ({ user: '', system: '' }) };
}

async function externalNpm(context, directory) {
  const root = join(directory, 'node_modules/@moonshot-ai/kimi-code');
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@moonshot-ai/kimi-code', version: '2.4.1',
    bin: { kimi: 'dist/main.mjs' } }));
  await writeFile(join(root, 'dist/main.mjs'), 'console.log(process.argv.includes("--version") ? "2.4.1" : "kimi web --host");');
  if (context.platform === 'win32') {
    await writeFile(join(directory, 'kimi.cmd'), canonicalNpmCmd());
    return join(directory, 'kimi.cmd');
  }
  await chmod(join(root, 'dist/main.mjs'), 0o755);
  await symlink(join(root, 'dist/main.mjs'), join(directory, 'kimi'));
  return join(directory, 'kimi');
}

describe('synthetic discovery with real selected Node calls and no user persistent PATH', () => {
  it('reuses the official default-bin command with zero official downloads and leaves its bytes unchanged', async () => {
    const context = await syntheticContext('synthetic-reuse');
    const file = await externalNpm(context, join(context.env.HOME, '.kimi-code/bin'));
    const snapshot = await readFile(file);
    let downloads = 0;
    context.downloadOfficial = async () => { downloads += 1; throw new Error('official download must not run'); };
    const found = await discoverOfficial(context);
    expect(found).toMatchObject({ kind: 'npm', path: file, version: '2.4.1' });
    await prepareOfficial(context, found, stage, {});
    expect(downloads).toBe(0);
    expect(await readFile(file)).toEqual(snapshot);
  });

  it('rejects a real unknown wrapper without running it or downloading over the installation', async () => {
    const context = await syntheticContext('synthetic-unknown');
    const tools = join(context.home, 'tools');
    await mkdir(tools);
    context.env.PATH = tools;
    await writeFile(join(tools, context.platform === 'win32' ? 'kimi.ps1' : 'kimi'), 'throw "do not execute"');
    await expect(discoverOfficial(context)).rejects.toThrow(/shim|executable/);
    expect(await readdir(tools)).toHaveLength(1);
  });

  it('runs an actual profile-free shell child using child_process without a package install', async () => {
    await verifyOfficialShell(ctx, stage);
  });

  it('only reports missing after absent synthetic candidates and refuses two unrelated installs', async () => {
    const context = await syntheticContext('synthetic-ambiguous');
    expect(await discoverOfficial(context)).toEqual({ kind: 'missing' });
    await externalNpm(context, join(context.env.HOME, '.kimi-code/bin'));
    await externalNpm(context, join(context.env.HOME, '.local/bin'));
    await expect(discoverOfficial(context)).rejects.toThrow('multiple official Kimi');
  });
});
