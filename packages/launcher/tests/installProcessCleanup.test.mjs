import { describe, expect, it, vi } from 'vitest';
import { stopInstallerGroup } from '../../../scripts/install/processCleanup.mjs';

function missing() {
  return Object.assign(new Error('process group exited'), { code: 'ESRCH' });
}

describe('installer POSIX process group exit confirmation', () => {
  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid group identity %s', async (pid) => {
    const kill = vi.fn();
    await expect(stopInstallerGroup(pid, { kill })).rejects.toThrow('identity is unavailable');
    expect(kill).not.toHaveBeenCalled();
  });

  it('accepts an already absent group without waiting or signalling another process', async () => {
    const kill = vi.fn(() => { throw missing(); });
    const wait = vi.fn();
    await stopInstallerGroup(123, { kill, wait });
    expect(kill.mock.calls).toEqual([[-123, 'SIGKILL']]);
    expect(wait).not.toHaveBeenCalled();
  });

  it('waits for the entire group after SIGKILL rather than treating the signal as an exit', async () => {
    let release;
    let gone = false;
    const kill = vi.fn((pid, signal) => { if (signal === 0 && gone) throw missing(); });
    const wait = vi.fn(() => new Promise((resolve) => { release = () => { gone = true; resolve(); }; }));
    let settled = false;
    const task = stopInstallerGroup(123, { kill, wait }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(kill.mock.calls).toEqual([[-123, 'SIGKILL'], [-123, 0]]);
    release();
    await task;
    expect(settled).toBe(true);
    expect(wait.mock.calls).toEqual([[50]]);
    expect(kill.mock.calls.at(-1)).toEqual([-123, 0]);
  });

  it('accepts an exit at the bounded confirmation deadline', async () => {
    let elapsed = 0;
    const kill = vi.fn((pid, signal) => { if (signal === 0 && elapsed === 3_000) throw missing(); });
    const wait = vi.fn(async (ms) => { elapsed += ms; });
    await stopInstallerGroup(123, { kill, wait });
    expect(elapsed).toBe(3_000);
    expect(wait).toHaveBeenCalledTimes(60);
  });

  it('rejects a group whose exit cannot be confirmed within the original cleanup budget', async () => {
    const kill = vi.fn();
    const wait = vi.fn(async () => {});
    await expect(stopInstallerGroup(123, { kill, wait })).rejects.toThrow('exit could not be confirmed');
    expect(wait).toHaveBeenCalledTimes(60);
    expect(kill.mock.calls.filter(([, signal]) => signal === 'SIGKILL')).toEqual([[-123, 'SIGKILL']]);
  });

  it.each(['SIGKILL', 0])('does not hide permission failures while sending %s', async (failingSignal) => {
    const error = Object.assign(new Error('permission denied'), { code: 'EPERM' });
    const kill = vi.fn((pid, signal) => { if (signal === failingSignal) throw error; });
    const wait = vi.fn();
    await expect(stopInstallerGroup(123, { kill, wait })).rejects.toBe(error);
    expect(wait).not.toHaveBeenCalled();
  });

  it('propagates confirmation failures instead of releasing the installer lock', async () => {
    const error = new Error('confirmation interrupted');
    await expect(stopInstallerGroup(123, { kill: () => {}, wait: async () => { throw error; } })).rejects.toBe(error);
  });
});
