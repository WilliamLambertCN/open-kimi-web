import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCronRouteService, serveCron, CRON_PREFIX, CRON_BODY_TIMEOUT_MS } from '../src/cron/routes.mjs';

const authorization = 'Bearer fictional-route-token';
const meta = { server_version: '2.2.0', backend: 'v2', dangerous_bypass_auth: false };
const tasksPath = CRON_PREFIX + '/sessions/fixture-session/tasks';
const task = { id: 'deadbeef', createdAt: 1792368000000, cron: '7 9 * * *', prompt: 'Fictional reminder', recurring: true };

function fixture(enabled = true, overrides = {}, options = {}) {
  const values = { meta, 'remote-control': { enabled: false, state: 'off' }, list: [task], now: task.createdAt,
    isDisabled: false, addTask: task, removeTasks: [task.id], ...overrides };
  const fetchImpl = vi.fn(async (url) => Response.json({ code: 0, data: values[url.pathname.split('/').at(-1)] }));
  return { fetchImpl, service: createCronRouteService({ target: 'http://127.0.0.1:12345', enabled, fetchImpl, ...options }) };
}

function request(path = CRON_PREFIX, { method = 'GET', body, headers = {}, stream } = {}) {
  const req = stream ?? Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.url = path;
  req.method = method;
  req.headers = { authorization, host: '127.0.0.1:45678', ...headers };
  return req;
}

function response() {
  return { status: null, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); this.writableEnded = true; } };
}

async function call(service, path, options) {
  const res = response();
  const handled = await serveCron(request(path, options), res, service);
  return { res, handled };
}

afterEach(() => vi.useRealTimers());

const inventoryPath = CRON_PREFIX + '/sessions';
const historyPath = inventoryPath + '/fixture-session/history';

describe('read-only Cron inventory route boundaries', () => {
  it.each([inventoryPath, historyPath])('requires a controlled home without silently returning an empty DTO %s', async (path) => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, path);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('inventory-unavailable');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
  });

  it.each([inventoryPath, historyPath])('does not access inventory when disabled or unauthorized %s', async (path) => {
    const { service, fetchImpl } = fixture(false, {}, { home: 'fictional-unread-home' });
    expect((await call(service, path, { headers: { authorization: undefined } })).res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await call(service, path)).res.body.error.code).toBe('not-enabled');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
  });

  it.each(['?cursor=a&cursor=b', '?other=a', '?cursor=', '?cursor=%zz', '?cursor=a&other=b',
    '?cursor=' + 'x'.repeat(4097), '?cursor=%00'])('rejects malformed inventory query %#', async (query) => {
    const { service, fetchImpl } = fixture();
    expect((await call(service, inventoryPath + query)).res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards the sole opaque cursor after guard and returns the inventory DTO unchanged', async () => {
    const directory = { items: [], has_more: false, next_page_token: null };
    const { service, fetchImpl } = fixture(true, { sessions: directory, list: [] }, { home: 'fictional-unread-home' });
    const cursor = 'a'.repeat(4091) + '+/b==';
    const { res } = await call(service, inventoryPath + '?cursor=' + encodeURIComponent(cursor));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], hasMore: false, cursor: null });
    const urls = fetchImpl.mock.calls.map(([url]) => url);
    expect(urls.slice(0, 2).map((url) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
    expect(urls.find((url) => url.pathname === '/api/v2/sessions').searchParams.get('page_token')).toBe(cursor);
    expect(urls.at(-1).pathname).toBe('/api/v1/debug/sessionManager/list');
    expect((await call(service, CRON_PREFIX)).res.body.capabilities).toMatchObject({ inventory: true, history: true });
  });

  it.each([[historyPath + '?cursor=a', 'GET', 400], [historyPath, 'POST', 405],
    [inventoryPath, 'POST', 405]])('restricts history and inventory methods and queries %#', async (path, method, status) => {
    const { service, fetchImpl } = fixture();
    expect((await call(service, path, { method })).res.status).toBe(status);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not invoke inventory while RC is unsafe', async () => {
    const { service, fetchImpl } = fixture(true, { 'remote-control': { enabled: true, state: 'on' } },
      { home: 'fictional-unread-home' });
    expect((await call(service, inventoryPath)).res.body.error.code).toBe('unsafe-backend');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
  });
});

describe('version-specific Cron read/write capabilities', () => {
  it.each(['2.1.1', '2.2.0', '2.3.1'])('separates enabled read and write capabilities for exact backend %s', async (version) => {
    const writable = version !== '2.3.1';
    const { service, fetchImpl } = fixture(true, { meta: { ...meta, server_version: version } },
      { home: 'fictional-unread-home' });
    const { res } = await call(service, CRON_PREFIX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, version, versions: ['2.1.1', '2.2.0', '2.3.1'],
      writeVersions: ['2.1.1', '2.2.0'],
      capabilities: { list: true, create: writable, remove: writable, inventory: true, history: true } });
    if (writable) expect(res.body).not.toHaveProperty('reason');
    else expect(res.body).toMatchObject({ reason: 'read-only-version', message: expect.stringContaining('session locks') });
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
  });

  it('rejects 2.3.1 creates and exact-ID removes on the server without debug mutation or uncertain outcome', async () => {
    const { service, fetchImpl } = fixture(true, { meta: { ...meta, server_version: '2.3.1' } });
    for (const [path, body] of [[tasksPath, { cron: task.cron, prompt: task.prompt }],
      [tasksPath + '/deadbeef:delete', {}]]) {
      const { res } = await call(service, path, { method: 'POST', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' } });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: 'read-only-version', message: expect.stringContaining('no write was sent') });
      expect(res.body).not.toHaveProperty('outcomeUnknown');
    }
    expect(fetchImpl.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => url.pathname.includes('/debug/'))).toBe(false);
    expect((await call(service, tasksPath)).res.body).toEqual({ tasks: [task], source: 'live' });
  });

  it('still validates read-only write bodies and refuses unknown versions before debug access', async () => {
    const { service, fetchImpl } = fixture(true, { meta: { ...meta, server_version: '2.3.1' } });
    const invalid = await call(service, tasksPath, { method: 'POST', body: '{',
      headers: { 'content-type': 'application/json' } });
    expect(invalid.res.body.error.code).toBe('invalid-input');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
    const unknown = fixture(true, { meta: { ...meta, server_version: '2.3.2' } });
    expect((await call(unknown.service, CRON_PREFIX)).res.body.error.code).toBe('unsupported-version');
    expect(unknown.fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
  });
});

describe('fixed Cron routes availability and path boundaries', () => {
  it.each(['/api/v1/meta', ...['cronApi.js', 'cronView.js', 'cron.js', 'cron.css']
    .map((name) => '/__open-kimi-mobile/' + name)])('does not handle an API or injected asset outside its namespace %s',
  async (path) => {
    const { service, fetchImpl } = fixture();
    const { handled, res } = await call(service, path);
    expect(handled).toBe(false);
    expect(res.status).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('authenticates unavailable capability reads without any RC/debug request', async () => {
    const { service, fetchImpl } = fixture(false);
    const { res } = await call(service, CRON_PREFIX);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'not-enabled', version: '2.2.0',
      versions: ['2.1.1', '2.2.0', '2.3.1'], writeVersions: ['2.1.1', '2.2.0'],
      capabilities: { list: false, create: false, remove: false, inventory: false, history: false } });
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
    expect(res.headers).toMatchObject({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  });

  it('does not disclose availability without current authorization', async () => {
    const { service, fetchImpl } = fixture(false);
    const { res } = await call(service, CRON_PREFIX, { headers: { authorization: undefined } });
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('available');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    CRON_PREFIX + '?arg=[]', tasksPath + '?x=1', CRON_PREFIX + '/sessions/a%2fb/tasks',
    CRON_PREFIX + '/sessions/fixture-session//tasks', CRON_PREFIX + '/sessions/a/../fixture-session/tasks',
    CRON_PREFIX + '/sessions/fixture-session/%74asks', CRON_PREFIX + '/unknown',
  ])('does not normalize an unrecognized or queried raw route %#', async (path) => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, path);
    expect([400, 404]).toContain(res.status);
    expect(fetchImpl.mock.calls.every(([url]) => url.pathname === '/api/v1/meta')).toBe(true);
  });

  it('allows a configured external target only for authenticated unavailable reads', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ code: 0, data: meta }));
    const service = createCronRouteService({ target: 'https://example.test', fetchImpl });
    const { res } = await call(service, CRON_PREFIX);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(fetchImpl.mock.calls[0][0].href).toBe('https://example.test/api/v1/meta');
    expect(() => createCronRouteService({ target: 'https://example.test', enabled: true })).toThrow();
  });

  it('authenticates enabled availability and hides capabilities when RC is unsafe', async () => {
    const { service, fetchImpl } = fixture(true, { 'remote-control': { enabled: false, state: 'starting' } });
    const { res } = await call(service, CRON_PREFIX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, reason: 'unsafe-backend' });
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta', '/api/v1/remote-control']);
  });

  it.each([
    [tasksPath, 'DELETE', 405], [tasksPath + '/deadbeef:delete', 'GET', 405],
    [tasksPath + '/not-an-id:delete', 'POST', 400], [CRON_PREFIX, 'POST', 405],
    [CRON_PREFIX + '/sessions/_invalid/tasks', 'GET', 400],
  ])('rejects wrong methods and invalid exact identifiers %#', async (path, method, status) => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, path, { method });
    expect(res.status).toBe(status);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses disabled CRUD after authentication, without debug', async () => {
    const { service, fetchImpl } = fixture(false);
    const { res } = await call(service, tasksPath);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not-enabled');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
  });
});

describe('fixed Cron route request guards', () => {
  it.each([
    { origin: 'https://example.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])('rejects cross-origin browser requests %#', async (headers) => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, tasksPath, { headers });
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('permits same-origin browser requests and fixed task list response', async () => {
    const { service } = fixture();
    const { res } = await call(service, tasksPath, {
      headers: { origin: 'http://127.0.0.1:45678', 'sec-fetch-site': 'same-origin' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tasks: [task], source: 'live' });
  });

  it.each([
    [{}, '{}', 415], [{ 'content-type': 'text/plain' }, '{}', 415],
    [{ 'content-type': 'application/json' }, '{', 400],
    [{ 'content-type': 'application/json' }, '{"cron":"* * * * *","prompt":"x","model":"x"}', 400],
    [{ 'content-type': 'application/json', 'content-length': '16385' }, '{}', 413],
  ])('rejects invalid create body after authorization but before debug calls %#', async (headers, body, status) => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, tasksPath, { method: 'POST', headers, body });
    expect(res.status).toBe(status);
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
  });

  it('requires deletion body to be exactly an empty JSON object', async () => {
    const { service, fetchImpl } = fixture();
    const { res } = await call(service, tasksPath + '/deadbeef:delete', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"other"}',
    });
    expect(res.status).toBe(400);
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
  });

  it('times out a slow request body before it can start a mutation', async () => {
    vi.useFakeTimers();
    const { service, fetchImpl } = fixture();
    const stream = new PassThrough();
    const res = response();
    const pending = serveCron(request(tasksPath, { method: 'POST', headers: { 'content-type': 'application/json' }, stream }),
      res, service);
    await vi.advanceTimersByTimeAsync(CRON_BODY_TIMEOUT_MS + 1);
    await pending;
    expect(res.status).toBe(408);
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
    stream.destroy();
  });
});

describe('mutation authentication before body waiting', () => {
  it.each([tasksPath, tasksPath + '/deadbeef:delete'])('does not read the body when current authorization is rejected %s',
  async (path) => {
    const fetchImpl = vi.fn(async () => Response.json({ code: 40101 }, { status: 401 }));
    const service = createCronRouteService({ target: 'http://127.0.0.1:12345', enabled: true, fetchImpl });
    const stream = new PassThrough();
    const { res } = await call(service, path, { method: 'POST', stream, headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(401);
    expect(stream.listenerCount('data')).toBe(0);
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(['/api/v1/meta']);
    stream.destroy();
  });

  it('checks current RC after authenticated body waiting and refuses a newly active backend', async () => {
    const values = { enabled: false, state: 'off' };
    const { service, fetchImpl } = fixture(true, { 'remote-control': values });
    const stream = new PassThrough();
    const res = response();
    const pending = serveCron(request(tasksPath, { method: 'POST', stream,
      headers: { 'content-type': 'application/json' } }), res, service);
    await vi.waitFor(() => expect(stream.listenerCount('data')).toBe(1));
    Object.assign(values, { enabled: true, state: 'on' });
    stream.end(JSON.stringify({ cron: task.cron, prompt: task.prompt }));
    await pending;
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('unsafe-backend');
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v1/meta', '/api/v1/meta', '/api/v1/remote-control',
    ]);
  });
});
