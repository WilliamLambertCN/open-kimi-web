import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(new URL('../src/mobile/imagePreviewGuard.js', import.meta.url), 'utf8');
const origin = 'https://web.example';
const readUrl = `${origin}/api/v1/sessions/preview-1/fs:read`;
const maxBytes = 32 * 1024 * 1024;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN8sAAAAASUVORK5CYII=', 'base64');

function fileData(overrides = {}) {
  return {
    path: 'picture.png', content: png.subarray(0, 12).toString('base64'), encoding: 'base64',
    size: png.length, truncated: true, etag: 'original-etag', mime: 'image/png', is_binary: true,
    ...overrides,
  };
}

function envelope(data, overrides = {}, options = {}) {
  return new Response(JSON.stringify({ code: 0, msg: 'success', data, request_id: 'upstream-1', ...overrides }), {
    status: 200, headers: { 'content-type': 'application/json' }, ...options,
  });
}

function imageResponse(bytes = png, headers = {}) {
  return new Response(bytes, {
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.length), etag: 'download-etag', ...headers },
  });
}

function readInit(options = {}, init = {}) {
  return { method: 'POST', body: JSON.stringify({ path: 'picture.png', ...options }), ...init };
}

function install(nativeFetch) {
  const window = { fetch: nativeFetch };
  const context = {
    window, location: { origin, href: `${origin}/sessions/preview-1` },
    URL, Request, Headers, Response, Symbol, Uint8Array, btoa,
  };
  runInNewContext(source, context);
  return { window, context };
}

function streamedResponse(chunks, headers = {}) {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  return { response: new Response(body, { headers: { 'content-type': 'image/png', ...headers } }), cancel };
}

async function failedPreview(response, metadata = fileData(), options = {}) {
  const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(metadata)).mockResolvedValueOnce(response);
  const { window } = install(nativeFetch);
  const result = await (await window.fetch(readUrl, readInit(options))).json();
  expect(result.code).not.toBe(0);
  expect(result.data).toBeNull();
  expect(result.msg).toMatch(/^Image preview failed: /);
  expect(result.request_id).toBe('upstream-1');
  expect(nativeFetch).toHaveBeenCalledTimes(2);
  return result;
}

describe('official complete image preview', () => {
  it('loads before the official module and replaces a truncated 1 MiB file without changing its envelope', async () => {
    const html = addMobilePresentation('<head><script type="module" src="/assets/index.js"></script></head>');
    expect(html.indexOf('/__open-kimi-mobile/imagePreviewGuard.js')).toBeLessThan(html.indexOf('<script type="module"'));
    const bytes = Buffer.alloc(1024 * 1024 + 71, 123);
    png.copy(bytes);
    const file = fileData({ size: bytes.length, content: bytes.subarray(0, 1024 * 1024).toString('base64') });
    const original = envelope(file, { details: { marker: 'retained' } }, {
      headers: { 'content-type': 'application/json', 'content-length': '999', etag: 'old', 'x-response-id': 'retained' },
    });
    const nativeFetch = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(imageResponse(bytes));
    const { window } = install(nativeFetch);
    const result = await window.fetch(readUrl, readInit());
    const json = await result.json();
    expect(json).toEqual({
      code: 0, msg: 'success', request_id: 'upstream-1', details: { marker: 'retained' },
      data: { ...file, content: bytes.toString('base64'), truncated: false },
    });
    expect(original.bodyUsed).toBe(false);
    expect(result.headers.has('content-length')).toBe(false);
    expect(result.headers.has('etag')).toBe(false);
    expect(result.headers.get('x-response-id')).toBe('retained');
    expect(nativeFetch.mock.calls[0]).toEqual([readUrl, readInit()]);
    expect(nativeFetch.mock.calls[1][0]).toBe(`${origin}/api/v1/sessions/preview-1/fs/picture.png:download`);
  });

  it('reads a file larger than the official 10 MiB maximum in bounded chunks', async () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 19, 77);
    png.copy(bytes);
    const chunks = [bytes.subarray(0, 3), bytes.subarray(3, 40001), bytes.subarray(40001)];
    const { response } = streamedResponse(chunks, { 'content-length': String(bytes.length) });
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData({ size: bytes.length }))).mockResolvedValueOnce(response);
    const { window } = install(nativeFetch);
    const result = await (await window.fetch(readUrl, readInit({ offset: 0, encoding: 'auto' }))).json();
    expect(result.data.size).toBe(bytes.length);
    expect(result.data.truncated).toBe(false);
    expect(result.data.content).toBe(bytes.toString('base64'));
  });
});

describe('image preview request semantics', () => {
  it('inherits only authorization and x-kimi headers, credentials, signal and the fetch receiver', async () => {
    const controller = new AbortController();
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockResolvedValueOnce(imageResponse());
    const { window } = install(nativeFetch);
    const receiver = { receiver: true };
    const init = readInit({ path: 'figures/图 #?%:one.png' }, {
      headers: {
        authorization: 'Bearer test-token', 'x-kimi-client-id': 'test-client', 'x-kimi-client-name': 'web',
        'x-kimi-runtime': 'local', 'content-type': 'application/json', 'if-none-match': 'unrelated', 'x-other': 'excluded',
      },
      signal: controller.signal, credentials: 'include',
    });
    await window.fetch.call(receiver, readUrl, init);
    expect(nativeFetch.mock.calls[0]).toEqual([readUrl, init]);
    expect(nativeFetch.mock.contexts).toEqual([receiver, receiver]);
    const [url, options] = nativeFetch.mock.calls[1];
    expect(url).toBe(`${origin}/api/v1/sessions/preview-1/fs/figures/%E5%9B%BE%20%23%3F%25%3Aone.png:download`);
    expect(options.credentials).toBe('include');
    expect(options.signal).toBe(controller.signal);
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('error');
    expect(Object.fromEntries(options.headers)).toEqual({
      authorization: 'Bearer test-token', 'x-kimi-client-id': 'test-client',
      'x-kimi-client-name': 'web', 'x-kimi-runtime': 'local',
    });
  });

  it('honors Request body and init body, method, headers and credential replacement rather than merging headers', async () => {
    const nativeFetch = vi.fn(async (input) => input instanceof Request ? envelope(fileData()) : imageResponse());
    const { window } = install(nativeFetch);
    const request = new Request(readUrl, {
      method: 'PUT', body: JSON.stringify({ path: 'old.png', length: 4 }), credentials: 'include',
      headers: { authorization: 'Bearer old-token', 'x-kimi-client-name': 'old-client' },
    });
    const controller = new AbortController();
    const init = readInit({ path: 'replacement.png' }, {
      headers: { 'x-kimi-client-id': 'new-client' }, credentials: 'omit', signal: controller.signal,
    });
    await window.fetch(request, init);
    expect(nativeFetch.mock.calls[0]).toEqual([request, init]);
    const [url, options] = nativeFetch.mock.calls[1];
    expect(url).toBe(`${origin}/api/v1/sessions/preview-1/fs/replacement.png:download`);
    expect(Object.fromEntries(options.headers)).toEqual({ 'x-kimi-client-id': 'new-client' });
    expect(options.credentials).toBe('omit');
    expect(options.signal).toBe(controller.signal);
    expect(await request.text()).toBe(JSON.stringify({ path: 'old.png', length: 4 }));

    const unchanged = new Request(readUrl, { ...readInit(), headers: { authorization: 'Bearer request-token' } });
    await window.fetch(unchanged, { headers: {} });
    expect(nativeFetch.mock.calls[3][1].headers.has('authorization')).toBe(false);
    expect(await unchanged.text()).toBe(readInit().body);
  });

  it('uses Request-only options without consuming the body and installs only once', async () => {
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockResolvedValueOnce(imageResponse());
    const { window, context } = install(nativeFetch);
    const firstWrapper = window.fetch;
    runInNewContext(source, context);
    expect(window.fetch).toBe(firstWrapper);
    const request = new Request(readUrl, {
      ...readInit(), credentials: 'include', headers: { authorization: 'Bearer request-token' },
    });
    await window.fetch(request);
    expect(nativeFetch.mock.calls[1][1].credentials).toBe('include');
    expect(nativeFetch.mock.calls[1][1].signal).toBe(request.signal);
    expect(nativeFetch.mock.calls[1][1].headers.get('authorization')).toBe('Bearer request-token');
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe(readInit().body);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });
});

describe('image preview scope and upstream pass-through', () => {
  it.each([
    ['third-party URL', 'https://third.example/api/v1/sessions/preview-1/fs:read', readInit()],
    ['different action', `${origin}/api/v1/sessions/preview-1/fs:stat`, readInit()],
    ['unknown version', `${origin}/api/v2/sessions/preview-1/fs:read`, readInit()],
    ['query parameters', `${readUrl}?unknown=1`, readInit()],
    ['GET override', new Request(readUrl, readInit()), { method: 'GET' }],
    ['explicit length', readUrl, readInit({ length: 1048576 })],
    ['explicit null length', readUrl, readInit({ length: null })],
    ['nonzero offset', readUrl, readInit({ offset: 1 })],
    ['null offset', readUrl, readInit({ offset: null })],
    ['text encoding', readUrl, readInit({ encoding: 'utf-8' })],
    ['unknown encoding', readUrl, readInit({ encoding: 'binary' })],
    ['runtime override', readUrl, readInit({ runtime_id: 'remote' })],
    ['empty path', readUrl, readInit({ path: '' })],
    ['non-string path', readUrl, readInit({ path: 4 })],
    ['dot segment', readUrl, readInit({ path: 'dir/../picture.png' })],
    ['NUL path', readUrl, readInit({ path: 'picture\0.png' })],
    ['invalid JSON', readUrl, { method: 'POST', body: '{broken' }],
    ['array JSON', readUrl, { method: 'POST', body: '[]' }],
    ['null JSON', readUrl, { method: 'POST', body: 'null' }],
    ['non-string body', readUrl, { method: 'POST', body: new URLSearchParams({ path: 'picture.png' }) }],
    ['missing body', readUrl, { method: 'POST' }],
    ['range header', readUrl, readInit({}, { headers: { range: 'bytes=0-2' } })],
    ['if-range header', readUrl, readInit({}, { headers: { 'if-range': 'etag' } })],
  ])('leaves %s untouched', async (_label, input, init) => {
    const original = envelope(fileData());
    const nativeFetch = vi.fn(async () => original);
    const { window } = install(nativeFetch);
    const response = await window.fetch(input, init);
    expect(response).toBe(original);
    expect(response.bodyUsed).toBe(false);
    expect(nativeFetch).toHaveBeenCalledExactlyOnceWith(input, init);
  });

  it.each([
    ['complete image', fileData({ truncated: false }), {}],
    ['text', fileData({ encoding: 'utf-8', mime: 'text/plain' }), {}],
    ['base64 non-image', fileData({ mime: 'application/octet-stream' }), {}],
    ['non-base64 image', fileData({ encoding: 'utf-8' }), {}],
    ['invalid MIME', fileData({ mime: 'image/' }), {}],
    ['permission error', null, { code: 40301, msg: 'forbidden' }],
    ['not found', null, { code: 40401, msg: 'missing' }],
  ])('keeps the original response readable for %s', async (_label, file, overrides) => {
    const original = envelope(file, overrides);
    const nativeFetch = vi.fn(async () => original);
    const { window } = install(nativeFetch);
    const response = await window.fetch(readUrl, readInit());
    expect(response).toBe(original);
    expect(response.bodyUsed).toBe(false);
    expect((await response.json()).data).toEqual(file);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => new Response('not JSON'),
    () => new Response(null, { status: 204 }),
    () => envelope(fileData(), {}, { status: 503 }),
    () => envelope(null, { code: 41302 }, { status: 403 }),
  ])('preserves invalid, empty or HTTP error responses', async (makeResponse) => {
    const original = makeResponse();
    const nativeFetch = vi.fn(async () => original);
    const { window } = install(nativeFetch);
    expect(await window.fetch(readUrl, readInit())).toBe(original);
    expect(original.bodyUsed).toBe(false);
    await original.text();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('propagates the original fetch failure without retrying', async () => {
    const failure = new TypeError('upstream offline');
    const nativeFetch = vi.fn().mockRejectedValue(failure);
    const { window } = install(nativeFetch);
    await expect(window.fetch(readUrl, readInit())).rejects.toBe(failure);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
});

describe('FS_TOO_LARGE image recovery', () => {
  it.each([200, 413])('recovers the official 41302 envelope with HTTP %s', async (status) => {
    const nativeFetch = vi.fn()
      .mockResolvedValueOnce(envelope(null, { code: 41302, msg: 'too large', details: { marker: true } }, { status }))
      .mockResolvedValueOnce(imageResponse());
    const { window } = install(nativeFetch);
    const response = await window.fetch(readUrl, readInit({ path: 'PICTURE.PNG' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 0, msg: 'success', request_id: 'upstream-1', details: { marker: true },
      data: {
        path: 'PICTURE.PNG', encoding: 'base64', etag: 'download-etag', is_binary: true,
        content: png.toString('base64'), mime: 'image/png', size: png.length, truncated: false,
      },
    });
  });

  it('encodes downloaded SVG as base64 with the downloaded MIME and text classification', async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    const nativeFetch = vi.fn()
      .mockResolvedValueOnce(envelope(null, { code: 41302 }))
      .mockResolvedValueOnce(imageResponse(bytes, { 'content-type': 'image/svg+xml; charset=utf-8' }));
    const { window } = install(nativeFetch);
    const response = await window.fetch(readUrl, readInit({ path: 'picture.svg' }));
    expect((await response.json()).data).toMatchObject({
      mime: 'image/svg+xml', encoding: 'base64', is_binary: false, content: bytes.toString('base64'),
    });
  });

  it.each(['notes.txt', 'picture.png.txt', 'picture.webp', 'no-extension'])('does not guess images for %s', async (path) => {
    const original = envelope(null, { code: 41302, msg: 'too large' });
    const nativeFetch = vi.fn(async () => original);
    const { window } = install(nativeFetch);
    expect(await window.fetch(readUrl, readInit({ path }))).toBe(original);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('fails clearly rather than inventing success for a non-image download', async () => {
    const nativeFetch = vi.fn()
      .mockResolvedValueOnce(envelope(null, { code: 41302 }))
      .mockResolvedValueOnce(new Response('not an image', { headers: { 'content-type': 'text/plain' } }));
    const { window } = install(nativeFetch);
    const result = await (await window.fetch(readUrl, readInit())).json();
    expect(result.code).toBe(50001);
    expect(result.data).toBeNull();
    expect(result.msg).toContain('did not return an image');
  });
});

describe('image download failure boundaries', () => {
  it.each([401, 403, 404, 500, 206, 302])('does not display a partial image after HTTP %s', async (status) => {
    await failedPreview(new Response(png, { status, headers: { 'content-type': 'image/png' } }));
  });

  it.each(['text/plain', 'application/json', '', 'image/'])('rejects non-image MIME %s', async (mime) => {
    await failedPreview(new Response(png, { headers: { 'content-type': mime } }));
  });

  it('rejects a changed MIME and both same-origin and cross-origin redirects', async () => {
    await failedPreview(imageResponse(png, { 'content-type': 'image/jpeg' }));
    for (const url of [origin, 'https://third.example']) {
      const response = imageResponse();
      Object.defineProperties(response, { url: { value: `${url}/other.png` }, redirected: { value: true } });
      await failedPreview(response);
    }
    const crossOrigin = imageResponse();
    Object.defineProperty(crossOrigin, 'url', { value: 'https://third.example/picture.png' });
    await failedPreview(crossOrigin);
  });

  it.each([
    new TypeError('fetch failed'),
    Object.assign(new Error('private-path-must-not-be-shown'), { code: 'ECONNRESET' }),
    null,
  ])('turns network failures into safe readable errors without retrying', async (error) => {
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockRejectedValueOnce(error);
    const { window } = install(nativeFetch);
    const result = await (await window.fetch(readUrl, readInit())).json();
    expect(result.code).toBe(50001);
    expect(result.data).toBeNull();
    expect(result.msg).toContain('Could not download the complete image');
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(nativeFetch.mock.calls[1][1].redirect).toBe('error');
  });
});

describe('image download size and stream boundaries', () => {
  it.each([null, -1, 1.5, '68', maxBytes + 1])('rejects invalid or oversized original file size %s', async (size) => {
    const nativeFetch = vi.fn(async () => envelope(fileData({ size })));
    const { window } = install(nativeFetch);
    const result = await (await window.fetch(readUrl, readInit())).json();
    expect(result.code).not.toBe(0);
    expect(result.data).toBeNull();
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['bogus', '-1', '1.5', String(maxBytes + 1), '3'])('rejects invalid or mismatched length %s', async (length) => {
    const result = await failedPreview(imageResponse(png, { 'content-length': length }));
    expect(result.msg).toMatch(/length|32 MiB/);
  });

  it('bounds a download without content-length by the original file size', async () => {
    const { response } = streamedResponse([png.subarray(0, 5), png.subarray(5)]);
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockResolvedValueOnce(response);
    const { window } = install(nativeFetch);
    expect((await (await window.fetch(readUrl, readInit())).json()).data.content).toBe(png.toString('base64'));
  });

  it('rejects incomplete, overlong, empty and null bodies', async () => {
    await failedPreview(imageResponse(png.subarray(0, 12), { 'content-length': String(png.length) }));
    await failedPreview(imageResponse(Buffer.concat([png, png]), { 'content-length': String(png.length) }));
    await failedPreview(imageResponse(Buffer.alloc(0), { 'content-length': String(png.length) }));
    await failedPreview(new Response(null, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } }));
  });

  it('rejects missing download size for FS_TOO_LARGE recovery', async () => {
    const { response } = streamedResponse([png]);
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(null, { code: 41302 })).mockResolvedValueOnce(response);
    const { window } = install(nativeFetch);
    const result = await (await window.fetch(readUrl, readInit())).json();
    expect(result.data).toBeNull();
    expect(result.msg).toContain('missing its file length');
  });

  it('cancels a stream immediately when its byte count exceeds 32 MiB', async () => {
    const cancel = vi.fn();
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        reads++;
        controller.enqueue(Buffer.alloc(1024 * 1024));
      },
      cancel,
    });
    const response = new Response(body, { headers: { 'content-type': 'image/png', 'content-length': String(maxBytes) } });
    const result = await failedPreview(response, fileData({ size: maxBytes }));
    expect(result.code).toBe(41302);
    expect(result.msg).toContain('32 MiB');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(reads).toBeLessThanOrEqual(34);
  });

  it('reports a broken response stream as failure instead of returning the original truncated data', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken stream')); } }), {
      headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
    });
    await failedPreview(response);
  });
});

describe('image preview abort propagation', () => {
  it('propagates abort while the download fetch is pending', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockImplementationOnce(async (_url, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort(reason);
      throw reason;
    });
    const { window } = install(nativeFetch);
    await expect(window.fetch(readUrl, readInit({}, { signal: controller.signal }))).rejects.toBe(reason);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('cancels pending body reads and propagates a non-Error abort reason', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const body = new ReadableStream({ pull() { controller.abort('cancelled'); }, cancel }, { highWaterMark: 0 });
    const nativeFetch = vi.fn().mockResolvedValueOnce(envelope(fileData())).mockResolvedValueOnce(new Response(body, {
      headers: { 'content-type': 'image/png', 'content-length': String(png.length) },
    }));
    const { window } = install(nativeFetch);
    await expect(window.fetch(readUrl, readInit({}, { signal: controller.signal }))).rejects.toBe('cancelled');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
