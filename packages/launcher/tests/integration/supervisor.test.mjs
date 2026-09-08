import { describe, expect, it, vi } from 'vitest';

import {
  frontendOptions,
  killBackend,
  managedBackendWebArgs,
  MANAGED_BACKEND_DEFAULT_PORT,
  MANAGED_FRONTEND_DEFAULT_PORT,
} from '../../src/integration/supervisor.mjs';

describe('supervisor process termination', () => {
  it('leaves an already stopped child untouched', async () => {
    const exited = { exitCode: 0, signalCode: null, kill: vi.fn() };
    const signaled = { exitCode: null, signalCode: 'SIGTERM', kill: vi.fn() };
    await killBackend(exited, Promise.resolve({ code: 0 }));
    await killBackend(signaled, Promise.resolve({ code: 0 }));
    expect(exited.kill).not.toHaveBeenCalled();
    expect(signaled.kill).not.toHaveBeenCalled();
  });

  it('stops after graceful SIGTERM when the child exits', async () => {
    const child = { exitCode: null, signalCode: null, pid: 41, kill: vi.fn() };
    await killBackend(child, Promise.resolve({ code: 0 }));
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  });

  it('escalates from SIGTERM to SIGKILL and warns if the backend remains alive', async () => {
    vi.useFakeTimers();
    const child = { exitCode: null, signalCode: null, pid: 42, kill: vi.fn() };
    const warn = vi.fn();
    const stopped = killBackend(child, new Promise(() => {}), { warn });
    await vi.advanceTimersByTimeAsync(2_500);
    await stopped;
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/may still be running/));
    vi.useRealTimers();
  });

  it('uses the Windows process-tree terminator for a cmd shim', async () => {
    const killTree = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const child = { exitCode: null, signalCode: null, pid: 43, kill: vi.fn() };
    await killBackend(child, Promise.resolve({ code: 1 }), {
      treeKill: true,
      killTree,
      backendPid: 44,
    });
    expect(killTree).toHaveBeenCalledWith(44);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('reports a failed Windows tree termination using the child pid', async () => {
    const killTree = vi.fn(async () => {
      throw new Error('access denied');
    });
    const warn = vi.fn();
    const child = { exitCode: null, signalCode: null, pid: 45, kill: vi.fn() };
    await killBackend(child, Promise.resolve({ code: 1 }), { treeKill: true, killTree, warn });
    expect(killTree).toHaveBeenCalledWith(45);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/45.*access denied/));
  });
});

describe('supervisor web options', () => {
  it('enables the private official service dispatcher for managed deletion', () => {
    expect(managedBackendWebArgs).toContain('--debug-endpoints');
    expect(managedBackendWebArgs).toContain(String(MANAGED_BACKEND_DEFAULT_PORT));
  });

  it('uses the fixed companion port for the managed public endpoint', () => {
    expect(frontendOptions({}, 1234, {})).toMatchObject({
      target: 'http://127.0.0.1:1234',
      port: MANAGED_FRONTEND_DEFAULT_PORT,
      portExplicit: true,
    });
    expect(frontendOptions({ port: 61234 }, 1234, {})).toMatchObject({
      port: 61234,
      portExplicit: true,
    });
  });

  it('derives TLS from each supported host form', () => {
    expect(frontendOptions({ hostBare: true }, 1234, {})).toMatchObject({
      host: '0.0.0.0', https: true,
    });
    expect(frontendOptions({ host: 'localhost' }, 1234, {})).toMatchObject({
      host: 'localhost', https: false,
    });
    expect(frontendOptions({ host: '192.168.1.20' }, 1234, {})).toMatchObject({
      host: '192.168.1.20', https: true,
    });
  });

  it('passes directory/version environment options and lets explicit values win', () => {
    const env = {
      OPEN_KIMI_WEB_DIR: 'C:\\env-web',
      OPEN_KIMI_WEB_VERSION: '1.2.3',
    };
    expect(frontendOptions({}, 1234, env)).toMatchObject({
      webDir: 'C:\\env-web', webVersion: '1.2.3',
    });
    expect(frontendOptions(
      { webDir: 'C:\\flag-web', webVersion: '9.9.9' },
      1234,
      env,
    )).toMatchObject({
      webDir: 'C:\\flag-web', webVersion: '9.9.9',
    });
  });

  it('rejects the removed open UI even when a custom directory is configured', () => {
    expect(() => frontendOptions({}, 1234, {
      OPEN_KIMI_WEB_UI: 'open',
      OPEN_KIMI_WEB_DIR: 'C:\\env-web',
    })).toThrow(/OPEN_KIMI_WEB_UI=open.*removed/);
  });
});
