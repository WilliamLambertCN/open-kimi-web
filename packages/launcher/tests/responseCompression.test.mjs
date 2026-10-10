import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import { acceptsGzip, prepareResponse, sendResponse } from '../src/responseCompression.mjs';

const BODY = Buffer.from('fictional transcript output\n'.repeat(4096));
const HEADERS = { 'content-type': 'application/json', 'content-length': BODY.length };

function request(headers = {}, method = 'GET') {
  return Object.assign(new EventEmitter(), { headers, method });
}

function response(write) {
  const chunks = [];
  const res = new Writable({ write: write ?? ((chunk, _encoding, done) => { chunks.push(chunk); done(); }) });
  res.writeHead = vi.fn((_status, headers) => { res.headers = headers; });
  return { res, chunks };
}

function plan(responseHeaders = {}, requestHeaders = {}, extra = {}) {
  return prepareResponse(request({ 'accept-encoding': 'gzip', ...requestHeaders }), {
    headers: { ...HEADERS, ...responseHeaders }, ...extra,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Accept-Encoding negotiation', () => {
  it.each([
    [undefined, false], ['', false], ['identity', false], ['br', false], ['gzip', true], ['GZIP', true],
    ['gzip;q=0', false], ['gzip;q=0.001', true], ['gzip;q=0.', false], ['gzip;q=1.', true],
    ['gzip;q=1.000', true], ['gzip;q=0.123', true], ['gzip;q=.5', false], ['gzip;q=1.001', false],
    ['gzip;q=0.1234', false], ['gzip;q=2', false], ['gzip;q=-1', false], ['gzip;q=NaN', false],
    ['gzip;q=1e0', false], ['gzip;other=1', false], ['gzip;q=1;q=0', false],
    ['gzip;Q = 0.5', true], ['gzip;q=0.5, identity;q=1', false], ['gzip, identity', true],
    ['*', true], ['*;q=0', false], ['*;q=0.2', true], ['gzip;q=0, *;q=1', false],
    ['gzip;q=0.7, *;q=0', true], ['gzip;q=0.7, identity;q=0.5', true],
    ['gzip;q=0.7, identity;q=0.8', false], ['gzip;q=0, gzip;q=1', false],
    ['gzip;q=1, gzip;q=0', false], ['gzip;q=invalid, gzip', false],
    ['*;q=1, *;q=0', false], ['gzip;q=0.5, gzip;q=0.8', true],
    ['invalid token, gzip', true], [['br', 'gzip'], true],
  ])('negotiates %j as gzip=%s', (header, expected) => {
    expect(acceptsGzip(header)).toBe(expected);
  });
});

describe('response header planning', () => {
  it('copies headers without mutating the input or request', () => {
    const headers = Object.freeze({ 'Content-Type': 'application/json', 'Content-Length': BODY.length, ETag: '"one"' });
    const req = { method: 'GET', headers: Object.freeze({ 'Accept-Encoding': 'gzip', Authorization: 'Bearer fixture' }) };
    const result = prepareResponse(req, { headers });
    expect(result.gzip).toBe(true);
    expect(result.headers).toEqual({
      'content-type': 'application/json', etag: 'W/"one"', vary: 'Accept-Encoding', 'content-encoding': 'gzip',
    });
    expect(headers.ETag).toBe('"one"');
    expect(req.headers.Authorization).toBe('Bearer fixture');
  });

  it.each([
    [undefined, 'Accept-Encoding'], ['Origin', 'Origin, Accept-Encoding'],
    ['Origin, origin, ACCEPT-encoding, Accept-Encoding', 'Origin, ACCEPT-encoding'],
    [['Origin', 'Accept-Encoding', 'origin'], 'Origin, Accept-Encoding'],
    ['*', '*'], ['Origin, *, Accept-Encoding', '*'], ['', 'Accept-Encoding'],
  ])('merges and deduplicates Vary %j', (vary, expected) => {
    expect(plan({ vary }).headers.vary).toBe(expected);
    expect(plan({ vary }, { 'accept-encoding': 'identity' }).headers.vary).toBe(expected);
  });

  it.each(['"version"', 'W/"version"', 'invalid', '', undefined])('handles ETag %j', (etag) => {
    const result = plan({ etag });
    const expected = etag === '"version"' ? 'W/"version"' : etag === 'W/"version"' ? etag : undefined;
    expect(result.headers.etag).toBe(expected);
  });

  it('removes length and body integrity metadata only when encoding changes', () => {
    const metadata = {
      'content-md5': 'fixture-md5', digest: 'sha-256=fixture',
      'content-digest': 'sha-256=:fixture:', 'repr-digest': 'sha-256=:fixture:',
    };
    const result = plan(metadata);
    for (const key of ['content-length', ...Object.keys(metadata)]) expect(result.headers).not.toHaveProperty(key);
    const identity = plan(metadata, { 'accept-encoding': 'gzip;q=0' });
    expect(identity.headers).toMatchObject({ ...HEADERS, ...metadata });
  });

  it.each(['gzip', 'br', 'identity', ''])('never double-encodes an existing Content-Encoding %j', (encoding) => {
    const result = plan({ 'content-encoding': encoding, etag: '"original"', digest: 'fixture' });
    expect(result.gzip).toBe(false);
    expect(result.headers).toMatchObject({
      'content-encoding': encoding, 'content-length': BODY.length, etag: '"original"', digest: 'fixture',
    });
    expect(result.headers.vary).toBeUndefined();
  });

});

describe('response transformation boundaries', () => {
  it.each(['no-transform', 'public, No-Transform', ['no-cache', 'no-transform']])(
    'honors request and response Cache-Control %j', (cacheControl) => {
      expect(plan({ 'cache-control': cacheControl }).gzip).toBe(false);
      expect(plan({}, { 'cache-control': cacheControl }).gzip).toBe(false);
    },
  );

  it('does not confuse an unrelated cache directive value with no-transform', () => {
    expect(plan({ 'cache-control': 'private="no-transform", max-age=0' }).gzip).toBe(true);
  });

  it.each([100, 101, 103, 199, 204])('does not transform bodyless status %s', (statusCode) => {
    const result = plan({ etag: '"original"', digest: 'fixture' }, {}, { statusCode });
    expect(result).toMatchObject({
      gzip: false, bodyAllowed: false, headers: { ...HEADERS, etag: '"original"', digest: 'fixture' },
    });
  });

  it('keeps HEAD identity metadata while varying a compressible representation', () => {
    expect(prepareResponse(request({ 'accept-encoding': 'gzip' }, 'HEAD'), { headers: HEADERS })).toEqual({
      gzip: false, bodyAllowed: false, headers: { ...HEADERS, vary: 'Accept-Encoding' },
    });
  });

  it.each([{ range: 'bytes=0-100' }, { 'cache-control': 'no-transform' }])(
    'varies a full identity 200 response for request %j', (headers) => {
      expect(plan({ etag: '"original"', digest: 'fixture' }, headers)).toMatchObject({
        gzip: false, headers: { ...HEADERS, etag: '"original"', digest: 'fixture', vary: 'Accept-Encoding' },
      });
    },
  );

  it('does not add Vary for partial or response-forbidden transformations', () => {
    expect(plan({}, {}, { statusCode: 206 }).headers.vary).toBeUndefined();
    expect(plan({ 'content-range': 'bytes 0-100/10000' }).headers.vary).toBeUndefined();
    expect(plan({ 'cache-control': 'no-transform' }).headers.vary).toBeUndefined();
    expect(plan({ 'content-type': 'text/event-stream' }).headers.vary).toBeUndefined();
  });

  it.each([
    'image/png', 'image/jpeg', 'image/webp', 'font/woff2', 'application/zip', 'application/octet-stream',
    'text/event-stream', 'TEXT/EVENT-STREAM; charset=utf-8', '', undefined,
  ])('does not transform %j', (type) => {
    expect(plan({ 'content-type': type }).gzip).toBe(false);
  });

  it.each([
    'text/html; charset=utf-8', 'text/css', 'text/javascript', 'text/plain', 'image/svg+xml',
    'application/javascript', 'application/x-javascript', 'application/ecmascript', 'application/xml',
    'application/wasm', 'application/manifest+json', 'application/problem+json', 'application/example+xml',
  ])('compresses %s', (type) => {
    expect(plan({ 'content-type': type }).gzip).toBe(true);
  });

  it.each([['0', false], ['1023', false], ['1024', true], [undefined, true], ['invalid', true]])(
    'uses known length %j without consuming the body', (length, expected) => {
      expect(plan({ 'content-length': length }).gzip).toBe(expected);
    },
  );

  it('uses an explicit body byte length over a stale header length', () => {
    expect(plan({}, {}, { length: 10 }).gzip).toBe(false);
    expect(prepareResponse({}, {}).gzip).toBe(false);
  });
});

describe('bodyless representation metadata', () => {
  it.each([
    ['application/json', String(BODY.length)], ['application/json', undefined],
    [undefined, String(BODY.length)], [undefined, undefined],
  ])('selects gzip 304 metadata for type %j and length %j', (type, length) => {
    const result = plan({ 'content-type': type, 'content-length': length, etag: '"one"', digest: 'fixture', vary: 'Origin' },
      {}, { statusCode: 304 });
    expect(result).toEqual({
      gzip: false, bodyAllowed: false,
      headers: { 'content-type': type, etag: 'W/"one"', vary: 'Origin, Accept-Encoding' },
    });
  });

  it.each([
    [{}, { 'accept-encoding': 'identity' }, 'Origin, Accept-Encoding'],
    [{}, { 'accept-encoding': 'gzip;q=0' }, 'Origin, Accept-Encoding'],
    [{ 'content-encoding': 'gzip' }, {}, 'Origin'], [{ 'cache-control': 'no-transform' }, {}, 'Origin'],
    [{ 'content-type': 'image/png' }, {}, 'Origin'], [{ 'content-length': '100' }, {}, 'Origin'],
    [{}, { range: 'bytes=0-100' }, 'Origin, Accept-Encoding'],
    [{}, { 'cache-control': 'no-transform' }, 'Origin, Accept-Encoding'],
  ])('preserves identity 304 metadata with response %j and request %j', (headers, requestHeaders, vary) => {
    const original = { ...HEADERS, etag: '"one"', digest: 'fixture', vary: 'Origin', ...headers };
    const result = plan(original, requestHeaders, { statusCode: 304 });
    expect(result).toEqual({ gzip: false, bodyAllowed: false, headers: { ...original, vary } });
  });

  it.each(['0', 0, '4096', undefined, 'invalid'])('normalizes 205 framing length %j', (length) => {
    const result = plan({ 'content-length': length, 'transfer-encoding': 'chunked', trailer: 'Digest' }, {},
      { statusCode: 205 });
    expect(result.gzip).toBe(false);
    expect(result.bodyAllowed).toBe(false);
    expect(result.headers['content-length']).toBe(length === '0' ? '0' : 0);
    expect(result.headers['transfer-encoding']).toBeUndefined();
    expect(result.headers.trailer).toBeUndefined();
  });
});

describe('stream ownership and backpressure', () => {
  it('encodes an owned readable with a complete, byte-identical decompressed body', async () => {
    const source = Readable.from([BODY.subarray(0, 1024), BODY.subarray(1024)]);
    const { res, chunks } = response();
    await sendResponse(request({ 'accept-encoding': 'gzip' }), res, { headers: HEADERS, body: source });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(Buffer.concat(chunks))).toEqual(BODY);
    expect(source.destroyed).toBe(true);
  });

  it.each([Buffer.from('small'), 'é'.repeat(600)])('sends buffer/string bytes without a collection step', async (body) => {
    const { res, chunks } = response();
    await sendResponse(request({ 'accept-encoding': 'gzip' }), res, { headers: { 'content-type': 'text/plain' }, body });
    const raw = Buffer.concat(chunks);
    expect(res.headers['content-encoding'] ? gunzipSync(raw).toString() : raw.toString()).toBe(body.toString());
  });

  it.each(['HEAD', '304', '205'])('does not start a reader factory for %s', async (kind) => {
    const body = vi.fn(() => Readable.from([BODY]));
    const { res, chunks } = response();
    const req = request({ 'accept-encoding': 'gzip' }, kind === 'HEAD' ? 'HEAD' : 'GET');
    await sendResponse(req, res, { headers: HEADERS, statusCode: kind === 'HEAD' ? 200 : Number(kind), body });
    expect(body).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(0);
    expect(res.headers['content-length']).toBe(kind === 'HEAD' ? BODY.length : kind === '205' ? 0 : undefined);
  });

  it('destroys an already-owned reader without reading on a bodyless response', async () => {
    const read = vi.fn();
    const source = new Readable({ read });
    const { res } = response();
    await sendResponse(request({}, 'HEAD'), res, { headers: HEADERS, body: source });
    expect(read).not.toHaveBeenCalled();
    expect(source.destroyed).toBe(true);
  });

  it('uses defaults for an empty identity response', async () => {
    const { res, chunks } = response();
    await sendResponse(request(), res);
    expect(res.writeHead).toHaveBeenCalledWith(200, {});
    expect(Buffer.concat(chunks)).toHaveLength(0);
  });

});

describe('response sending safety', () => {
  it('plans preset headers and explicitly removes invalid preset fields', async () => {
    const { res, chunks } = response();
    res.getHeaders = vi.fn(() => ({ ...HEADERS, vary: 'Origin', digest: 'fixture' }));
    res.removeHeader = vi.fn();
    await sendResponse(request({ 'accept-encoding': 'gzip' }), res, { body: BODY });
    expect(res.removeHeader.mock.calls).toEqual([['content-length'], ['digest']]);
    expect(res.headers.vary).toBe('Origin, Accept-Encoding');
    expect(gunzipSync(Buffer.concat(chunks)).equals(BODY)).toBe(true);
  });

  it('never writes a second status when headers were already sent', async () => {
    const req = request();
    const { res } = response();
    res.headersSent = true;
    const body = Readable.from([BODY]);
    await expect(sendResponse(req, res, { headers: HEADERS, body })).rejects.toThrow('headers already sent');
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.destroyed).toBe(true);
    expect(body.destroyed).toBe(true);
  });
});

describe('stream progress and lifecycle', () => {
  it('makes compressed chunks available before the source ends', async () => {
    const source = new Readable({ read() {} });
    const first = deferred();
    const { res } = response((_chunk, _encoding, done) => { first.resolve(); done(); });
    const sending = sendResponse(request({ 'accept-encoding': 'gzip' }), res, { headers: HEADERS, body: source });
    source.push(BODY.subarray(0, 8192));
    await first.promise;
    expect(source.readableEnded).toBe(false);
    expect(res.writableFinished).toBe(false);
    source.push(null);
    await sending;
  });

  it.each(['identity', 'gzip'])('keeps bounded source consumption with a blocked %s destination', async (encoding) => {
    let produced = 0;
    const source = new Readable({
      highWaterMark: 1024,
      read() {
        produced += 1;
        this.push(randomBytes(1024));
      },
    });
    const first = deferred();
    const { res } = response(() => first.resolve());
    const req = request({ 'accept-encoding': encoding });
    const sending = sendResponse(req, res, { headers: HEADERS, body: source }).catch((error) => error);
    await first.promise;
    await new Promise((resolve) => setImmediate(resolve));
    expect(produced).toBeLessThan(128);
    req.emit('aborted');
    expect((await sending).name).toBe('AbortError');
    expect(source.destroyed).toBe(true);
  });

  it.each(['source', 'destination', 'factory', 'invalid body'])('destroys the response on %s error', async (kind) => {
    const failure = new Error('fictional stream failure');
    const source = new Readable({ read() { this.destroy(failure); } });
    const { res } = response(kind === 'destination' ? ((_chunk, _encoding, done) => done(failure)) : undefined);
    let body = kind === 'destination' ? Readable.from([BODY]) : source;
    if (kind === 'factory') body = () => { throw failure; };
    if (kind === 'invalid body') body = {};
    await expect(sendResponse(request({ 'accept-encoding': 'gzip' }), res, { headers: HEADERS, body })).rejects.toThrow();
    expect(res.destroyed).toBe(true);
    expect(res.writeHead).toHaveBeenCalledTimes(1);
    if (body instanceof Readable) expect(body.destroyed).toBe(true);
  });

  it.each(['request abort', 'response close'])('destroys source and gzip after %s', async (kind) => {
    const source = new Readable({ read() {} });
    const { res } = response();
    const req = request({ 'accept-encoding': 'gzip' });
    const pipe = vi.spyOn(source, 'pipe');
    const sending = sendResponse(req, res, { headers: HEADERS, body: source }).catch((error) => error);
    const gzip = pipe.mock.calls[0][0];
    expect(gzip._level).toBe(1);
    if (kind === 'request abort') req.emit('aborted');
    else res.destroy();
    expect((await sending).name).toBe('AbortError');
    expect(source.destroyed).toBe(true);
    expect(gzip.destroyed).toBe(true);
    expect(req.listenerCount('aborted')).toBe(0);
    expect(res.listeners('close').some((listener) => listener.name === 'close')).toBe(false);
  });

});

describe('stream preflight and compressor failures', () => {
  it('propagates a gzip failure and destroys its owned source and response', async () => {
    const source = new Readable({ read() {} });
    const { res } = response();
    const pipe = vi.spyOn(source, 'pipe');
    const sending = sendResponse(request({ 'accept-encoding': 'gzip' }), res, { headers: HEADERS, body: source });
    const gzip = pipe.mock.calls[0][0];
    gzip.destroy(new Error('fictional gzip failure'));
    await expect(sending).rejects.toThrow('fictional gzip failure');
    expect(source.destroyed).toBe(true);
    expect(res.destroyed).toBe(true);
    expect(gzip.destroyed).toBe(true);
  });

  it.each(['request', 'response'])('rejects a closed %s before opening its body', async (kind) => {
    const req = request();
    const { res } = response();
    const body = Readable.from([BODY]);
    if (kind === 'request') req.aborted = true;
    else res.destroy();
    await expect(sendResponse(req, res, { headers: HEADERS, body })).rejects.toThrow('closed before sending');
    expect(body.destroyed).toBe(true);
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});
