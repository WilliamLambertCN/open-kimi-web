import { createReadStream } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { constants, gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendResponse } from '../../packages/launcher/src/responseCompression.mjs';

const BODY = Buffer.from(JSON.stringify({ output: 'fictional tool result\n'.repeat(65536) }));
const TYPES = { 'content-type': 'application/json' };
const HEADERS = { ...TYPES, 'content-length': BODY.length, etag: '"fixture"' };
const servers = [];

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { agent: false, ...options }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function endpoint(options = {}) {
  return listen((req, res) => { sendResponse(req, res, { headers: HEADERS, body: BODY, ...options }).catch(() => {}); });
}

function decoded(result) {
  return result.headers['content-encoding'] === 'gzip' ? gunzipSync(result.body) : result.body;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  })));
});

describe('raw HTTP encoding and caching metadata', () => {
  it.each([
    [undefined, false], ['identity', false], ['gzip', true], ['gzip;q=0', false], ['*', true],
    ['gzip;q=0, *;q=1', false], ['gzip;q=0.4, identity;q=1', false], ['gzip;q=1.001', false],
    ['gzip;q=.5', false], ['gzip;q=0.5', true], ['gzip;q=1, gzip;q=0', false],
  ])('returns unchanged decoded bytes for Accept-Encoding %j', async (encoding, gzip) => {
    const url = await endpoint();
    const headers = encoding === undefined ? {} : { 'accept-encoding': encoding };
    const result = await rawRequest(url, { headers });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-encoding']).toBe(gzip ? 'gzip' : undefined);
    expect(decoded(result).equals(BODY)).toBe(true);
    expect(result.headers.vary).toBe('Accept-Encoding');
    expect(result.headers['content-length']).toBe(gzip ? undefined : String(BODY.length));
    expect(result.headers.etag).toBe(gzip ? 'W/"fixture"' : '"fixture"');
    if (gzip) expect(result.body.length).toBeLessThan(BODY.length / 20);
  });

  it('removes encoded body digests and merges Vary without touching other response metadata', async () => {
    const headers = {
      ...HEADERS, vary: 'Origin, origin, ACCEPT-Encoding, Accept-Encoding',
      'content-md5': 'fictional', digest: 'sha-256=fictional', 'content-digest': 'sha-256=:fictional:',
      'repr-digest': 'sha-256=:fictional:', 'cache-control': 'private, no-cache', 'x-fixture': 'unchanged',
    };
    const result = await rawRequest(await endpoint({ headers }), { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers.vary).toBe('Origin, ACCEPT-Encoding');
    for (const name of ['content-length', 'content-md5', 'digest', 'content-digest', 'repr-digest']) {
      expect(result.headers[name]).toBeUndefined();
    }
    expect(result.headers['cache-control']).toBe(headers['cache-control']);
    expect(result.headers['x-fixture']).toBe('unchanged');
    expect(decoded(result).equals(BODY)).toBe(true);
  });

  it('keeps Vary star and an already-weak ETag', async () => {
    const url = await endpoint({ headers: { ...HEADERS, vary: 'Origin, *', etag: 'W/"fixture"' } });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers.vary).toBe('*');
    expect(result.headers.etag).toBe('W/"fixture"');
    expect(decoded(result).equals(BODY)).toBe(true);
  });

  it('does not double-encode an upstream gzip response', async () => {
    const body = gzipSync(BODY);
    const headers = { ...HEADERS, 'content-encoding': 'gzip', 'content-length': body.length, digest: 'fictional' };
    const result = await rawRequest(await endpoint({ headers, body }), { headers: { 'accept-encoding': 'gzip' } });
    expect(result.body).toEqual(body);
    expect(gunzipSync(result.body).equals(BODY)).toBe(true);
    expect(result.headers.digest).toBe('fictional');
    expect(result.headers.etag).toBe('"fixture"');
    expect(result.headers['content-length']).toBe(String(body.length));
  });
});

describe('raw HTTP transformation boundaries', () => {
  it.each([
    [{ 'cache-control': 'no-transform' }, {}, 'Accept-Encoding'],
    [{}, { 'cache-control': 'private, no-transform' }, undefined],
    [{ range: 'bytes=0-1023' }, {}, 'Accept-Encoding'],
    [{}, { 'content-range': `bytes 0-${BODY.length - 1}/${BODY.length}` }, undefined],
    [{}, { 'content-type': 'text/event-stream' }, undefined], [{}, { 'content-type': 'image/png' }, undefined],
    [{}, { 'content-type': 'application/octet-stream' }, undefined],
  ])('keeps identity for request %j and response %j', async (requestHeaders, responseHeaders, vary) => {
    const url = await endpoint({ headers: { ...HEADERS, ...responseHeaders } });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip', ...requestHeaders } });
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers.etag).toBe('"fixture"');
    expect(result.headers.vary).toBe(vary);
    expect(result.body.equals(BODY)).toBe(true);
  });

  it('keeps partial 206 responses byte-identical', async () => {
    const result = await rawRequest(await endpoint({ statusCode: 206 }), { headers: { 'accept-encoding': 'gzip' } });
    expect(result.statusCode).toBe(206);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers['content-length']).toBe(String(BODY.length));
    expect(result.body.equals(BODY)).toBe(true);
  });

  it.each([0, 1023, 1024])('uses the known %s byte threshold without sniffing content', async (length) => {
    const body = Buffer.alloc(length, 120);
    const url = await endpoint({ body, headers: { ...TYPES, 'content-length': length } });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe(length < 1024 ? undefined : 'gzip');
    expect(decoded(result)).toEqual(body);
  });

  it.each([204, 205])('sends no body or encoding for status %s and does not open a reader', async (statusCode) => {
    const body = vi.fn(() => Readable.from([BODY]));
    const result = await rawRequest(await endpoint({ statusCode, body, headers: TYPES }), {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(result.statusCode).toBe(statusCode);
    expect(result.body).toHaveLength(0);
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(body).not.toHaveBeenCalled();
  });

});

describe('raw HTTP HEAD and informational responses', () => {
  it('keeps 103 informational headers and body separate from the compressed final response', async () => {
    const information = [];
    const url = await listen((req, res) => {
      res.writeEarlyHints({ link: '</fixture.js>; rel=preload', 'x-fixture': 'early' });
      sendResponse(req, res, { headers: HEADERS, body: BODY }).catch(() => {});
    });
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(url, { headers: { 'accept-encoding': 'gzip' }, agent: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('information', (info) => information.push(info));
      req.on('error', reject);
      req.end();
    });
    expect(information).toHaveLength(1);
    expect(information[0].statusCode).toBe(103);
    expect(information[0].headers['content-encoding']).toBeUndefined();
    expect(information[0].headers['x-fixture']).toBe('early');
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(decoded(result).equals(BODY)).toBe(true);
  });

  it('keeps HEAD original length/ETag and never starts its file reader', async () => {
    const body = vi.fn(() => createReadStream(new URL('../../packages/launcher/src/responseCompression.mjs', import.meta.url)));
    const result = await rawRequest(await endpoint({ body }), { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
    expect(result.body).toHaveLength(0);
    expect(result.headers['content-length']).toBe(String(BODY.length));
    expect(result.headers['content-encoding']).toBeUndefined();
    expect(result.headers.etag).toBe('"fixture"');
    expect(result.headers.vary).toBe('Accept-Encoding');
    expect(body).not.toHaveBeenCalled();
  });
});

describe('raw HTTP readable, file, and proxy streaming', () => {
  it('streams a file reader and leaves its bytes unchanged after gzip decompression', async () => {
    const file = new URL('../../packages/launcher/src/responseCompression.mjs', import.meta.url);
    const chunks = [];
    for await (const chunk of createReadStream(file)) chunks.push(chunk);
    const expected = Buffer.concat(chunks);
    const url = await endpoint({ headers: { 'content-type': 'text/javascript' }, body: () => createReadStream(file) });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(decoded(result)).toEqual(expected);
  });

  it('streams an unknown-length upstream response without changing path, auth, or JSON', async () => {
    let seen;
    let source;
    const upstream = await listen((req, res) => {
      seen = { path: req.url, authorization: req.headers.authorization };
      res.writeHead(200, TYPES);
      res.write(BODY.subarray(0, 8192));
      res.end(BODY.subarray(8192));
    });
    const proxy = await listen((req, res) => {
      const target = httpRequest(upstream + req.url, { headers: { authorization: req.headers.authorization } }, (upRes) => {
        source = upRes;
        sendResponse(req, res, { statusCode: upRes.statusCode, headers: upRes.headers, body: upRes }).catch(() => {});
      });
      target.on('error', () => res.destroy());
      target.end();
    });
    const result = await rawRequest(`${proxy}/api/v1/transcript?page_size=10&before_turn=2`, {
      headers: { 'accept-encoding': 'gzip', authorization: 'Bearer fictional-test' },
    });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(decoded(result).equals(BODY)).toBe(true);
    expect(JSON.parse(decoded(result))).toEqual(JSON.parse(BODY));
    expect(seen).toEqual({
      path: '/api/v1/transcript?page_size=10&before_turn=2', authorization: 'Bearer fictional-test',
    });
    expect(source.destroyed).toBe(true);
  });

  it('makes a decoded first chunk visible while a large stream is still open', async () => {
    const first = Buffer.from('first fictional chunk\n'.repeat(4096));
    const source = new Readable({ read() {} });
    const completed = deferred();
    const url = await listen((req, res) => {
      sendResponse(req, res, { headers: TYPES, body: source }).then(completed.resolve, completed.resolve);
      source.push(first);
    });
    const parts = [];
    let incoming;
    const received = deferred();
    const ended = deferred();
    const client = httpRequest(url, { headers: { 'accept-encoding': 'gzip' }, agent: false }, (res) => {
      incoming = res;
      res.on('data', (chunk) => {
        parts.push(chunk);
        const partial = gunzipSync(Buffer.concat(parts), { finishFlush: constants.Z_SYNC_FLUSH });
        if (partial.length >= first.length) received.resolve();
      });
      res.on('end', ended.resolve);
    });
    client.end();
    await received.promise;
    const partial = gunzipSync(Buffer.concat(parts), { finishFlush: constants.Z_SYNC_FLUSH });
    expect(partial).toEqual(first);
    expect(incoming.complete).toBe(false);
    expect(source.readableEnded).toBe(false);
    source.push(BODY);
    source.push(null);
    await ended.promise;
    await completed.promise;
    expect(gunzipSync(Buffer.concat(parts)).equals(Buffer.concat([first, BODY]))).toBe(true);
  });
});

describe('raw HTTP cancellation and partial errors', () => {
  it('destroys both owned source and gzip after a client disconnect', async () => {
    const source = new Readable({ read() {} });
    const completed = deferred();
    const pipe = vi.spyOn(source, 'pipe');
    const url = await listen((req, res) => {
      sendResponse(req, res, { headers: TYPES, body: source }).then(completed.resolve, completed.resolve);
      source.push(BODY.subarray(0, 8192));
    });
    const client = httpRequest(url, { headers: { 'accept-encoding': 'gzip' }, agent: false }, (res) => {
      res.on('error', () => {});
      res.once('data', () => { res.destroy(); client.destroy(); });
    });
    client.on('error', () => {});
    client.end();
    const error = await completed.promise;
    expect(error.name).toBe('AbortError');
    expect(source.destroyed).toBe(true);
    expect(pipe.mock.calls[0][0].destroyed).toBe(true);
  });

  it('destroys a failed partial response without writing a second HTTP status', async () => {
    const source = new Readable({ read() {} });
    const completed = deferred();
    let writeHead;
    let gzip;
    const pipe = vi.spyOn(source, 'pipe');
    const url = await listen((req, res) => {
      writeHead = vi.spyOn(res, 'writeHead');
      sendResponse(req, res, { headers: TYPES, body: source }).then(completed.resolve, completed.resolve);
      gzip = pipe.mock.calls[0][0];
      source.push(BODY.subarray(0, 8192));
    });
    let statusCode;
    const finished = new Promise((resolve, reject) => {
      const client = httpRequest(url, { headers: { 'accept-encoding': 'gzip' }, agent: false }, (res) => {
        statusCode = res.statusCode;
        res.on('error', resolve);
        res.once('data', () => source.destroy(new Error('fictional source failure')));
      });
      client.on('error', reject);
      client.end();
    });
    expect((await finished).message).toMatch(/aborted|reset/i);
    expect((await completed.promise).message).toBe('fictional source failure');
    expect(statusCode).toBe(200);
    expect(writeHead).toHaveBeenCalledTimes(1);
    expect(source.destroyed).toBe(true);
    expect(gzip.destroyed).toBe(true);
  });
});

describe('raw HTTP 304 variant metadata', () => {
  it.each([
    ['application/json', String(BODY.length)], ['application/json', undefined],
    [undefined, String(BODY.length)], [undefined, undefined],
  ])('normalizes the gzip variant with type %j and length %j', async (type, length) => {
    const body = vi.fn(() => Readable.from([BODY]));
    const headers = { etag: '"fixture"', vary: 'Origin', digest: 'fixture', 'content-md5': 'fixture' };
    if (type !== undefined) headers['content-type'] = type;
    if (length !== undefined) headers['content-length'] = length;
    const result = await rawRequest(await endpoint({ statusCode: 304, headers, body }), {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(result.statusCode).toBe(304);
    expect(result.body).toHaveLength(0);
    expect(result.headers.etag).toBe('W/"fixture"');
    expect(result.headers.vary).toBe('Origin, Accept-Encoding');
    for (const name of ['content-length', 'content-encoding', 'digest', 'content-md5']) {
      expect(result.headers[name]).toBeUndefined();
    }
    expect(body).not.toHaveBeenCalled();
  });

  it.each([
    [{ 'accept-encoding': 'identity' }, {}, 'Origin, Accept-Encoding'],
    [{ 'accept-encoding': 'gzip;q=0' }, {}, 'Origin, Accept-Encoding'],
    [{ 'accept-encoding': 'gzip' }, { 'content-encoding': 'gzip' }, 'Origin'],
    [{ 'accept-encoding': 'gzip' }, { 'cache-control': 'no-transform' }, 'Origin'],
    [{ 'accept-encoding': 'gzip', 'cache-control': 'no-transform' }, {}, 'Origin, Accept-Encoding'],
    [{ 'accept-encoding': 'gzip' }, { 'content-type': 'image/png' }, 'Origin'],
  ])('preserves identity metadata for request %j and response %j', async (requestHeaders, responseHeaders, vary) => {
    const headers = { ...HEADERS, vary: 'Origin', digest: 'fictional', ...responseHeaders };
    const result = await rawRequest(await endpoint({ statusCode: 304, headers }), { headers: requestHeaders });
    expect(result.body).toHaveLength(0);
    expect(result.headers.etag).toBe('"fixture"');
    expect(result.headers.vary).toBe(vary);
    expect(result.headers['content-length']).toBe(String(BODY.length));
    expect(result.headers.digest).toBe('fictional');
    expect(result.headers['content-encoding']).toBe(responseHeaders['content-encoding']);
  });
});

describe('raw HTTP identity conditional revalidation', () => {
  it('retains Accept-Encoding in Vary across identity GET and its conditional 304', async () => {
    const url = await listen((req, res) => {
      const statusCode = req.headers['if-none-match'] === HEADERS.etag ? 304 : 200;
      sendResponse(req, res, { statusCode, headers: { ...HEADERS, vary: 'Origin' }, body: BODY }).catch(() => {});
    });
    const first = await rawRequest(url, { headers: { 'accept-encoding': 'identity' } });
    expect(first.statusCode).toBe(200);
    expect(first.body.equals(BODY)).toBe(true);
    expect(first.headers.vary).toBe('Origin, Accept-Encoding');
    const conditional = await rawRequest(url, {
      headers: { 'accept-encoding': 'identity', 'if-none-match': first.headers.etag },
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.body).toHaveLength(0);
    expect(conditional.headers.vary).toBe(first.headers.vary);
    expect(conditional.headers.etag).toBe(first.headers.etag);
    expect(conditional.headers['content-length']).toBe(first.headers['content-length']);
    expect(conditional.headers['content-encoding']).toBeUndefined();
  });
});

describe('raw HTTP preset ServerResponse headers', () => {
  it('plans merged headers and deletes stale identity framing and digests on the wire', async () => {
    const body = Buffer.alloc(69632, 120);
    const url = await listen((req, res) => {
      const preset = {
        'content-type': 'application/json', 'content-length': body.length, vary: 'Origin', etag: '"preset"',
        digest: 'fixture', 'content-md5': 'fixture', 'content-digest': 'fixture', 'repr-digest': 'fixture',
      };
      for (const [name, value] of Object.entries(preset)) res.setHeader(name, value);
      sendResponse(req, res, { body }).catch(() => {});
    });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.headers.vary).toBe('Origin, Accept-Encoding');
    expect(result.headers.etag).toBe('W/"preset"');
    expect(decoded(result).equals(body)).toBe(true);
    for (const name of ['content-length', 'digest', 'content-md5', 'content-digest', 'repr-digest']) {
      expect(result.headers[name]).toBeUndefined();
    }
  });

  it.each([
    [{ 'cache-control': 'no-transform' }, undefined], [{ 'content-encoding': 'identity' }, 'identity'],
  ])('honors a preset response transform prohibition %j', async (preset, encoding) => {
    const url = await listen((req, res) => {
      for (const [name, value] of Object.entries({ ...HEADERS, vary: 'Origin', ...preset })) res.setHeader(name, value);
      sendResponse(req, res, { body: BODY }).catch(() => {});
    });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe(encoding);
    expect(result.headers['content-length']).toBe(String(BODY.length));
    expect(result.headers.vary).toBe('Origin');
    expect(result.headers.etag).toBe('"fixture"');
    expect(result.body.equals(BODY)).toBe(true);
  });

  it('preserves an already-encoded preset gzip body byte-for-byte', async () => {
    const body = gzipSync(BODY);
    const url = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-length', body.length);
      res.setHeader('vary', 'Origin');
      sendResponse(req, res, { body }).catch(() => {});
    });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.body.equals(body)).toBe(true);
    expect(result.headers['content-length']).toBe(String(body.length));
    expect(result.headers.vary).toBe('Origin');
    expect(decoded(result).equals(BODY)).toBe(true);
  });

  it('lets explicit headers override preset metadata case-insensitively', async () => {
    const url = await listen((req, res) => {
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('cache-control', 'no-transform');
      res.setHeader('content-length', BODY.length);
      res.setHeader('vary', 'Origin');
      sendResponse(req, res, { body: BODY, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } })
        .catch(() => {});
    });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.headers['content-encoding']).toBe('gzip');
    expect(result.headers['cache-control']).toBe('no-cache');
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers.vary).toBe('Origin, Accept-Encoding');
    expect(decoded(result).equals(BODY)).toBe(true);
  });
});

describe('raw HTTP 205 framing normalization', () => {
  it.each(['0', '4096', undefined])('terminates a bodyless 205 with original length %j', async (length) => {
    const body = vi.fn(() => Readable.from([BODY]));
    const url = await listen((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (length !== '0') {
        res.setHeader('transfer-encoding', 'chunked');
        res.setHeader('trailer', 'Digest');
      }
      if (length !== undefined) res.setHeader('content-length', length);
      sendResponse(req, res, { statusCode: 205, body }).catch(() => {});
    });
    const result = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
    expect(result.statusCode).toBe(205);
    expect(result.headers['content-length']).toBe('0');
    expect(result.headers['transfer-encoding']).toBeUndefined();
    expect(result.headers.trailer).toBeUndefined();
    expect(result.body).toHaveLength(0);
    expect(body).not.toHaveBeenCalled();
  });
});
