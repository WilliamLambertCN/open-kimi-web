import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { buildProxyHeaders, filterHeaders, proxyRequest } from '../src/httpProxy.mjs';

const servers = [];

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

describe('filterHeaders', () => {
  it('strips hop-by-hop headers', () => {
    const out = filterHeaders({
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      te: 'trailers',
      trailer: 'x-expires',
      upgrade: 'websocket',
      'proxy-authorization': 'Basic abc',
      'proxy-authenticate': 'Basic',
      'content-type': 'application/json',
    });
    expect(out).toEqual({ 'content-type': 'application/json' });
  });

  it('strips headers named by the connection token list', () => {
    const out = filterHeaders({
      connection: 'x-acme, keep-alive',
      'x-acme': 'secret',
      'x-keep': 'yes',
    });
    expect(out).toEqual({ 'x-keep': 'yes' });
  });

  it('forwards authorization and accept headers untouched', () => {
    const out = filterHeaders({
      authorization: 'Bearer test-token',
      accept: 'application/json',
    });
    expect(out).toEqual({
      authorization: 'Bearer test-token',
      accept: 'application/json',
    });
  });

  it('removes host so the proxy can rewrite it for the target', () => {
    const out = filterHeaders({ host: '127.0.0.1:4173', 'content-length': '3' });
    expect(out).toEqual({ 'content-length': '3' });
  });
});

describe('buildProxyHeaders', () => {
  it.each([
    ['http://example.test:80', 'example.test', 'http://example.test'],
    ['https://example.test:443', 'example.test', 'https://example.test'],
    ['https://example.test:8443', 'example.test:8443', 'https://example.test:8443'],
  ])('normalizes target Host and Origin for %s', (rawTarget, host, origin) => {
    const target = new URL(rawTarget);
    expect(buildProxyHeaders({ host: 'client.lan', origin: 'http://client.lan' }, target)).toEqual({
      host,
      origin,
    });
  });

  it('does not invent Origin when it was absent', () => {
    expect(buildProxyHeaders({ accept: 'application/json' }, new URL('http://example.test'))).toEqual({
      accept: 'application/json',
      host: 'example.test',
    });
  });
});

describe('proxyRequest upstream failures', () => {
  it('returns 502 when an HTTPS upstream cannot be reached', async () => {
    const port = await closedPort();
    const url = await listen((req, res) => proxyRequest(req, res, `https://127.0.0.1:${port}`));

    const response = await fetch(`${url}/api/v1/healthz`);
    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe('Bad Gateway');
  });

  it('destroys a partial response instead of writing a second status', async () => {
    const port = await closedPort();
    const url = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
      proxyRequest(req, res, `https://127.0.0.1:${port}`);
    });

    await expect(fetch(`${url}/api/v1/stream`).then((response) => response.text()))
      .rejects.toThrow();
  });
});
