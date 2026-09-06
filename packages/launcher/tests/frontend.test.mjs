import { createServer } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createLauncherWithRetry, PORT_RETRY_ATTEMPTS, startFrontend } from '../src/frontend.mjs';

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

  it('gives up with a netsh hint when even the ephemeral fallback fails', async () => {
    const create = vi.fn(() => {
      throw listenError('EACCES');
    });
    await expect(createLauncherWithRetry(baseOpts({ port: 5000 }), create)).rejects.toThrow(
      /ports 5000-5009[\s\S]*netsh interface ipv4 show excludedportrange protocol=tcp[\s\S]*--port/,
    );
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
