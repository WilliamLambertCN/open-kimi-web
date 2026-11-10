import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { terminateTree } from '../src/update/treeCleanup.mjs';
import { recordProcessStart } from '../src/update/windowsTreeCleanup.mjs';

function child() {
  const value = { pid: 123, exitCode: null, signalCode: null };
  recordProcessStart(value, Date.now() - 1);
  return value;
}

function fixture(code, stderr = '') {
  const killer = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() });
  const spawn = vi.fn(() => {
    queueMicrotask(() => {
      killer.stderr.end(stderr);
      killer.emit('close', code);
    });
    return killer;
  });
  return { killer, spawn };
}

describe('native Windows updater cleanup transport', () => {
  it('uses a fixed noninteractive system executable and encoded source with the owned creation window', async () => {
    const { killer, spawn } = fixture(0);
    await terminateTree(child(), { platform: 'win32', spawn });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toMatch(/System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/);
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    const script = Buffer.from(args[4], 'base64').toString('utf16le');
    expect(script).toContain('[OkwWindowsTreeCleanup]::Stop(123,[long]');
    expect(script).toContain('GetProcessTimes');
    expect(script).toContain('WaitForSingleObject');
    expect(options).toMatchObject({ shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    expect(killer.kill).not.toHaveBeenCalled();
  });

  it('preserves bounded native failure evidence and the cleanup-unconfirmed flag', async () => {
    const { spawn } = fixture(1, 'fixture native error ' + 'x'.repeat(5_000));
    let failure;
    try { await terminateTree(child(), { platform: 'win32', spawn }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'UPDATE_CLEANUP_UNCONFIRMED', cleanupUnconfirmed: true });
    expect(failure.message).toContain('fixture native error');
    expect(failure.message.length).toBeLessThan(2_200);
  });

  it('rejects helper startup errors without claiming that descendants stopped', async () => {
    const spawn = () => {
      const killer = new EventEmitter();
      queueMicrotask(() => killer.emit('error', new Error('fixture PowerShell unavailable')));
      return killer;
    };
    await expect(terminateTree(child(), { platform: 'win32', spawn })).rejects.toMatchObject({
      code: 'UPDATE_CLEANUP_UNCONFIRMED', message: 'fixture PowerShell unavailable',
    });
  });
});
