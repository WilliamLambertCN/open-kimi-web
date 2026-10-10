import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import { proxyRequest } from '../../packages/launcher/src/httpProxy.mjs';
import { createLauncher } from '../../packages/launcher/src/serve.mjs';

const HTML = Buffer.from([
  '<!doctype html><html><head><title>Compression fixture</title>',
  '<script type="module" src="/assets/app-HASH.js"></script></head><body>',
  '<p>fictional static content</p>\n'.repeat(8192),
  '</body></html>',
].join('\n'));
const JS = Buffer.from("globalThis.fixtureValue = 'fictional static content';\n".repeat(8192));
const JSON_BODY = Buffer.from(JSON.stringify({ code: 0, data: { output: 'fictional tool result\n'.repeat(65536) } }));
const REST_PATH = '/api/v1/sessions/compression-fixture/transcript?page_size=10&before_turn=2';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function withProxy(run, handler, timeoutMs) {
  const upstream = createServer(handler);
  const writeHeads = [];
  let target;
  const proxy = createServer((req, res) => {
    writeHeads.push(vi.spyOn(res, 'writeHead'));
    proxyRequest(req, res, target, timeoutMs);
  });
  try {
    target = await listen(upstream);
    await run({ url: await listen(proxy), writeHeads });
  } finally {
    for (const server of [proxy, upstream]) server.closeAllConnections();
    await Promise.all([proxy, upstream].map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

async function withLauncher(run, { handler = (_req, res) => res.writeHead(404).end(), officialPresentation = false } = {}) {
  const publicDir = mkdtempSync(join(tmpdir(), 'launcher-compression-it-'));
  const upstream = createServer(handler);
  let launcher;
  try {
    mkdirSync(join(publicDir, 'assets'));
    writeFileSync(join(publicDir, 'index.html'), HTML);
    writeFileSync(join(publicDir, 'assets', 'app-HASH.js'), JS);
    launcher = await createLauncher({
      target: await listen(upstream),
      publicDir,
      host: '127.0.0.1',
      port: 0,
      closeGraceMs: 25,
      officialPresentation,
    });
    await run(launcher);
  } finally {
    try {
      await launcher?.close();
    } finally {
      upstream.closeAllConnections();
      await new Promise((resolve) => upstream.close(resolve));
      rmSync(publicDir, { recursive: true, force: true });
    }
  }
}

function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { agent: false, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(2000, () => req.destroy(new Error('fixture request timed out')));
    req.on('error', reject);
    req.end();
  });
}

function openRawStream(url, encoding) {
  return new Promise((resolve, reject) => {
    const client = httpRequest(url, { agent: false, headers: { 'accept-encoding': encoding } }, (response) => {
      response.on('error', () => {});
      resolve({ client, response });
    });
    client.setTimeout(2000, () => client.destroy(new Error('fixture stream timed out')));
    client.on('error', reject);
    client.end();
  });
}

async function expectRepresentations(url, expected, cacheControl) {
  const identity = await rawRequest(url, { headers: { 'accept-encoding': 'identity' } });
  expect(identity.status).toBe(200);
  expect(identity.headers['content-encoding']).toBeUndefined();
  expect(identity.headers['content-length']).toBe(String(expected.length));
  expect(identity.headers['cache-control']).toBe(cacheControl);
  expect(identity.body).toEqual(expected);

  const gzip = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
  expect(gzip.status).toBe(200);
  expect(gzip.headers['content-encoding']).toBe('gzip');
  expect(gzip.headers['content-length']).toBeUndefined();
  expect(gzip.headers.vary).toContain('Accept-Encoding');
  expect(gzip.headers['cache-control']).toBe(cacheControl);
  expect(gzip.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
  expect(gzip.body.length).toBeLessThan(expected.length);
  expect(gunzipSync(gzip.body)).toEqual(expected);

  const head = await rawRequest(url, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
  expect(head.status).toBe(200);
  expect(head.headers['content-encoding']).toBeUndefined();
  expect(head.headers['content-length']).toBe(String(expected.length));
  expect(head.headers['cache-control']).toBe(cacheControl);
  expect(head.body).toHaveLength(0);
}

describe('createLauncher compression wiring', () => {
  it.each([
    ['/', HTML, 'no-cache'],
    ['/assets/app-HASH.js', JS, 'public, max-age=31536000, immutable'],
  ])('compresses large static %s without changing its bytes or HEAD length', async (path, body, cacheControl) => {
    await withLauncher(async ({ url }) => {
      await expectRepresentations(`${url}${path}`, body, cacheControl);
    });
  });

  it('compresses transformed HTML and injected JavaScript with matching identity and HEAD representations', async () => {
    await withLauncher(async ({ url }) => {
      const index = await rawRequest(`${url}/`, { headers: { 'accept-encoding': 'identity' } });
      const html = index.body.toString();
      expect(html).toContain('/__open-kimi-mobile/presentation.js');
      expect(html.indexOf('/__open-kimi-mobile/presentation.js')).toBeLessThan(html.indexOf('<script type="module"'));
      expect(html).toContain('<p>fictional static content</p>');
      await expectRepresentations(`${url}/`, index.body, 'no-cache');
      const source = readFileSync(new URL('../../packages/launcher/src/mobile/presentation.js', import.meta.url));
      await expectRepresentations(`${url}/__open-kimi-mobile/presentation.js`, source, 'no-cache');
    }, { officialPresentation: true });
  });

  it.each(['gzip', 'identity'])('preserves REST URL, page_size, bearer and JSON for %s', async (encoding) => {
    let seen;
    const handler = (req, res) => {
      seen = { url: req.url, method: req.method, authorization: req.headers.authorization };
      res.writeHead(207, {
        'content-type': 'application/json', 'content-length': JSON_BODY.length, 'x-upstream': 'fictional',
      });
      res.write(JSON_BODY.subarray(0, 8192));
      res.end(JSON_BODY.subarray(8192));
    };
    await withLauncher(async ({ url }) => {
      const response = await rawRequest(`${url}${REST_PATH}`, {
        headers: { 'accept-encoding': encoding, authorization: 'Bearer fictional-compression-test' },
      });
      expect(response.status).toBe(207);
      expect(response.headers['x-upstream']).toBe('fictional');
      expect(response.headers['content-encoding']).toBe(encoding === 'gzip' ? 'gzip' : undefined);
      expect(response.headers['content-length']).toBe(encoding === 'gzip' ? undefined : String(JSON_BODY.length));
      const decoded = encoding === 'gzip' ? gunzipSync(response.body) : response.body;
      expect(decoded).toEqual(JSON_BODY);
      expect(JSON.parse(decoded)).toEqual(JSON.parse(JSON_BODY));
      expect(seen).toEqual({ url: REST_PATH, method: 'GET', authorization: 'Bearer fictional-compression-test' });
    }, { handler });
  });

  it('passes an existing upstream gzip response through byte-for-byte', async () => {
    const encoded = gzipSync(JSON_BODY);
    const handler = (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json', 'content-encoding': 'gzip',
        'content-length': encoded.length, etag: '"upstream-fixture"',
      });
      res.end(encoded);
    };
    await withLauncher(async ({ url }) => {
      const response = await rawRequest(`${url}${REST_PATH}`, { headers: { 'accept-encoding': 'gzip' } });
      expect(response.status).toBe(200);
      expect(response.headers['content-encoding']).toBe('gzip');
      expect(response.headers['content-length']).toBe(String(encoded.length));
      expect(response.headers.etag).toBe('"upstream-fixture"');
      expect(response.body).toEqual(encoded);
      expect(gunzipSync(response.body)).toEqual(JSON_BODY);
    }, { handler });
  });
});

describe('createLauncher gzip conditional metadata', () => {
  it.each([true, false])('keeps gzip validators through a 304 with content-type=%s', async (includeType) => {
    const seen = [];
    const handler = (req, res) => {
      const validator = req.headers['if-none-match'];
      seen.push({ url: req.url, method: req.method, validator });
      const notModified = validator === 'W/"fixture"';
      const headers = {
        'content-length': JSON_BODY.length, etag: '"fixture"', vary: 'Origin',
        'content-md5': 'fictional', digest: 'sha-256=fictional',
        'content-digest': 'sha-256=:fictional:', 'repr-digest': 'sha-256=:fictional:',
      };
      if (!notModified || includeType) headers['content-type'] = 'application/json';
      res.writeHead(notModified ? 304 : 200, headers);
      res.end(notModified ? undefined : JSON_BODY);
    };
    await withLauncher(async ({ url }) => {
      const gzip = await rawRequest(`${url}${REST_PATH}`, { headers: { 'accept-encoding': 'gzip' } });
      expect(gzip.status).toBe(200);
      expect(gzip.headers['content-encoding']).toBe('gzip');
      expect(gzip.headers.etag).toBe('W/"fixture"');
      expect(gzip.headers.vary).toBe('Origin, Accept-Encoding');
      expect(gunzipSync(gzip.body)).toEqual(JSON_BODY);
      const conditional = await rawRequest(`${url}${REST_PATH}`, {
        headers: { 'accept-encoding': 'gzip', 'if-none-match': gzip.headers.etag },
      });
      expect(seen).toEqual([
        { url: REST_PATH, method: 'GET', validator: undefined },
        { url: REST_PATH, method: 'GET', validator: 'W/"fixture"' },
      ]);
      expect(conditional.status).toBe(304);
      expect(conditional.body).toHaveLength(0);
      expect(conditional.headers.etag).toBe(gzip.headers.etag);
      expect(conditional.headers.vary).toBe('Origin, Accept-Encoding');
      for (const name of ['content-length', 'content-md5', 'digest', 'content-digest', 'repr-digest']) {
        expect(conditional.headers[name]).toBeUndefined();
      }
    }, { handler });
  });
});

describe('createLauncher compressed stream lifecycle', () => {
  it.each(['gzip', 'identity'])('closes the open upstream when a real %s client disconnects', async (encoding) => {
    let producer;
    let upstreamSocket;
    let upstreamClosed = false;
    const handler = (req, res) => {
      producer = res;
      upstreamSocket = req.socket;
      res.once('close', () => { upstreamClosed = true; });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(JSON_BODY.subarray(0, 8192));
    };
    await withLauncher(async ({ url }) => {
      const { client, response } = await openRawStream(`${url}${REST_PATH}`, encoding);
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      try {
        await expect.poll(() => chunks.length).toBeGreaterThan(0);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe(encoding === 'gzip' ? 'gzip' : undefined);
        expect(response.complete).toBe(false);
        expect(producer.writableEnded).toBe(false);
        response.destroy();
        client.destroy();
        await expect.poll(() => upstreamClosed).toBe(true);
        expect(producer.destroyed).toBe(true);
        expect(upstreamSocket.destroyed).toBe(true);
      } finally {
        response.destroy();
        client.destroy();
        producer?.destroy();
      }
    }, { handler });
  });

  it.each(['gzip', 'identity'])('aborts partial %s after its first chunk without a second status', async (encoding) => {
    let partialResponse;
    let writeHead;
    const handler = (_req, res) => {
      partialResponse = res;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');
    };
    await withLauncher(async (launcher) => {
      launcher.server.prependListener('request', (req, res) => {
        if (req.url === '/api/v1/partial') writeHead = vi.spyOn(res, 'writeHead');
      });
      const response = await fetch(`${launcher.url}/api/v1/partial`, { headers: { 'accept-encoding': encoding } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-encoding')).toBe(encoding === 'gzip' ? 'gzip' : null);
      const reader = response.body.getReader();
      try {
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe('partial');
        expect(first.done).toBe(false);
        expect(partialResponse.writableEnded).toBe(false);
        partialResponse.destroy(new Error('fixture stream failure'));
        await expect(reader.read()).rejects.toThrow();
        expect(writeHead).toHaveBeenCalledTimes(1);
        expect(writeHead.mock.calls[0][0]).toBe(200);
      } finally {
        partialResponse?.destroy();
        reader.releaseLock();
      }
      expect((await rawRequest(`${launcher.url}/`)).status).toBe(200);
      expect(writeHead).toHaveBeenCalledTimes(1);
    }, { handler });
  });
});

describe('real proxy gzip idle timeout', () => {
  it('interrupts an open gzip response after its first chunk without a second HTTP status', async () => {
    const first = JSON_BODY.subarray(0, 8192);
    let producer;
    let upstreamSocket;
    let upstreamClosed = false;
    const handler = (req, res) => {
      producer = res;
      upstreamSocket = req.socket;
      res.once('close', () => { upstreamClosed = true; });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(first);
    };
    await withProxy(async ({ url, writeHeads }) => {
      const { client, response } = await openRawStream(`${url}${REST_PATH}`, 'gzip');
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      const failed = new Promise((resolve) => response.once('error', resolve));
      try {
        await expect.poll(() => {
          try {
            return gunzipSync(Buffer.concat(chunks), { finishFlush: constants.Z_SYNC_FLUSH });
          } catch {
            return null;
          }
        }).toEqual(first);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-encoding']).toBe('gzip');
        expect(response.headers['content-length']).toBeUndefined();
        expect(response.complete).toBe(false);
        expect(producer.writableEnded).toBe(false);
        expect((await failed).message).toMatch(/aborted|reset/i);
        expect(response.complete).toBe(false);
        expect(response.destroyed).toBe(true);
        await expect.poll(() => upstreamClosed).toBe(true);
        expect(producer.destroyed).toBe(true);
        expect(upstreamSocket.destroyed).toBe(true);
        expect(writeHeads).toHaveLength(1);
        expect(writeHeads[0]).toHaveBeenCalledTimes(1);
        expect(writeHeads[0].mock.calls[0][0]).toBe(200);
      } finally {
        response.destroy();
        client.destroy();
        producer?.destroy();
      }
    }, handler, 500);
  });
});
