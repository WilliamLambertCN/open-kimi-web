import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareRestart, restartCommand } from '../src/restart/launch.mjs';
import {
  launchReplacement, restartWorker, runRestartWorker, waitForParentExit, waitForReplacementSlots,
} from '../src/restart/worker.mjs';

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
    expect(c.disconnect).not.toHaveBeenCalled();
    prepared.release();
    expect(c.send).toHaveBeenCalledWith({ type: 'release' }, expect.any(Function));
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
    await restartWorker(command, { wait: vi.fn(), slots: vi.fn(), sleep: vi.fn(), launch });
    expect(launch).toHaveBeenCalledTimes(2);
    const unsafe = vi.fn(async () => { throw new Error('replacement-cleanup-unconfirmed'); });
    await expect(restartWorker(command, { wait: vi.fn(), slots: vi.fn(), launch: unsafe }))
      .rejects.toThrow('cleanup-unconfirmed');
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


describe('cancellable armed restart worker', () => {
  it('allows cancellation after ACK without disconnecting or releasing the replacement early', async () => {
    const c = child(); const task = prepareRestart(command, { fork: () => c });
    c.emit('message', { type: 'prepared' }); const ready = await task;
    const committed = ready.commit(); c.emit('message', { type: 'committed' });
    expect(await committed).toBe(true); expect(c.disconnect).not.toHaveBeenCalled();
    ready.cancel(); ready.cancel();
    expect(c.send.mock.calls.filter(([message]) => message.type === 'cancel')).toHaveLength(1);
    expect(c.disconnect).toHaveBeenCalledOnce(); expect(await ready.commit()).toBe(false);
  });

  it('does not start a replacement while the acknowledged parent is still connected', async () => {
    const channel = child(); const restart = vi.fn(async () => {}); const exit = vi.fn();
    runRestartWorker(channel, { restart, exit, parentPid: 4444 });
    channel.emit('message', { type: 'prepare', command }); channel.emit('message', { type: 'commit' });
    expect(channel.send).toHaveBeenCalledWith({ type: 'committed' }, expect.any(Function));
    expect(restart).not.toHaveBeenCalled();
    channel.emit('disconnect'); await Promise.resolve();
    expect(restart).toHaveBeenCalledWith(command, { parentPid: 4444 }); expect(exit).toHaveBeenCalledWith(0);
  });

  it('survives a lost ACK when the parent exits, but discards an unarmed worker', async () => {
    const channel = child(); const restart = vi.fn(async () => {}); const exit = vi.fn();
    channel.send.mockImplementation((_message, callback) => callback?.(new Error('parent disappeared')));
    runRestartWorker(channel, { restart, exit });
    channel.emit('message', { type: 'prepare', command }); channel.emit('message', { type: 'commit' });
    expect(exit).not.toHaveBeenCalled(); channel.emit('disconnect'); await Promise.resolve();
    expect(restart).toHaveBeenCalledOnce();
    const unarmed = child(); runRestartWorker(unarmed, { restart, exit }); unarmed.emit('disconnect');
    expect(restart).toHaveBeenCalledOnce(); expect(exit).toHaveBeenCalledWith(0);
  });

  it('cancels an armed worker without launching and bounds preparation with no parent', async () => {
    vi.useFakeTimers(); const channel = child(); const restart = vi.fn(); const exit = vi.fn();
    runRestartWorker(channel, { restart, exit });
    channel.emit('message', { type: 'prepare', command }); channel.emit('message', { type: 'commit' });
    channel.emit('message', { type: 'cancel' }); channel.emit('disconnect');
    expect(exit).toHaveBeenCalledWith(0); expect(restart).not.toHaveBeenCalled();
    const idle = child(); runRestartWorker(idle, { restart, exit });
    await vi.advanceTimersByTimeAsync(20_000); expect(exit).toHaveBeenCalledTimes(3);
  });
});

describe('replacement address release and backend ownership', () => {
  const managed = { ...command, host: '127.0.0.1', backend: { host: '127.0.0.1', port: 58627, pid: 4444 } };
  it('waits for both owned listener slots rather than racing the old launcher close', async () => {
    const released = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true); const sleep = vi.fn();
    await waitForReplacementSlots(managed, { alive: () => false, released, sleep });
    expect(sleep).toHaveBeenCalledOnce();
    expect(released.mock.calls.map(([address]) => address.port)).toEqual([48627, 58627, 48627, 58627]);
  });

  it('refuses a surviving backend or occupied address without starting or killing anything', async () => {
    const launch = vi.fn(); const released = vi.fn(async () => true);
    await expect(restartWorker(managed, { wait: vi.fn(), launch, alive: () => true, released, sleep: vi.fn() }))
      .rejects.toThrow('original-backend-still-running');
    expect(launch).not.toHaveBeenCalled(); expect(released).not.toHaveBeenCalled();
    await expect(waitForReplacementSlots(managed, { alive: () => false, released: () => false, sleep: vi.fn() }))
      .rejects.toThrow('restart-address-in-use');
    expect(launch).not.toHaveBeenCalled();
  });
});
