import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareRestart, restartCommand } from '../src/restart/launch.mjs';
import { launchReplacement, restartWorker, waitForParentExit } from '../src/restart/worker.mjs';

const command = { cwd: '/fictional/work', args: ['entry.mjs', '__wrap', 'web', '--host', '--no-open'],
  execArgv: [], port: 48627 };
function child() {
  const value = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, connected: true,
    pid: 1234, unref: vi.fn(), disconnect: vi.fn(), send: vi.fn() });
  value.send.mockImplementation((message, callback) => { callback?.(); });
  return value;
}
afterEach(() => vi.useRealTimers());

describe('restart worker preparation', () => {
  it('retains original entry, flags, working directory and runtime without opening another browser', () => {
    const args = ['node', '/fixture/entry.mjs', '__wrap', 'web', '--host', '--debug'];
    const result = restartCommand({}, args);
    expect(result.args).toEqual([...args.slice(1), '--no-open']);
    expect(result.cwd).toBe(process.cwd()); expect(result.execArgv).toEqual(process.execArgv);
    expect(() => restartCommand({}, ['node', 'entry', 'serve'])).toThrow('restart-entry-unavailable');
    expect(() => restartCommand({ port: 0 }, args)).toThrow('restart-requires-fixed-port');
    expect(restartCommand({ port: 1234 }, [...args, '--no-open']).port).toBe(1234);
  });
  it('prepares an independent worker and requires commit acknowledgement', async () => {
    const c = child(); const fork = vi.fn(() => c); const env = { FIXTURE: 'preserved' };
    const task = prepareRestart(command, { fork, env }); c.emit('spawn');
    expect(c.send).toHaveBeenCalledWith({ type: 'prepare', command }, expect.any(Function));
    c.emit('message', { type: 'prepared' }); const prepared = await task;
    expect(fork.mock.calls[0][2]).toMatchObject({ detached: true, cwd: command.cwd, env, execArgv: [] });
    const commit = prepared.commit(); c.emit('message', { type: 'unrelated' });
    c.emit('message', { type: 'committed' }); expect(await commit).toBe(true);
    expect(c.disconnect).toHaveBeenCalledOnce(); expect(c.unref).toHaveBeenCalledOnce();
  });
  it('cancels uncommitted workers and refuses dead workers', async () => {
    const c = child(); const task = prepareRestart(command, { fork: () => c });
    c.emit('message', { type: 'prepared' }); const prepared = await task;
    prepared.cancel(); expect(c.send).toHaveBeenCalledWith({ type: 'cancel' }, expect.any(Function));
    c.connected = false; expect(await prepared.commit()).toBe(false);
  });
  it('bounds preparation failure and commit silence without stopping the original service', async () => {
    vi.useFakeTimers(); const c = child();
    const task = prepareRestart(command, { fork: () => c });
    const failed = expect(task).rejects.toThrow('restart-worker-unavailable');
    await vi.advanceTimersByTimeAsync(8000); await failed;
    const next = child(); const task2 = prepareRestart(command, { fork: () => next });
    next.emit('message', { type: 'prepared' }); const prepared = await task2;
    const commit = prepared.commit(); await vi.advanceTimersByTimeAsync(3000); expect(await commit).toBe(false);
  });
});

describe('restart IPC failures', () => {
  it('handles closed channels, failed sends and late acknowledgements without leaking commit listeners', async () => {
    const c = child(); const task = prepareRestart(command, { fork: () => c });
    c.emit('message', { type: 'prepared' }); const ready = await task;
    const count = c.listenerCount('message'); c.send.mockImplementation(() => { throw new Error('channel closed'); });
    expect(await ready.commit()).toBe(false); expect(c.listenerCount('message')).toBe(count);
    expect(() => ready.cancel()).not.toThrow();
    c.connected = false; expect(() => ready.cancel()).not.toThrow();
    const next = child(); const failed = prepareRestart(command, { fork: () => next });
    const rejection = expect(failed).rejects.toThrow('restart-worker-unavailable');
    next.send.mockImplementation((_message, callback) => callback(new Error('channel closed')));
    next.emit('spawn'); await rejection;
  });
});

describe('replacement readiness and bounded recovery', () => {
  it('waits for the original launcher to exit rather than killing its PID', async () => {
    const alive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false); const sleep = vi.fn();
    await waitForParentExit(1234, { alive, sleep }); expect(sleep).toHaveBeenCalledOnce();
    await expect(waitForParentExit(1234, { alive: () => true, sleep })).rejects.toThrow('original-launcher-still-running');
  });
  it('spawns the same command, accepts only its private ready message and detaches', async () => {
    const c = child(); const spawn = vi.fn(() => c); const env = { FIXTURE: 'same' };
    const task = launchReplacement(command, { spawn, env });
    c.emit('message', { type: 'okw-restart-ready', port: 1 });
    c.emit('message', { type: 'okw-restart-ready', port: command.port }); await task;
    expect(spawn).toHaveBeenCalledWith(process.execPath, command.args,
      expect.objectContaining({ cwd: command.cwd, env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }));
    expect(c.disconnect).toHaveBeenCalledOnce(); expect(c.unref).toHaveBeenCalledOnce();
  });
  it('cleans an owned failed startup before retrying and stops on unconfirmed cleanup', async () => {
    const c = child(); const terminate = vi.fn(async () => {});
    const task = launchReplacement(command, { spawn: () => c, terminate });
    c.emit('error', new Error('fictional failure')); await expect(task).rejects.toThrow('replacement-startup-failed');
    expect(terminate).toHaveBeenCalledWith(c, {});
    const launch = vi.fn().mockRejectedValueOnce(new Error('replacement-startup-failed')).mockResolvedValueOnce();
    await restartWorker(command, { wait: vi.fn(), sleep: vi.fn(), launch }); expect(launch).toHaveBeenCalledTimes(2);
    const unsafe = vi.fn(async () => { throw new Error('replacement-cleanup-unconfirmed'); });
    await expect(restartWorker(command, { wait: vi.fn(), launch: unsafe })).rejects.toThrow('cleanup-unconfirmed');
    expect(unsafe).toHaveBeenCalledOnce();
  });
  it('refuses recovery if a replacement already exited and its descendants cannot be confirmed stopped', async () => {
    const c = child(); const terminate = vi.fn(async () => { throw new Error('parent already exited'); });
    const task = launchReplacement(command, { spawn: () => c, terminate });
    c.exitCode = 1; c.emit('exit', 1);
    await expect(task).rejects.toThrow('replacement-cleanup-unconfirmed');
    expect(terminate).toHaveBeenCalledOnce();
  });
  it('does not retry while the original launcher is still present', async () => {
    const launch = vi.fn();
    await expect(restartWorker(command, { wait: async () => { throw new Error('still-running'); }, launch }))
      .rejects.toThrow('still-running'); expect(launch).not.toHaveBeenCalled();
  });
});
