import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cron/routes.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createCronRouteService: vi.fn(actual.createCronRouteService) };
});
vi.mock('../src/officialBundle.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ensureOfficialBundle: vi.fn(actual.ensureOfficialBundle) };
});
import { createCronRouteService } from '../src/cron/routes.mjs';
import { createLauncherWithRetry, PORT_RETRY_ATTEMPTS, startFrontend } from '../src/frontend.mjs';
import { ensureOfficialBundle } from '../src/officialBundle.mjs';

const baseOpts = (over = {}) => ({
  target: 'http://127.0.0.1:1',
  publicDir: 'public',
  host: '127.0.0.1',
  port: 5000,
  tls: null,
  interfaces: {},
  ...over,
});

const listenError = (code) => Object.assign(new Error(`listen ${code}`), { code });
const reachableTarget = () => new Response(null, { status: 204 });

describe('createLauncherWithRetry', () => {
  it('does not retry when the port was set explicitly', async () => {
    const create = vi.fn(() => {
      throw listenError('EACCES');
    });
    await expect(
      createLauncherWithRetry(baseOpts({ portExplicit: true }), create),
    ).rejects.toThrow('listen EACCES');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a wildcard port whose printed loopback address is already occupied', async () => {
    const create = vi.fn();
    const assertLocalPort = vi.fn(() => {
      throw listenError('EADDRINUSE');
    });
    await expect(createLauncherWithRetry(
      baseOpts({ host: '0.0.0.0', portExplicit: true }),
      create,
      assertLocalPort,
    )).rejects.toThrow('listen EADDRINUSE');
    expect(assertLocalPort).toHaveBeenCalledWith(expect.objectContaining({
      host: '0.0.0.0', port: 5000,
    }));
    expect(create).not.toHaveBeenCalled();
  });

  it('retries on the next port after EADDRINUSE and reuses the other options', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(listenError('EADDRINUSE'))
      .mockResolvedValueOnce('launcher');
    const opts = baseOpts({ port: 5000, target: 'http://127.0.0.1:58627' });
    const launcher = await createLauncherWithRetry(opts, create);
    expect(launcher).toBe('launcher');
    expect(create).toHaveBeenCalledTimes(2);
    const [first, second] = create.mock.calls.map(([o]) => o);
    expect(first.port).toBe(5000);
    expect(second.port).toBe(5001);
    expect(second.target).toBe('http://127.0.0.1:58627');
  });

  it('falls back to an ephemeral port after exhausting the retries and warns', async () => {
    const create = vi.fn((opts) => {
      if (opts.port === 0) {
        return Promise.resolve({ server: { address: () => ({ port: 5555 }) } });
      }
      throw listenError('EACCES');
    });
    const warn = vi.fn();
    const launcher = await createLauncherWithRetry(baseOpts({ port: 4173, warn }), create);
    expect(launcher.server.address().port).toBe(5555);
    expect(create).toHaveBeenCalledTimes(PORT_RETRY_ATTEMPTS + 1);
    expect(create.mock.calls.map(([o]) => o.port)).toEqual([4173, 4174, 4175, 4176, 4177, 4178, 4179, 4180, 4181, 4182, 0]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ports 4173-4182'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ephemeral port 5555'));
  });

  it('gives up with a platform-appropriate hint when even the ephemeral fallback fails', async () => {
    const create = vi.fn(() => {
      throw listenError('EACCES');
    });
    const error = await createLauncherWithRetry(baseOpts({ port: 5000 }), create)
      .then(() => { throw new Error('expected a listen failure'); }, (err) => err);
    expect(error.message).toMatch(/ports 5000-5009[\s\S]*--port/);
    if (process.platform === 'win32') {
      expect(error.message).toContain('netsh interface ipv4 show excludedportrange protocol=tcp');
    } else {
      expect(error.message).not.toContain('netsh');
      expect(error.message).toContain('occupied or restricted');
    }
    expect(create).toHaveBeenCalledTimes(PORT_RETRY_ATTEMPTS + 1);
    expect(create.mock.calls.map(([o]) => o.port)).toEqual([5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 0]);
  });

  it('rethrows unrelated listen errors without retrying', async () => {
    const create = vi.fn(() => {
      throw listenError('EINVAL');
    });
    await expect(createLauncherWithRetry(baseOpts(), create)).rejects.toThrow('listen EINVAL');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('createLauncherWithRetry port boundary', () => {
  it('does not try a numbered port beyond 65535', async () => {
    const create = vi.fn((opts) => {
      if (opts.port === 0) {
        return Promise.resolve({ server: { address: () => ({ port: 55000 }) } });
      }
      throw listenError('EADDRINUSE');
    });
    const launcher = await createLauncherWithRetry(baseOpts({ port: 65535 }), create);
    expect(launcher.server.address().port).toBe(55000);
    expect(create.mock.calls.map(([opts]) => opts.port)).toEqual([65535, 0]);
  });
});

describe('startFrontend target reachability', () => {
  const servers = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('fails before TLS, bundle resolution, and listening when the backend is unreachable', async () => {
    const targetFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const officialDownload = vi.fn();
    const log = vi.fn();

    await expect(startFrontend({
      target: 'http://127.0.0.1:58627',
      host: '127.0.0.1',
      port: 0,
      https: true,
      certFile: 'missing-server.crt',
      keyFile: 'missing-server.key',
      officialDownload,
      targetFetch,
      log,
      warn: () => {},
    })).rejects.toThrow(
      /backend is unreachable at http:\/\/127\.0\.0\.1:58627[\s\S]*real Kimi binary[\s\S]*kimi web --host[\s\S]*pnpm dev/,
    );

    expect(targetFetch).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:58627/api/v1/healthz'),
      { redirect: 'manual', signal: expect.any(AbortSignal) },
    );
    expect(officialDownload).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('treats an HTTP error response as a reachable backend', async () => {
    const targetFetch = vi.fn(async () => new Response(null, { status: 401 }));
    const { launcher } = await startFrontend({
      target: 'http://127.0.0.1:58627',
      publicDir: 'public',
      host: '127.0.0.1',
      port: 0,
      interfaces: {},
      noTokenLink: true,
      targetFetch,
      log: () => {},
      warn: () => {},
    });
    servers.push(launcher.server);

    expect(targetFetch).toHaveBeenCalledOnce();
    expect(launcher.server.listening).toBe(true);
  });
});

describe('startFrontend web directory resolution', () => {
  const servers = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('serves an explicit web directory without resolving the official bundle', async () => {
    const log = vi.fn();
    const { launcher, publicDir } = await startFrontend({
      target: 'http://127.0.0.1:58627',
      webDir: 'prepared-web',
      host: '127.0.0.1',
      port: 0,
      interfaces: {},
      noTokenLink: true,
      targetFetch: reachableTarget,
      log,
      warn: () => {},
    });
    servers.push(launcher.server);

    expect(publicDir).toBe('prepared-web');
    expect(log).toHaveBeenCalledWith('web UI: custom directory');
  });

  it('adds recovery guidance when every official bundle source fails', async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), 'frontend-official-error-'));
    const download = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    try {
      await expect(startFrontend({
        target: 'http://127.0.0.1:58627',
        webVersion: '9.9.9',
        officialCacheRoot: cacheRoot,
        officialDownload: download,
        host: '127.0.0.1',
        port: 0,
        interfaces: {},
        noTokenLink: true,
        targetFetch: reachableTarget,
        log: () => {},
        warn: () => {},
      })).rejects.toThrow(
        /official web UI 9\.9\.9 is unavailable[\s\S]*curl and tar[\s\S]*retry/,
      );
      expect(download).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(cacheRoot, { recursive: true, force: true });
    }
  });
});

describe('startFrontend official presentation version', () => {
  it.each([
    ['2.1.1', undefined, '2.1.1', true],
    ['2.2.0', undefined, '2.2.0', true],
    ['2.3.1', undefined, '2.3.1', false],
    [undefined, undefined, '2.3.1', false],
    ['2.3.1', '2.2.0', '2.2.0', true],
    ['2.1.1', '2.3.1', '2.3.1', false],
  ])('resolves backend %s with pin %s as bundle %s, legacy guard=%s', async (
    backendVersion, webVersion, expectedVersion, legacy,
  ) => {
    const webDir = mkdtempSync(join(tmpdir(), 'frontend-bundle-version-'));
    writeFileSync(join(webDir, 'index.html'), '<head><script type="module" src="/official.js"></script></head>');
    const paths = [];
    const backend = createServer((req, res) => {
      paths.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { server_version: backendVersion } }));
    });
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    ensureOfficialBundle.mockResolvedValueOnce({ dir: webDir, cached: true });
    let launcher;
    try {
      const result = await startFrontend({
        target: `http://127.0.0.1:${backend.address().port}`, host: '127.0.0.1', port: 0, interfaces: {},
        noTokenLink: true, targetFetch: reachableTarget, log: vi.fn(), warn: vi.fn(), webVersion,
      });
      launcher = result.launcher;
      expect(result.publicDir).toBe(webDir);
      expect(ensureOfficialBundle).toHaveBeenLastCalledWith(expect.objectContaining({ version: expectedVersion }));
      for (const path of ['/', '/sessions/demo']) {
        const response = await fetch(`${launcher.url}${path}`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html.includes('/__open-kimi-mobile/sideChatScroll.js')).toBe(legacy);
        expect(html).toContain('/__open-kimi-mobile/cron.js');
      }
      expect(paths).toEqual(webVersion ? [] : ['/api/v1/meta']);
    } finally {
      await launcher?.close();
      await new Promise((resolve) => backend.close(resolve));
      rmSync(webDir, { recursive: true, force: true });
    }
  });
});

describe('startFrontend managed TLS', () => {
  it('uses a managed certificate for the default HTTPS path', async () => {
    const managedHome = mkdtempSync(join(tmpdir(), 'frontend-managed-tls-'));
    const previousHome = process.env.OPEN_KIMI_WEB_HOME;
    process.env.OPEN_KIMI_WEB_HOME = managedHome;
    let launcher;
    try {
      const started = await startFrontend({
        target: 'http://127.0.0.1:58627',
        publicDir: 'public',
        host: '127.0.0.1',
        port: 0,
        https: true,
        interfaces: {},
        noTokenLink: true,
        targetFetch: reachableTarget,
        log: () => {},
        warn: () => {},
      });
      launcher = started.launcher;

      expect(started.tls).toMatchObject({ source: 'managed', created: true });
      expect(launcher.url).toMatch(/^https:\/\//);
    } finally {
      await launcher?.close();
      if (previousHome === undefined) delete process.env.OPEN_KIMI_WEB_HOME;
      else process.env.OPEN_KIMI_WEB_HOME = previousHome;
      rmSync(managedHome, { recursive: true, force: true });
    }
  });
});

describe('startFrontend port fallback', () => {
  const servers = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('listens on the next free port when the requested one is taken', async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    servers.push(blocker);
    const occupied = blocker.address().port;

    const log = vi.fn();
    const { launcher } = await startFrontend({
      target: 'http://127.0.0.1:1',
      publicDir: 'public',
      host: '127.0.0.1',
      port: occupied,
      interfaces: {},
      noTokenLink: true,
      targetFetch: reachableTarget,
      log,
      warn: () => {},
    });
    servers.push(launcher.server);
    expect(launcher.server.address().port).toBeGreaterThan(occupied);
    expect(log).toHaveBeenCalledWith('web UI: custom directory');
  });

  it('falls back to an ephemeral port when the whole retry range is taken', async () => {
    const listen = (server, port) => new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
    let held;
    for (;;) {
      const start = 20000 + Math.floor(Math.random() * 40000);
      held = [];
      for (let port = start; port < start + PORT_RETRY_ATTEMPTS; port += 1) {
        const server = createServer();
        try {
          await listen(server, port);
          held.push(server);
        } catch {
          break;
        }
      }
      if (held.length === PORT_RETRY_ATTEMPTS) break;
      await Promise.all(held.map((s) => new Promise((r) => s.close(r))));
      held = undefined;
    }
    servers.push(...held);
    const startPort = held[0].address().port;
    const warn = vi.fn();

    const { launcher } = await startFrontend({
      target: 'http://127.0.0.1:1',
      publicDir: 'public',
      host: '127.0.0.1',
      port: startPort,
      interfaces: {},
      noTokenLink: true,
      targetFetch: reachableTarget,
      log: () => {},
      warn,
    });
    servers.push(launcher.server);
    const boundPort = launcher.server.address().port;
    expect(boundPort < startPort || boundPort >= startPort + PORT_RETRY_ATTEMPTS).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`ephemeral port ${boundPort}`));
  });
});

describe('startFrontend wildcard access safety', () => {
  const servers = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('does not publish a Local URL owned by another loopback listener', async () => {
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    servers.push(blocker);
    const occupied = blocker.address().port;

    const { launcher } = await startFrontend({
      target: 'http://127.0.0.1:1',
      publicDir: 'public',
      host: '0.0.0.0',
      port: occupied,
      interfaces: {},
      noTokenLink: true,
      targetFetch: reachableTarget,
      log: () => {},
      warn: () => {},
    });
    servers.push(launcher.server);

    expect(launcher.server.address().port).not.toBe(occupied);
    expect(launcher.accessUrls[0].url).toBe(
      `http://127.0.0.1:${launcher.server.address().port}`,
    );
  });
});

describe('startFrontend scheduled-task capability boundary', () => {
  it.each([{ publicDir: 'custom' }, { webDir: 'custom' }])('rejects custom web before any network probe: %j', async (web) => {
    const targetFetch = vi.fn();
    await expect(startFrontend({ ...baseOpts(), ...web, scheduledTasks: true, targetFetch }))
      .rejects.toThrow(/requires the enhanced official web UI/);
    expect(targetFetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('passes controlled home and unsafe callback to the service only when enabled=%s', async (enabled) => {
    const home = mkdtempSync(join(tmpdir(), 'frontend-cron-home-'));
    const onUnsafeBackend = vi.fn();
    const usageFetch = vi.fn();
    ensureOfficialBundle.mockResolvedValueOnce({ dir: 'fixture-official', cached: true });
    createCronRouteService.mockClear();
    let launcher;
    try {
      ({ launcher } = await startFrontend({
        target: 'http://127.0.0.1:1', host: '127.0.0.1', port: 0, interfaces: {}, noTokenLink: true,
        webVersion: '2.1.1', targetFetch: reachableTarget, log: vi.fn(), warn: vi.fn(),
        scheduledTasks: enabled, usageHome: home, usageFetch, onUnsafeBackend,
      }));
      expect(createCronRouteService).toHaveBeenCalledExactlyOnceWith({
        target: 'http://127.0.0.1:1', enabled, fetchImpl: usageFetch,
        home: enabled ? home : null, onUnsafeBackend: enabled ? onUnsafeBackend : undefined,
      });
    } finally {
      await launcher?.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
