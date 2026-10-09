import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { npmArguments, updateNpm } from '../src/update/npmUpdate.mjs';
import { verifyInstallation } from '../src/update/verification.mjs';
import { acquireLock } from '../src/update/lock.mjs';
import { updateMain } from '../src/update/updateMain.mjs';
import { runProcess } from '../src/update/process.mjs';
import { terminateTree, unconfirmedCleanup } from '../src/update/treeCleanup.mjs';

const installation = { kind: 'local', root: 'fixture/root', entry: 'fixture/root/bin/open-kimi-web.mjs',
  owner: 'fixture', version: '2.1.1-r9', category: 'dependencies', ownerManifest: { dependencies: { fixture: '1' } } };
const plan = { version: '2.1.1-r10', url: 'https://github.com/WilliamLambertCN/open-kimi-web/releases/download/' +
  'v2.1.1-r10/open-kimi-web-2.1.1-r10.tgz' };
const mutations = [
  ['category', 'devDependencies'], ['root', 'other/root'], ['owner', 'other'], ['prefix', 'unexpected'],
  ['entry', 'other/bin.mjs'], ['kind', 'global'], ['ownerManifest', { dependencies: { fixture: '2' } }],
];
const directories = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'okw-update-safety-'));
  directories.push(path);
  return path;
}

describe('npm explicit configuration and identity races', () => {
  it('fixes host replacement, local install mode and save despite inherited configuration', () => {
    const local = npmArguments(installation, plan.url);
    expect(local).toEqual(expect.arrayContaining(['--replace-registry-host=never', '--location=project', '--save=true']));
    expect(local.at(-1)).toBe(plan.url);
    expect(npmArguments({ kind: 'global', prefix: 'fixture' }, plan.url)).toContain('--replace-registry-host=never');
  });
  it.each(mutations)('refuses raced %s evidence before any replacement', async (key, value) => {
    const run = vi.fn();
    await expect(updateNpm(installation, plan, { run, reidentify: async () => ({ ...installation, [key]: value }),
      resolveTool: async () => ({ command: process.execPath, args: [] }),
    })).rejects.toThrow('changed before replacement');
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects a changed global prefix before replacement and after fresh verification', async () => {
    const target = { kind: 'global', root: installation.root, entry: installation.entry,
      prefix: 'fixture-prefix', version: installation.version };
    const changed = { ...target, prefix: 'another-prefix' };
    const run = vi.fn();
    await expect(updateNpm(target, plan, { run, reidentify: async () => changed,
      resolveTool: async () => ({ command: process.execPath, args: [] }),
    })).rejects.toThrow('changed before replacement');
    expect(run).not.toHaveBeenCalled();
    const probe = async (command, args) => args.includes('--version') ? plan.version :
      JSON.stringify({ entry: target.entry, version: plan.version });
    await expect(verifyInstallation(target, plan, { run: probe,
      reidentify: async () => ({ ...changed, version: plan.version }),
    })).rejects.toThrow('updated install identity mismatch');
  });
  it.each(mutations.filter(([key]) => key !== 'ownerManifest'))('fresh verification refuses changed %s', async (key, value) => {
    const run = vi.fn(async (command, args) => args.includes('--version') ? plan.version :
      JSON.stringify({ entry: installation.entry, version: plan.version }));
    await expect(verifyInstallation(installation, plan, { run,
      reidentify: async () => ({ ...installation, version: plan.version, [key]: value }),
    })).rejects.toThrow('updated install identity mismatch');
  });
});

describe('platform-specific process tree cleanup', () => {
  it('terminates the owned POSIX group after its parent exits, then kills only after bounded grace', async () => {
    const kill = vi.fn();
    const wait = vi.fn(async () => {});
    await terminateTree({ pid: 123, exitCode: 0, signalCode: null }, { platform: 'linux', kill, wait });
    expect(kill.mock.calls[0]).toEqual([-123, 'SIGTERM']);
    expect(wait).toHaveBeenCalledTimes(20);
    expect(kill.mock.calls.at(-1)).toEqual([-123, 'SIGKILL']);
  });
  it('does not escalate a group that stops during TERM grace or no longer exists', async () => {
    const missing = () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); };
    const kill = vi.fn().mockImplementationOnce(() => {}).mockImplementation(missing);
    await terminateTree({ pid: 123 }, { platform: 'linux', kill, wait: async () => {} });
    expect(kill).not.toHaveBeenCalledWith(-123, 'SIGKILL');
    await terminateTree({ pid: 123 }, { platform: 'linux', kill: missing });
  });
  it('never taskkills an already exited Windows PID and reports unknown cleanup', async () => {
    const spawn = vi.fn();
    await expect(terminateTree({ pid: 123, exitCode: 0, signalCode: null }, { platform: 'win32', spawn }))
      .rejects.toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
    expect(spawn).not.toHaveBeenCalled();
  });
  it('marks taskkill failure and POSIX signal failure as unconfirmed', async () => {
    const spawn = () => {
      const killer = new EventEmitter();
      queueMicrotask(() => killer.emit('close', 1));
      return killer;
    };
    await expect(terminateTree({ pid: 123, exitCode: null, signalCode: null }, { platform: 'win32', spawn }))
      .rejects.toMatchObject({ cleanupUnconfirmed: true });
    await expect(terminateTree({ pid: 123 }, { platform: 'linux', kill: () => { throw new Error('permission denied'); } }))
      .rejects.toMatchObject({ cleanupUnconfirmed: true });
  });
  it('marks a timed-out Windows taskkill as unconfirmed without retrying any other PID', async () => {
    vi.useFakeTimers();
    const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
    try {
      const task = terminateTree({ pid: 123, exitCode: null, signalCode: null }, { platform: 'win32', spawn: () => killer });
      const assertion = expect(task).rejects.toMatchObject({ cleanupUnconfirmed: true });
      await vi.advanceTimersByTimeAsync(3_000);
      await assertion;
      expect(killer.kill).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it('reports unconfirmed cleanup when a process fails to close after the entire grace window', async () => {
    let child;
    try {
      const task = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 40,
        terminateTree: async (value) => { child = value; },
      });
      await expect(task).rejects.toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
    } finally {
      if (child?.exitCode === null) {
        const closed = new Promise((resolve) => child.once('close', resolve));
        child.ref();
        child.kill();
        await closed;
      }
    }
  }, 10_000);
  it('preserves the machine-readable flag when a live process closes after failed tree cleanup', async () => {
    await expect(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 40,
      terminateTree: async (child) => { child.kill(); throw new Error('fixture tree cleanup failed'); },
    })).rejects.toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
  });
});

describe('uncertain cleanup retains installation lock', () => {
  it('retains a real lock, blocks another update and names the manual inspection path', async () => {
    const directory = await temp();
    const target = { ...installation, root: join(directory, 'installed'), owner: directory };
    await mkdir(target.root);
    const release = await acquireLock(target, { directory });
    const error = vi.fn();
    const result = await updateMain([], { identify: async () => target, latestRelease: async () => plan,
      acquireLock: async () => release, reidentify: async () => target, log: vi.fn(), error,
      resolveTool: async () => ({ command: process.execPath, args: [] }),
      run: async () => { throw unconfirmedCleanup('fixture descendants remain'); },
    });
    expect(result).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain(`update lock retained: ${release.path}`);
    expect(error.mock.calls.flat().join('\n')).toContain('original updater and its descendants');
    expect(JSON.parse(await readFile(join(release.path, 'owner'), 'utf8')).pid).toBe(process.pid);
    await expect(acquireLock(target, { directory })).rejects.toThrow('already has an update lock');
    await release();
  });
});
