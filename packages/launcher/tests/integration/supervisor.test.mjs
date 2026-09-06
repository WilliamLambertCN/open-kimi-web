import { describe, expect, it, vi } from 'vitest';

import { frontendOptions, killBackend } from '../../src/integration/supervisor.mjs';

describe('supervisor process termination', () => {
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
});

describe('supervisor web options', () => {
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
