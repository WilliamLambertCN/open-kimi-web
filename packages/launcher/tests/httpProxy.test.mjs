import { createServer, request } from 'node:http';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { buildProxyHeaders, filterHeaders, proxyRequest } from '../src/httpProxy.mjs';
import { createLauncher } from '../src/serve.mjs';

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

describe('proxyRequest body delivery', () => {
  it('passes upstream gzip bytes and representation headers through without decoding', async () => {
    const text = JSON.stringify({ items: ['Fictional transcript output. '.repeat(5000)] });
    const encoded = gzipSync(text);
    let encoding;
    const upstream = await listen((req, res) => {
      encoding = req.headers['accept-encoding'];
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': encoded.length,
        vary: 'Accept-Encoding',
        etag: '"fixture-gzip"',
      });
      res.end(encoded);
    });
    const proxy = await listen((req, res) => proxyRequest(req, res, upstream));
    const result = await new Promise((resolve, reject) => {
      const req = request(`${proxy}/api/v1/sessions/fixture/transcript?agent_id=main&page_size=10`, {
        headers: { 'accept-encoding': 'gzip' },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.once('error', reject);
        res.once('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.once('error', reject);
      req.end();
    });
    expect(encoding).toBe('gzip');
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(Number(result.headers['content-length'])).toBe(encoded.length);
    expect(result.headers.vary).toBe('Accept-Encoding');
    expect(result.headers.etag).toBe('"fixture-gzip"');
    expect(result.body).toEqual(encoded);
    expect(gunzipSync(result.body).toString()).toBe(text);
  });

  it('delivers the first upstream chunk before the remaining body is produced', async () => {
    let finish;
    const waiting = new Promise((resolve) => { finish = resolve; });
    const upstream = await listen(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"items":[');
      await waiting;
      res.end('"Fictional output"]}');
    });
    const proxy = await listen((req, res) => proxyRequest(req, res, upstream));
    const response = await fetch(`${proxy}/api/v1/sessions/fixture/transcript`);
    const reader = response.body.getReader();
    try {
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('{"items":[');
      expect(first.done).toBe(false);
      finish();
      const chunks = [first.value];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
      expect(Buffer.concat(chunks).toString()).toBe('{"items":["Fictional output"]}');
    } finally {
      finish();
      await reader.cancel();
      reader.releaseLock();
    }
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

  it('answers 504 and cleans up when the upstream stays idle past the timeout', async () => {
    // Wedged upstream: accepts the request but never responds.
    const upstream = await listen(() => {});
    const url = await listen((req, res) => proxyRequest(req, res, upstream, 50));

    const response = await fetch(`${url}/api/v1/healthz`);
    expect(response.status).toBe(504);
    await expect(response.text()).resolves.toBe('Gateway Timeout');
  });
});

describe('launcher debug route boundary', () => {
  it('answers non-GET/HEAD static requests with a plain-text 405', async () => {
    const launcher = await createLauncher({
      target: 'http://127.0.0.1:1',
      publicDir: '.',
      host: '127.0.0.1',
      port: 0,
      interfaces: {},
    });
    servers.push(launcher.server);

    const response = await fetch(launcher.url, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    await expect(response.text()).resolves.toBe('Method Not Allowed');
  });

  it('does not forward debug endpoints to an external target', async () => {
    let upstreamCalled = false;
    const target = await listen((_req, res) => {
      upstreamCalled = true;
      res.writeHead(200).end();
    });
    const launcher = await createLauncher({
      target,
      publicDir: '.',
      host: '127.0.0.1',
      port: 0,
      interfaces: {},
    });
    servers.push(launcher.server);

    const response = await fetch(`${launcher.url}/api/v1/debug/channels`);
    expect(response.status).toBe(404);
    expect(upstreamCalled).toBe(false);
  });
});
