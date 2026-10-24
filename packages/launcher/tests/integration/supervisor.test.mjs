import { EventEmitter, getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/frontend.mjs', () => ({ startFrontend: vi.fn() }));
import { startFrontend } from '../../src/frontend.mjs';

import {
  assertScheduledTasksOptions,
  frontendOptions,
  killBackend,
  managedBackendWebArgs,
  MANAGED_BACKEND_DEFAULT_PORT,
  MANAGED_FRONTEND_DEFAULT_PORT,
  superviseWeb,
  waitForStop,
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
  it('starts the managed backend without exposing debug endpoints', () => {
    expect(managedBackendWebArgs).not.toContain('--debug-endpoints');
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

  it('passes scheduledTasks only from the explicit supervised option', () => {
    expect(frontendOptions({}, 1234, {}).scheduledTasks).toBe(false);
    expect(frontendOptions({ scheduledTasks: true }, 1234, {}).scheduledTasks).toBe(true);
    expect(frontendOptions({}, 1234, { OPEN_KIMI_SCHEDULED_TASKS: '1' }).scheduledTasks).toBe(false);
  });
});

describe('scheduled-tasks startup environment', () => {
  it.each([
    ['KIMI_CODE_DISABLE_HOST_CHECK', '1'], ['KIMI_CODE_ALLOWED_HOSTS', 'example.test'],
    ['KIMI_CODE_CORS_ORIGINS', 'https://example.test'], ['NODE_OPTIONS', '--require ./fixture.cjs'],
    ['node_options', '--import ./fixture.mjs'], ['NODE_PATH', 'fixture-modules'], ['LD_PRELOAD', 'fixture.so'],
    ['LD_LIBRARY_PATH', 'fixture-libs'], ['DYLD_INSERT_LIBRARIES', 'fixture.dylib'],
    ['DYLD_LIBRARY_PATH', 'fixture-libs'], ['DYLD_FRAMEWORK_PATH', 'fixture-frameworks'],
  ])('rejects %s without echoing its value', (key, value) => {
    expect(() => assertScheduledTasksOptions({ scheduledTasks: true }, { [key]: value }))
      .toThrow(new RegExp(`--scheduled-tasks.*${key.toUpperCase()}`));
    try { assertScheduledTasksOptions({ scheduledTasks: true }, { [key]: value }); }
    catch (error) { expect(error.message).not.toContain(value); }
    expect(() => assertScheduledTasksOptions({}, { [key]: value })).not.toThrow();
  });

  it('preserves safe environment settings, original home and model configuration lookup', () => {
    expect(() => assertScheduledTasksOptions({ scheduledTasks: true }, {
      HOME: '/fixture/home', KIMI_CODE_HOME: '/fixture/original-kimi-home',
      KIMI_CODE_DISABLE_HOST_CHECK: '0', KIMI_CODE_ALLOWED_HOSTS: '', KIMI_CODE_CORS_ORIGINS: '',
      NODE_OPTIONS: '', KIMI_CODE_REMOTE_CONTROL_RELAY_URL: 'https://fixture.invalid',
    })).not.toThrow();
  });

  it.each([
    [{ webDir: '/fixture/custom', scheduledTasks: true }, {}, undefined],
    [{ scheduledTasks: true }, { OPEN_KIMI_WEB_DIR: '/fixture/custom' }, undefined],
    [{ scheduledTasks: true }, {}, '/fixture/custom'],
  ])('rejects opt-in with any custom web source', (web, env, publicDir) => {
    expect(() => assertScheduledTasksOptions(web, env, publicDir)).toThrow(/custom web directories/);
  });
});

function startupFixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: process.pid, exitCode: null, signalCode: null, kill: vi.fn(),
  });
  let spawned = false;
  const instance = { server_id: 'fixture-owned', pid: process.pid, port: 1234, started_at: Date.now() + 60_000 };
  const env = { HOME: '/fixture/original-home', KIMI_CODE_HOME: '/fixture/original-kimi-home' };
  const deps = {
    spawn: vi.fn(() => { spawned = true; return child; }),
    io: { readdir: async () => spawned ? ['fixture.json'] : [], readFile: async () => JSON.stringify(instance) },
    readFile: async () => 'fictional-supervisor-token',
    fetch: vi.fn(async (url) => {
      if (String(url).endsWith('/shutdown')) {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      }
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }),
    assertCronBackend: vi.fn(async () => {}),
    waitStop: async () => ({ kind: 'signal' }), log: vi.fn(), warn: vi.fn(),
  };
  return { child, env, deps };
}

describe('supervisor controlled scheduled-task startup', () => {
  it.each([false, true])('sets fixed backend argv and frontend capability only with opt-in=%s', async (scheduledTasks) => {
    const fixture = startupFixture();
    const close = vi.fn(async () => {});
    startFrontend.mockResolvedValue({
      launcher: { accessUrls: [{ url: 'http://127.0.0.1:2345' }], close }, tokenResult: { token: null },
    });
    await expect(superviseWeb({ realKimi: '/fixture/official-kimi',
      web: { noOpen: true, scheduledTasks }, env: fixture.env, deps: fixture.deps,
    })).resolves.toBe(0);
    expect(fixture.deps.spawn.mock.calls[0][1]).toEqual([
      ...managedBackendWebArgs, ...(scheduledTasks ? ['--debug-endpoints'] : []),
    ]);
    expect(fixture.deps.spawn.mock.calls[0][2].env).toBe(fixture.env);
    expect(startFrontend).toHaveBeenLastCalledWith(expect.objectContaining({
      scheduledTasks, env: fixture.env, onUnsafeBackend: scheduledTasks ? expect.any(Function) : undefined,
    }));
    expect(fixture.deps.assertCronBackend).toHaveBeenCalledTimes(Number(scheduledTasks));
    if (scheduledTasks) {
      expect(fixture.deps.assertCronBackend).toHaveBeenCalledWith({ target: 'http://127.0.0.1:1234',
        authorization: 'Bearer fictional-supervisor-token', fetchImpl: fixture.deps.fetch });
      expect(fixture.deps.assertCronBackend.mock.invocationCallOrder[0])
        .toBeLessThan(startFrontend.mock.invocationCallOrder.at(-1));
    }
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.child.kill).not.toHaveBeenCalled();
  });

  it('rejects unsafe environment before reading the registry or spawning', async () => {
    const fixture = startupFixture();
    fixture.env.KIMI_CODE_DISABLE_HOST_CHECK = '1';
    await expect(superviseWeb({ realKimi: '/fixture/official-kimi', web: { scheduledTasks: true },
      env: fixture.env, deps: fixture.deps,
    })).rejects.toThrow(/KIMI_CODE_DISABLE_HOST_CHECK/);
    expect(fixture.deps.spawn).not.toHaveBeenCalled();
  });
});

function mockedFrontend(close) {
  return { launcher: { accessUrls: [{ url: 'http://127.0.0.1:2345' }], close }, tokenResult: { token: null } };
}

const unsafeWarning = 'scheduled-task backend became unsafe; shutting down the managed backend';

describe('supervisor unsafe-backend stop', () => {
  it.each([false, true])('stops exactly once when unsafe occurs before frontend returns=%s', async (duringStartup) => {
    const fixture = startupFixture();
    const close = vi.fn(async () => {});
    const signalsBefore = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name));
    let notify;
    let stopSignal;
    let waiting;
    const ready = new Promise((resolve) => { waiting = resolve; });
    fixture.deps.waitStop = vi.fn((exited, signal) => {
      stopSignal = signal;
      const stopped = waitForStop(exited, signal);
      waiting();
      return stopped;
    });
    fixture.deps.openUrl = vi.fn(async () => true);
    startFrontend.mockImplementationOnce(async ({ onUnsafeBackend }) => {
      notify = onUnsafeBackend;
      if (duringStartup) { notify(); notify(); }
      return mockedFrontend(close);
    });
    const supervised = superviseWeb({ realKimi: '/fixture/official-kimi',
      web: { noOpen: false, scheduledTasks: true }, env: fixture.env, deps: fixture.deps });
    await ready;
    expect(notify).toBeTypeOf('function');
    expect(() => { notify(); notify(); }).not.toThrow();
    expect(stopSignal.aborted).toBe(true);
    expect(stopSignal.reason).toBe('unsafe-backend');
    await expect(supervised).resolves.toBe(1);
    const shutdowns = fixture.deps.fetch.mock.calls.filter(([url]) => String(url).endsWith('/shutdown'));
    expect(shutdowns).toHaveLength(1);
    expect(shutdowns[0]).toEqual(['http://127.0.0.1:1234/api/v1/shutdown', {
      method: 'POST', headers: { authorization: 'Bearer fictional-supervisor-token' }, signal: expect.any(AbortSignal),
    }]);
    expect(fixture.deps.fetch.mock.calls.some(([url]) => String(url).includes('/remote-control'))).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(fixture.deps.openUrl).toHaveBeenCalledTimes(Number(!duringStartup));
    expect(fixture.deps.warn).toHaveBeenCalledExactlyOnceWith(unsafeWarning);
    expect(fixture.child.kill).not.toHaveBeenCalled();
    expect(getEventListeners(stopSignal, 'abort')).toHaveLength(0);
    expect(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name))).toEqual(signalsBefore);
  });

  it('kills a Windows native process tree from its spawn pid after shutdown times out', async () => {
    vi.useFakeTimers();
    const fixture = startupFixture();
    fixture.child.pid = 424242;
    fixture.deps.platform = 'win32';
    fixture.deps.waitStop = undefined;
    let requestedShutdown;
    const requested = new Promise((resolve) => { requestedShutdown = resolve; });
    fixture.deps.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/shutdown')) requestedShutdown();
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    fixture.deps.killTree = vi.fn(async () => {
      fixture.child.exitCode = 1;
      fixture.child.emit('exit', 1, null);
      return { code: 0 };
    });
    const close = vi.fn(async () => {});
    startFrontend.mockImplementationOnce(async ({ onUnsafeBackend }) => {
      onUnsafeBackend();
      return mockedFrontend(close);
    });
    try {
      const supervised = superviseWeb({ realKimi: '/fixture/official-kimi.exe',
        web: { noOpen: true, scheduledTasks: true }, env: fixture.env, deps: fixture.deps });
      await requested;
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(supervised).resolves.toBe(1);
      expect(fixture.deps.killTree).toHaveBeenCalledExactlyOnceWith(424242);
      expect(fixture.child.kill).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('supervisor exact 2.3.1 read-only startup', () => {
  it('accepts the real authenticated read guard without changing startup ownership or enabling mutations', async () => {
    const fixture = startupFixture();
    delete fixture.deps.assertCronBackend;
    const shutdown = fixture.deps.fetch;
    const calls = [];
    fixture.deps.fetch = vi.fn(async (url, init) => {
      const pathname = new URL(url).pathname;
      calls.push({ pathname, method: init.method ?? 'GET' });
      if (pathname === '/api/v1/meta') return Response.json({ code: 0, data: {
        server_version: '2.3.1', backend: 'v2', dangerous_bypass_auth: false,
      } });
      if (pathname === '/api/v1/remote-control') return Response.json({ code: 0, data: { enabled: false, state: 'off' } });
      return shutdown(url, init);
    });
    const close = vi.fn(async () => {});
    startFrontend.mockResolvedValue(mockedFrontend(close));
    await expect(superviseWeb({ realKimi: '/fixture/official-kimi', web: { noOpen: true, scheduledTasks: true },
      env: fixture.env, deps: fixture.deps })).resolves.toBe(0);
    expect(calls.filter((call) => call.pathname === '/api/v1/remote-control')).toEqual([
      { pathname: '/api/v1/remote-control', method: 'GET' },
    ]);
    expect(calls.some((call) => /debug|restore|takeover/.test(call.pathname))).toBe(false);
    expect(startFrontend).toHaveBeenLastCalledWith(expect.objectContaining({ scheduledTasks: true }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('supervisor stop-listener cleanup', () => {
  it.each(['exit', 'error', 'SIGINT', 'SIGTERM', 'abort', 'already-aborted'])(
    'removes process and abort listeners after %s', async (kind) => {
      const before = ['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name));
      const controller = new AbortController();
      let resolveExit;
      let rejectExit;
      const exited = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
      if (kind === 'already-aborted') controller.abort('unsafe-backend');
      const stopped = waitForStop(exited, controller.signal);
      if (kind === 'exit') resolveExit({ code: 7 });
      else if (kind === 'error') rejectExit(new Error('fixture exit'));
      else if (kind.startsWith('SIG')) process.listeners(kind).at(-1)();
      else controller.abort('unsafe-backend');
      const result = await stopped;
      expect(result.kind).toBe(kind.startsWith('SIG') ? 'signal' : kind.includes('abort') ? 'unsafe-backend' : 'exit');
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
      expect(['SIGINT', 'SIGTERM'].map((name) => process.listenerCount(name))).toEqual(before);
      resolveExit({ code: 0 });
    },
  );
});
