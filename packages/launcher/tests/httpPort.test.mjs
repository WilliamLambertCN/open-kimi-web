import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { availableHttpPort, listenHttp } from '../../../tests/testkit/httpPort.mjs';

function fakeServer(errors) {
  const server = new EventEmitter();
  server.listen = vi.fn(({ port }) => {
    const code = errors.shift();
    server.port = port;
    queueMicrotask(() => code ? server.emit('error', Object.assign(new Error(code), { code })) : server.emit('listening'));
  });
  server.address = () => ({ port: server.port });
  return server;
}

function expectReleasedListeners(server) {
  expect(server.listenerCount('listening')).toBe(0);
  expect(server.listenerCount('error')).toBe(0);
}

describe('HTTP fixture port selection', () => {
  it('uses the dynamic/private range and retries busy or reserved ports without retaining event listeners', async () => {
    const server = fakeServer(['EADDRINUSE', 'EACCES']);
    expect(await listenHttp(server)).toBe(server.port);
    expect(server.listen).toHaveBeenCalledTimes(3);
    for (const [options] of server.listen.mock.calls) {
      expect(options).toMatchObject({ host: '127.0.0.1', exclusive: true });
      expect(options.port).toBeGreaterThanOrEqual(49_152);
      expect(options.port).toBeLessThanOrEqual(65_535);
    }
    expectReleasedListeners(server);
  });

  it('rejects unrelated errors immediately and bounds failed bind attempts', async () => {
    const denied = fakeServer(['EADDRNOTAVAIL']);
    await expect(listenHttp(denied)).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
    expect(denied.listen).toHaveBeenCalledOnce();
    expectReleasedListeners(denied);
    const occupied = fakeServer(Array(32).fill('EADDRINUSE'));
    await expect(listenHttp(occupied)).rejects.toThrow('No available HTTP fixture port');
    expect(occupied.listen).toHaveBeenCalledTimes(32);
    expectReleasedListeners(occupied);
  });

  it('keeps parallel live fixtures reachable with real Fetch and releases availability probes', async () => {
    const servers = Array.from({ length: 4 }, () => createServer((_, response) => response.end('fictional HTTP fixture')));
    try {
      const ports = await Promise.all(servers.map((server) => listenHttp(server)));
      expect(new Set(ports).size).toBe(4);
      expect(await Promise.all(ports.map(async (port) => (await fetch(`http://127.0.0.1:${port}`)).text())))
        .toEqual(Array(4).fill('fictional HTTP fixture'));
      const port = await availableHttpPort();
      await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
      });
    } finally {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    }
  });
});
