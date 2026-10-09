import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLock, lockPath } from '../src/update/lock.mjs';
import { checkedRun, runProcess } from '../src/update/process.mjs';
import { npmArguments, updateNpm } from '../src/update/npmUpdate.mjs';
import { parseUpdateArgs, updateMain } from '../src/update/updateMain.mjs';
import { verifyInstallation } from '../src/update/verification.mjs';
import { currentFacts } from '../src/update/currentFacts.mjs';

const paths = [];
async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'okw-update-process-'));
  paths.push(path);
  return path;
}
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
const installation = { kind: 'global', prefix: 'fixture-prefix', root: 'fixture-root', version: '2.1.1-r9' };
const plan = { version: '2.1.1-r10', url: 'https://github.com/WilliamLambertCN/open-kimi-web/releases/download/' +
  'v2.1.1-r10/open-kimi-web-2.1.1-r10.tgz' };
function dependencies(overrides = {}) {
  return { identify: async () => installation, latestRelease: async () => plan,
    acquireLock: async () => vi.fn(), log: vi.fn(), error: vi.fn(), ...overrides };
}

describe('bounded shell-free update process', () => {
  it('keeps metacharacters as argv, captures bounded output and reports command failures', async () => {
    const text = 'spaces & %PATH% ; $(never)';
    const result = await runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', text]);
    expect(result.stdout.trim()).toBe(text);
    expect(result.code).toBe(0);
    await expect(checkedRun(process.execPath, ['-e', 'console.error("failure");process.exit(3)'])).rejects.toThrow('failure');
    await expect(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(50000))'], {
      maxBytes: 100,
    })).rejects.toThrow('output bytes');
    await expect(runProcess(join(await temp(), 'nonexistent.exe'))).rejects.toThrow();
  });
  it('times out or cancels only owned processes and does not execute an already cancelled command', async () => {
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      timeoutMs: 40,
    })).rejects.toThrow('timed out');
    const controller = new AbortController();
    const task = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 40);
    await expect(task).rejects.toThrow('cancelled');
    await expect(runProcess(process.execPath, [], { signal: controller.signal })).rejects.toThrow('before start');
  });
});

describe('installation-external exclusive lock', () => {
  it('serializes the same target and releases only its own lock', async () => {
    const directory = await temp();
    const target = { root: join(directory, 'installed') };
    await mkdir(target.root);
    const release = await acquireLock(target, { directory });
    const owner = JSON.parse(await readFile(join(lockPath(target, directory), 'owner'), 'utf8'));
    expect(owner.pid).toBe(process.pid);
    await expect(acquireLock(target, { directory })).rejects.toThrow('already has an update lock');
    await release();
    await release();
    const again = await acquireLock(target, { directory });
    await again();
  });
});

describe('update orchestration boundaries', () => {
  it('returns 2 for unsupported arguments and help does not identify or load services', async () => {
    const deps = dependencies({ identify: vi.fn() });
    expect(await updateMain(['--help'], deps)).toBe(0);
    expect(deps.identify).not.toHaveBeenCalled();
    expect(await updateMain(['--check', '--help'], deps)).toBe(2);
    expect(() => parseUpdateArgs(['--force'])).toThrow();
    expect(parseUpdateArgs([])).toEqual({ check: false });
  });
  it('check does not acquire a lock or install; equal/newer installations never downgrade', async () => {
    const deps = dependencies({ acquireLock: vi.fn(), run: vi.fn() });
    expect(await updateMain(['--check'], deps)).toBe(0);
    expect(deps.acquireLock).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
    const current = dependencies({ latestRelease: async () => ({ ...plan, version: '2.1.1-r8' }), run: vi.fn() });
    expect(await updateMain([], current)).toBe(0);
    expect(current.run).not.toHaveBeenCalled();
  });
  it('keeps the exact global target, ignores scripts and reports partial replacement failure', async () => {
    const release = vi.fn();
    const deps = dependencies({ acquireLock: async () => release, reidentify: async () => installation,
      resolveTool: async () => ({ command: process.execPath, args: ['npm-cli.js'] }),
      run: vi.fn(async () => { throw new Error('fixture replacement failed'); }) });
    expect(await updateMain([], deps)).toBe(1);
    expect(deps.error.mock.calls.flat().join('\n')).toContain('npm replacement');
    expect(deps.error.mock.calls.flat().join('\n')).toContain('partially changed');
    expect(release).toHaveBeenCalledOnce();
    expect(deps.run.mock.calls[0][1]).toContain('--ignore-scripts');
    expect(deps.run.mock.calls[0][1]).toContain('--force=false');
    expect(deps.run.mock.calls[0][1]).toContain('--package-lock-only=false');
    expect(deps.run.mock.calls[0][1]).toContain('--replace-registry-host=never');
    expect(deps.run.mock.calls[0][1]).toContain(installation.prefix);
    expect(deps.run.mock.calls[0][1].at(-1)).toBe(plan.url);
  });
  it('reports lookup and fresh verification failures honestly and cleans locks', async () => {
    const network = dependencies({ latestRelease: async () => { throw new Error('rate limited'); } });
    expect(await updateMain([], network)).toBe(1);
    expect(network.error.mock.calls.flat().join('\n')).toContain('No replacement stage');
    const deps = dependencies({ reidentify: async () => installation, run: async () => '',
      resolveTool: async () => ({ command: process.execPath, args: ['npm-cli.js'] }),
      verify: async () => { throw new Error('missing new dependencies'); } });
    expect(await updateMain([], deps)).toBe(1);
    expect(deps.error.mock.calls.flat().join('\n')).toContain('fresh-process verification');
    expect(deps.error.mock.calls.flat().join('\n')).toContain('partially changed');
  });
  it('reports lock cleanup failures instead of silently leaving a stale lock', async () => {
    const deps = dependencies({ acquireLock: async () => async () => { throw new Error('fixture lock remains'); },
      latestRelease: async () => ({ ...plan, version: '2.1.1-r8' }) });
    expect(await updateMain([], deps)).toBe(1);
    expect(deps.error.mock.calls.flat().join('\n')).toContain('lock cleanup failed');
  });
  it('rechecks npm identity before starting replacement', async () => {
    const run = vi.fn();
    await expect(updateNpm(installation, plan, { run, reidentify: async () => ({ ...installation, version: '2.1.1-r8' }),
      resolveTool: async () => ({ command: process.execPath, args: [] }),
    })).rejects.toThrow('changed before replacement');
    expect(run).not.toHaveBeenCalled();
    const local = npmArguments({ kind: 'local', owner: 'space & % value', category: 'devDependencies' }, plan.url);
    expect(local).toContain('--save-dev');
    expect(local).toContain('--include=dev');
    expect(() => npmArguments({ kind: 'source' }, plan.url)).toThrow();
  });
});

describe('failure current facts', () => {
  it('reads the current disk version without claiming runnability and reports unavailable evidence', async () => {
    const root = await temp();
    const log = vi.fn();
    await currentFacts(undefined, log);
    expect(log).not.toHaveBeenCalled();
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: plan.version }));
    await currentFacts({ root, kind: 'global' }, log);
    expect(log).toHaveBeenLastCalledWith(`Current on-disk version: ${plan.version} (not verified as runnable).`);
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: 'malformed\nversion' }));
    await currentFacts({ root, kind: 'global' }, log);
    expect(log.mock.calls.at(-1)[0]).toContain('manifest/version could not be verified');
    await rm(join(root, 'package.json'));
    await currentFacts({ root, kind: 'source', repo: root }, log);
    expect(log.mock.calls.at(-1)[0]).toContain('HEAD could not be read');
  });
});

describe('fresh-process verification', () => {
  it('reads a newly changed entry and checks dependency imports rather than current module caches', async () => {
    const root = await temp();
    const entry = join(root, 'entry.mjs');
    await writeFile(entry, 'console.log("2.1.1-r10")');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'open-kimi-web', version: plan.version,
      bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' }, dependencies: {} }));
    const identity = { kind: 'global', root, entry };
    await expect(verifyInstallation(identity, plan, { reidentify: async () => ({ ...identity, version: plan.version }) }))
      .resolves.toBeUndefined();
    await writeFile(entry, 'console.log("2.1.1-r9")');
    await expect(verifyInstallation(identity, plan)).rejects.toThrow('--version');
    await writeFile(entry, 'console.log("2.1.1-r10")');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'open-kimi-web', version: plan.version,
      bin: { 'open-kimi-web': 'bin/open-kimi-web.mjs' }, dependencies: { 'fixture-missing-module': '1.0.0' } }));
    await expect(verifyInstallation(identity, plan)).rejects.toThrow('failed');
  });
});
