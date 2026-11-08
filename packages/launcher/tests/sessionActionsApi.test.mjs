import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/sessionActionsApi.js', import.meta.url), 'utf8');
const origin = 'https://fixture.invalid';
const sourceId = '28f63d66-f158-4bba-850e-3656b2b7bad0';
const forkId = 'fork_new-1';
const storageKey = 'kimi-web.pinned-sessions';
const bearer = 'Bearer fictional-only';
const envelope = (data = { id: forkId }, { code = 0, status = 200 } = {}) => new Response(JSON.stringify({
  code, msg: 'fixture-server-detail-not-for-display', data, request_id: 'fixture',
}), { status });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const at = (response, url, redirected = false) => Object.defineProperties(response, {
  url: { value: url }, redirected: { value: redirected },
});
class PopStateEvent extends Event {
  constructor(type) { super(type); this.state = null; }
}

function install({ path = `/sessions/${sourceId}?view=flat#fixture`, stored = '[]', XMLHttpRequest } = {}) {
  const native = vi.fn(async () => envelope());
  const location = new URL(path, origin);
  const values = new Map([[storageKey, stored], ['kimi-web.pinned-workspaces', '["workspace-other"]'],
    ['kimi-web.auth-token', 'Bearer storage-must-not-be-read']]);
  const localStorage = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
  };
  const sessionStorage = { getItem: vi.fn(), setItem: vi.fn() };
  const locale = { value: 'en' };
  const window = Object.assign(new EventTarget(), { fetch: native, localStorage, sessionStorage, XMLHttpRequest,
    crypto: { randomUUID: vi.fn(() => 'fixture-request-id') },
    __okwLocale: { text: (zh, en) => locale.value === 'zh' ? zh : en },
  });
  const history = { pushState: vi.fn((_, __, path) => { location.href = new URL(path, location.href).href; }) };
  const timeout = vi.fn((milliseconds) => AbortSignal.timeout(milliseconds));
  const context = { window, location, history, localStorage, sessionStorage, URL, Request, Headers,
    AbortSignal: { timeout }, PopStateEvent, Error };
  runInNewContext(source, context);
  const authorize = async () => {
    await window.fetch('/api/v1/meta', { headers: { authorization: bearer } });
    native.mockClear();
  };
  return { window, native, location, history, localStorage, sessionStorage, values, locale, context, timeout,
    api: window.__okwSessionActions, authorize };
}

function xhrFixture() {
  class XMLHttpRequest extends EventTarget {}
  const open = vi.fn(() => 'fixture-open'); const send = vi.fn(() => 'fixture-send');
  Object.assign(XMLHttpRequest.prototype, { open, send });
  return { XMLHttpRequest, open, send };
}

describe('session action authorization and native fetch', () => {
  it('requires an observed Bearer without reading stored credentials and installs only once', async () => {
    const ui = install(); const fetch = ui.window.fetch; const api = ui.api;
    runInNewContext(source, ui.context);
    expect(ui.window.fetch).toBe(fetch); expect(ui.window.__okwSessionActions).toBe(api);
    await expect(api.read(sourceId)).rejects.toMatchObject({ code: 'auth' });
    await expect(api.fork(sourceId)).rejects.toMatchObject({ code: 'auth' });
    expect(ui.native).not.toHaveBeenCalled(); expect(ui.localStorage.getItem).not.toHaveBeenCalled();
    expect(ui.sessionStorage.getItem).not.toHaveBeenCalled();
  });
  it.each([
    ['non-API request', `${origin}/assets/config`, bearer],
    ['cross-origin request', 'https://other.invalid/api/v1/meta', bearer],
    ['Basic scheme', '/api/v1/meta', 'Basic fixture'], ['invalid Bearer', '/api/v1/meta', 'Bearer two words'],
    ['oversized Bearer', '/api/v1/meta', `Bearer ${'x'.repeat(4096)}`],
  ])('does not capture credentials from %s', async (_, url, authorization) => {
    const ui = install(); await ui.window.fetch(url, { headers: { authorization } }); ui.native.mockClear();
    await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: 'auth' });
    expect(ui.native).not.toHaveBeenCalled(); expect(ui.localStorage.getItem).not.toHaveBeenCalled();
  });
  it('unions Request and init client headers without changing native arguments, promises or responses', async () => {
    const ui = install(); const response = envelope(); const promise = Promise.resolve(response);
    ui.native.mockReturnValueOnce(promise);
    const input = new Request(`${origin}/api/v1/meta`, { method: 'POST', body: 'native-body', headers: {
      authorization: bearer, 'x-kimi-client-id': 'fixture-client', 'x-kimi-client-version': 'old', cookie: 'native-only',
    } });
    const options = { headers: { 'x-kimi-client-name': 'Web', 'x-kimi-client-version': '2.4.1',
      'x-kimi-client-ui-mode': 'mobile', 'x-unrelated': 'do-not-copy' }, credentials: 'include' };
    expect(ui.window.fetch(input, options)).toBe(promise);
    expect(await promise).toBe(response); expect(ui.native).toHaveBeenCalledWith(input, options);
    expect(response.bodyUsed).toBe(false); expect(await input.text()).toBe('native-body');
    expect(input.headers.get('x-kimi-client-version')).toBe('old');
    await ui.window.fetch('https://other.invalid/api/v1/meta', { headers: {
      authorization: 'Bearer other-origin', 'x-kimi-client-id': 'other-client',
    } });
    await ui.api.fork(sourceId);
    expect(Object.fromEntries(ui.native.mock.calls.at(-1)[1].headers)).toEqual({
      authorization: bearer, 'content-type': 'application/json', 'x-kimi-client-id': 'fixture-client',
      'x-kimi-client-name': 'Web', 'x-kimi-client-version': '2.4.1', 'x-kimi-client-ui-mode': 'mobile',
      'x-request-id': 'fixture-request-id',
    });
    expect(ui.localStorage.setItem).not.toHaveBeenCalled(); expect(ui.sessionStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('in-flight fetch attachment uploads', () => {
  it('counts concurrent success and failure without changing native promises, arguments, receiver or responses', async () => {
    const ui = install(); expect(ui.api.hasUploads()).toBe(false);
    const first = Promise.withResolvers(); const second = Promise.withResolvers();
    ui.native.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const input = new Request(`${origin}/api/v1/files`, { method: 'POST', body: new FormData() });
    const bodyRead = vi.spyOn(input, 'body', 'get'); const clone = vi.spyOn(input, 'clone');
    const options = { method: 'post', body: new FormData() }; const receiver = {};
    expect(ui.window.fetch.call(receiver, input)).toBe(first.promise);
    expect(ui.native.mock.contexts[0]).toBe(receiver); expect(ui.native).toHaveBeenNthCalledWith(1, input);
    expect(ui.api.hasUploads()).toBe(true);
    expect(ui.window.fetch('/api/v1/files?scope=fixture', options)).toBe(second.promise);
    expect(ui.native).toHaveBeenNthCalledWith(2, '/api/v1/files?scope=fixture', options);
    expect(ui.native.mock.calls[1][1]).toBe(options);
    const response = envelope(); const responseClone = vi.spyOn(response, 'clone'); first.resolve(response);
    expect(await first.promise).toBe(response); expect(ui.api.hasUploads()).toBe(true);
    const failure = new TypeError('fixture-upload-failed');
    const rejection = expect(second.promise).rejects.toBe(failure); second.reject(failure); await rejection;
    expect(ui.api.hasUploads()).toBe(false); expect(input.bodyUsed).toBe(false); expect(response.bodyUsed).toBe(false);
    expect(bodyRead).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled();
    expect(responseClone).not.toHaveBeenCalled(); expect(ui.localStorage.getItem).not.toHaveBeenCalled();
    expect(ui.localStorage.setItem).not.toHaveBeenCalled(); expect(ui.sessionStorage.setItem).not.toHaveBeenCalled();
    expect(ui.native).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['GET', '/api/v1/files'], ['POST', 'https://other.invalid/api/v1/files'],
    ['POST', '/api/v1/sessions'], ['POST', '/api/v1/files/preview'],
  ])('does not count a pending %s %s as an upload', async (method, url) => {
    const ui = install(); const pending = Promise.withResolvers(); ui.native.mockReturnValueOnce(pending.promise);
    expect(ui.window.fetch(url, { method })).toBe(pending.promise); expect(ui.api.hasUploads()).toBe(false);
    pending.resolve(envelope()); await pending.promise; expect(ui.api.hasUploads()).toBe(false);
  });
  it('honors a Request method override and clears a completed HTTP failure', async () => {
    const ui = install(); const input = new Request(`${origin}/api/v1/files`, { method: 'POST' });
    const pending = Promise.withResolvers(); ui.native.mockReturnValueOnce(pending.promise);
    const result = ui.window.fetch(input, { method: 'GET' }); expect(ui.api.hasUploads()).toBe(false);
    pending.resolve(envelope()); await result;
    const response = new Response(null, { status: 500 }); ui.native.mockResolvedValueOnce(response);
    const upload = ui.window.fetch('/api/v1/files', { method: 'POST' }); expect(ui.api.hasUploads()).toBe(true);
    expect(await upload).toBe(response); expect(ui.api.hasUploads()).toBe(false);
  });
});

describe('in-flight XHR attachment uploads', () => {
  it('wraps each prototype once, preserves native receivers and arguments, and counts until each loadend', () => {
    const qa = xhrFixture(); const ui = install(qa); const prototype = qa.XMLHttpRequest.prototype;
    const open = prototype.open; const send = prototype.send; const api = ui.api;
    runInNewContext(source, ui.context);
    expect(prototype.open).toBe(open); expect(prototype.send).toBe(send); expect(ui.window.__okwSessionActions).toBe(api);
    expect(api.hasUploads()).toBe(false);
    const first = new qa.XMLHttpRequest(); const second = new qa.XMLHttpRequest();
    const openArgs = ['post', '/api/v1/files', true]; const body = new FormData();
    expect(first.open(...openArgs)).toBe('fixture-open'); expect(api.hasUploads()).toBe(false);
    expect(qa.open).toHaveBeenNthCalledWith(1, ...openArgs); expect(qa.open.mock.contexts[0]).toBe(first);
    expect(first.send(body)).toBe('fixture-send'); expect(api.hasUploads()).toBe(true);
    expect(qa.send).toHaveBeenNthCalledWith(1, body); expect(qa.send.mock.contexts[0]).toBe(first);
    second.open('POST', `${origin}/api/v1/files?scope=fixture`); second.send(null);
    first.dispatchEvent(new Event('loadend')); expect(api.hasUploads()).toBe(true);
    first.dispatchEvent(new Event('loadend')); expect(api.hasUploads()).toBe(true);
    second.dispatchEvent(new Event('error')); expect(api.hasUploads()).toBe(true);
    second.dispatchEvent(new Event('loadend')); expect(api.hasUploads()).toBe(false);
    expect(qa.open).toHaveBeenCalledTimes(2); expect(qa.send).toHaveBeenCalledTimes(2);
    expect(ui.localStorage.getItem).not.toHaveBeenCalled(); expect(ui.localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.native).not.toHaveBeenCalled();
  });
  it('rethrows the original synchronous send failure and removes its count exactly once', () => {
    const qa = xhrFixture(); const ui = install(qa); const xhr = new qa.XMLHttpRequest();
    const failure = new Error('fixture-send-failed');
    qa.send.mockImplementationOnce(() => { throw failure; }); xhr.open('POST', '/api/v1/files');
    expect(() => xhr.send(null)).toThrow(failure); expect(ui.api.hasUploads()).toBe(false);
    const next = new qa.XMLHttpRequest(); next.open('POST', '/api/v1/files'); next.send();
    expect(ui.api.hasUploads()).toBe(true); xhr.dispatchEvent(new Event('loadend'));
    expect(ui.api.hasUploads()).toBe(true); next.dispatchEvent(new Event('loadend'));
    expect(ui.api.hasUploads()).toBe(false); expect(qa.send).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['GET', '/api/v1/files'], ['POST', 'https://other.invalid/api/v1/files'], ['POST', '/api/v1/sessions'],
  ])('does not count XHR %s %s', (method, url) => {
    const qa = xhrFixture(); const ui = install(qa); const xhr = new qa.XMLHttpRequest();
    expect(xhr.open(method, url, true)).toBe('fixture-open'); expect(xhr.send(null)).toBe('fixture-send');
    expect(ui.api.hasUploads()).toBe(false); xhr.dispatchEvent(new Event('loadend'));
    expect(ui.api.hasUploads()).toBe(false);
  });
  it('shares the in-flight count across fetch and XHR', async () => {
    const qa = xhrFixture(); const ui = install(qa); const xhr = new qa.XMLHttpRequest();
    xhr.open('POST', '/api/v1/files'); xhr.send();
    const pending = Promise.withResolvers(); ui.native.mockReturnValueOnce(pending.promise);
    const result = ui.window.fetch('/api/v1/files', { method: 'POST' });
    xhr.dispatchEvent(new Event('loadend')); expect(ui.api.hasUploads()).toBe(true);
    pending.resolve(envelope()); await result; expect(ui.api.hasUploads()).toBe(false);
  });
});

describe('official read and fork requests', () => {
  it('reads the exact source, forks once with empty JSON, and leaves source, route and preferences unchanged', async () => {
    const ui = install({ stored: JSON.stringify([sourceId]) }); await ui.authorize();
    const item = { id: sourceId, title: 'Source', metadata: { cwd: '/fixture/project' } };
    ui.native.mockResolvedValueOnce(envelope(item));
    const original = await ui.api.read(sourceId); const originalRecord = { ...ui.api.record(sourceId) };
    const [readUrl, readOptions] = ui.native.mock.calls[0];
    expect(readUrl).toBe(`/api/v1/sessions/${encodeURIComponent(sourceId)}`);
    expect(readOptions.method).toBe('GET'); expect(readOptions.body).toBeUndefined();
    const beforeRoute = ui.location.href; const beforeStorage = [...ui.values];
    const branch = await ui.api.fork(sourceId);
    const [url, options] = ui.native.mock.calls[1];
    expect(url).toBe(`/api/v1/sessions/${encodeURIComponent(sourceId)}:fork`);
    expect(options).toMatchObject({ method: 'POST', body: '{}', cache: 'no-store',
      credentials: 'same-origin', redirect: 'error' });
    expect(options.headers.get('authorization')).toBe(bearer);
    expect(options.headers.get('content-type')).toBe('application/json');
    expect(options.signal).toBeInstanceOf(AbortSignal); expect(ui.timeout.mock.calls).toEqual([[10000], [300000]]);
    expect(branch).toEqual({ id: forkId }); expect(original).toEqual(item);
    expect(ui.api.record(sourceId)).toEqual(originalRecord); expect(ui.api.record(forkId)).toBeUndefined();
    expect(ui.location.href).toBe(beforeRoute); expect([...ui.values]).toEqual(beforeStorage);
    expect(ui.history.pushState).not.toHaveBeenCalled(); expect(ui.native).toHaveBeenCalledTimes(2);
  });
  it.each([{ id: 'another-session' }, { id: 42 }, {}, { id: 'bad/id' }])(
    'rejects a read without the exact requested ID (%j)', async (data) => {
      const ui = install(); await ui.authorize(); ui.native.mockResolvedValueOnce(envelope(data));
      await expect(ui.api.read(sourceId)).rejects.toMatchObject({ code: 'invalid' });
      expect(ui.native).toHaveBeenCalledTimes(1);
    },
  );
  it('blocks a duplicate pending fork and releases the guard after failure without automatic retry', async () => {
    const ui = install(); await ui.authorize(); let reject;
    ui.native.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const first = ui.api.fork(sourceId); const failure = expect(first).rejects.toMatchObject({ code: 'unknown' });
    await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: 'pending' });
    expect(ui.native).toHaveBeenCalledTimes(1); reject(new TypeError('fixture-offline')); await failure; await tick();
    expect(ui.native).toHaveBeenCalledTimes(1);
    await expect(ui.api.fork(sourceId)).resolves.toEqual({ id: forkId });
    expect(ui.native).toHaveBeenCalledTimes(2);
  });
});

describe('fork HTTP and official business failures', () => {
  it.each([
    [401, 0, 'auth'], [403, 0, 'auth'], [404, 0, 'unavailable'], [405, 0, 'unavailable'],
    [200, 40401, 'unavailable'], [200, 40901, 'busy'], [200, 40931, 'occupied'], [200, 40932, 'occupied'],
    [200, 50001, 'failed'], [500, 0, 'failed'],
  ])('reports HTTP %s / code %s as %s and never retries', async (status, code, expected) => {
    const ui = install(); await ui.authorize(); ui.native.mockResolvedValueOnce(envelope({}, { status, code }));
    await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: expected }); await tick();
    expect(ui.native).toHaveBeenCalledTimes(1); expect(ui.history.pushState).not.toHaveBeenCalled();
    expect(ui.api.failure({ code: expected })).not.toContain('fixture-server-detail');
    expect(ui.location.pathname).toBe(`/sessions/${sourceId}`); expect(ui.localStorage.setItem).not.toHaveBeenCalled();
  });
  it.each([[401, 'auth'], [403, 'auth'], [404, 'unavailable'], [405, 'unavailable']])(
    'recognizes HTTP %s even when a proxy returns a non-JSON body', async (status, code) => {
      const ui = install(); await ui.authorize();
      ui.native.mockResolvedValueOnce(new Response('fixture proxy error', { status }));
      await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code });
      expect(ui.native).toHaveBeenCalledTimes(1);
    },
  );
});

describe('uncertain fork results and transport failures', () => {
  it.each([{}, { id: sourceId }, { id: 42 }, { id: 'bad/id' }])(
    'does not treat an unverified new ID as success (%j)', async (data) => {
      const ui = install(); await ui.authorize(); ui.native.mockResolvedValueOnce(envelope(data));
      await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: 'unknown' }); await tick();
      expect(ui.native).toHaveBeenCalledTimes(1); expect(ui.location.pathname).toBe(`/sessions/${sourceId}`);
    },
  );
  it.each([['fork', 'unknown'], ['read', 'invalid']])('reports malformed JSON from %s as %s', async (method, code) => {
    const ui = install(); await ui.authorize(); ui.native.mockResolvedValueOnce(new Response('not json'));
    await expect(ui.api[method](sourceId)).rejects.toMatchObject({ code }); expect(ui.native).toHaveBeenCalledTimes(1);
  });
  it.each([['fork', 'unknown'], ['read', 'connection']])('does not retry %s after network failure', async (method, code) => {
    const ui = install(); await ui.authorize(); ui.native.mockRejectedValueOnce(new TypeError('fixture-offline'));
    await expect(ui.api[method](sourceId)).rejects.toMatchObject({ code }); await tick();
    expect(ui.native).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['fork', 'unknown', `${origin}/login`, true], ['fork', 'unknown', 'https://other.invalid/api/v1/sessions/new', false],
    ['read', 'connection', `${origin}/login`, true],
  ])('rejects redirected %s responses without retry (%s, %s)', async (method, code, url, redirected) => {
    const ui = install(); await ui.authorize();
    ui.native.mockResolvedValueOnce(at(envelope({ id: method === 'fork' ? forkId : sourceId }), url, redirected));
    await expect(ui.api[method](sourceId)).rejects.toMatchObject({ code }); await tick();
    expect(ui.native).toHaveBeenCalledTimes(1); expect(ui.history.pushState).not.toHaveBeenCalled();
  });
  it('passes the fork deadline signal to fetch and treats its expiration as unknown without retry', async () => {
    const ui = install(); await ui.authorize();
    ui.timeout.mockImplementationOnce(() => AbortSignal.timeout(5));
    ui.native.mockImplementationOnce((_, { signal }) => new Promise((__, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: 'unknown' });
    expect(ui.timeout).toHaveBeenCalledExactlyOnceWith(300000); expect(ui.native).toHaveBeenCalledTimes(1);
  });
});

describe('official browser-local session pins', () => {
  it('deduplicates pins and rereads before writes, preserving unrelated and concurrently added preferences', () => {
    const ui = install({ stored: '["other","other"]' }); const listener = vi.fn(); ui.api.observe(listener);
    expect(ui.api.pins()).toEqual(['other']); ui.values.set(storageKey, '["other","late-pin"]');
    ui.api.setPinned(sourceId, true); expect(ui.api.pins()).toEqual(['other', 'late-pin', sourceId]);
    ui.api.setPinned('other', false); expect(ui.api.pins()).toEqual(['late-pin', sourceId]);
    expect(ui.values.get('kimi-web.pinned-workspaces')).toBe('["workspace-other"]');
    expect(ui.values.get('kimi-web.auth-token')).toBe('Bearer storage-must-not-be-read');
    expect(ui.localStorage.setItem.mock.calls.map(([key]) => key)).toEqual([storageKey, storageKey]);
    expect(ui.localStorage.getItem.mock.calls.every(([key]) => key === storageKey)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2); expect(ui.native).not.toHaveBeenCalled();
  });
  it.each(['{', '{}', '[null]', '["bad/id"]', JSON.stringify(['x'.repeat(257)])])(
    'rejects malformed pins without overwriting browser data (%s)', (stored) => {
      const ui = install({ stored }); const before = [...ui.values];
      expect(() => ui.api.pins()).toThrow('storage'); expect(() => ui.api.setPinned(sourceId, true)).toThrow('storage');
      expect(ui.localStorage.setItem).not.toHaveBeenCalled(); expect([...ui.values]).toEqual(before);
    },
  );
  it.each(['getItem', 'setItem'])('reports unavailable storage on %s and preserves all preferences', (operation) => {
    const ui = install({ stored: '["other"]' }); const before = [...ui.values]; const listener = vi.fn();
    ui.api.observe(listener); ui.localStorage[operation].mockImplementationOnce(() => { throw new Error('fixture-denied'); });
    expect(() => ui.api.setPinned(sourceId, true)).toThrow('storage');
    expect([...ui.values]).toEqual(before); expect(listener).not.toHaveBeenCalled();
  });
  it('notifies only official pin storage changes and refuses invalid IDs without touching storage', () => {
    const ui = install(); const listener = vi.fn(); ui.api.observe(listener);
    for (const key of ['kimi-web.pinned-workspaces', storageKey, null]) {
      ui.window.dispatchEvent(Object.assign(new Event('storage'), { key }));
    }
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => ui.api.setPinned('../other', true)).toThrow('identity');
    expect(ui.localStorage.getItem).not.toHaveBeenCalled(); expect(ui.localStorage.setItem).not.toHaveBeenCalled();
  });
});

const workspace = { id: 'fixture-workspace', cwd: '/fixture/project' };
const pinnedV1 = { id: 'pin-1', title: 'Pinned', metadata: { cwd: workspace.cwd }, transcript: ['not-cached'] };
const pinnedV2 = { id: 'pin-1', meta: { title: 'Pinned' }, workspace, transcript: ['not-cached'] };
const unpinned = { id: 'not-pinned-1', meta: { title: 'Do not cache' }, workspace };

describe('bounded observation of pinned session metadata', () => {
  it.each([
    ['v1 flat', '/api/v1/sessions?include_archived=false', { items: [pinnedV1, unpinned] }],
    ['v2 flat', '/api/v2/sessions?view=flat', { items: [pinnedV2, unpinned] }],
    ['v2 grouped', '/api/v2/sessions?view=by_workspace', { groups: [{ workspace, sessions: [pinnedV2, unpinned] }] }],
  ])('projects only pinned ID, title and cwd from %s while leaving native bodies readable', async (_, url, data) => {
    const ui = install({ stored: '["pin-1"]' }); const listener = vi.fn(); ui.api.observe(listener);
    const response = envelope(data); ui.native.mockResolvedValueOnce(response);
    expect(await ui.window.fetch(url)).toBe(response);
    await vi.waitFor(() => expect(ui.api.record('pin-1')).toEqual({ id: 'pin-1', title: 'Pinned', cwd: workspace.cwd }));
    expect(response.bodyUsed).toBe(false); expect((await response.json()).data).toEqual(data);
    expect(ui.api.record(unpinned.id)).toBeUndefined(); expect(listener).toHaveBeenCalledTimes(1);
    ui.native.mockResolvedValueOnce(envelope(data)); await ui.window.fetch(url); await tick();
    expect(listener).toHaveBeenCalledTimes(1); expect(ui.localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.localStorage.getItem.mock.calls.every(([key]) => key === storageKey)).toBe(true);
    expect(ui.native).toHaveBeenCalledTimes(2);
  });
  it('uses last_prompt or the exact ID as display fallbacks without caching other session fields', async () => {
    const ui = install({ stored: '["pin-1","pin-2"]' });
    ui.native.mockResolvedValueOnce(envelope({ items: [
      { id: 'pin-1', meta: { last_prompt: 'Fixture prompt' }, workspace },
      { id: 'pin-2', title: 42, transcript: ['not-cached'] }, { id: 'bad/id', title: 'Invalid' },
    ] }));
    await ui.window.fetch('/api/v2/sessions');
    await vi.waitFor(() => expect(ui.api.record('pin-2')).toEqual({ id: 'pin-2', title: 'pin-2', cwd: '' }));
    expect(ui.api.record('pin-1')).toEqual({ id: 'pin-1', title: 'Fixture prompt', cwd: workspace.cwd });
    expect(ui.api.record('bad/id')).toBeUndefined();
  });
  it.each([
    ['/api/v1/sessions/pin-1/transcript/main', 'GET'], ['/api/v2/sessions/pin-1/transcript', 'GET'],
    ['/api/v1/sessions', 'POST'], ['https://other.invalid/api/v2/sessions', 'GET'],
  ])('never clones transcript, mutation or cross-origin responses (%s %s)', async (url, method) => {
    const ui = install({ stored: '["pin-1"]' }); const response = envelope({ items: [pinnedV2] });
    const clone = vi.spyOn(response, 'clone'); ui.native.mockResolvedValueOnce(response);
    expect(await ui.window.fetch(url, { method })).toBe(response); await tick();
    expect(clone).not.toHaveBeenCalled(); expect(ui.api.record('pin-1')).toBeUndefined();
  });
});

describe('pin observation response and storage failures', () => {
  it.each([
    ['HTTP failure', () => envelope({ items: [pinnedV2] }, { status: 500 })],
    ['business failure', () => envelope({ items: [pinnedV2] }, { code: 50001 })],
    ['redirect', () => at(envelope({ items: [pinnedV2] }), `${origin}/login`, true)],
    ['foreign response', () => at(envelope({ items: [pinnedV2] }), 'https://other.invalid/api/v2/sessions')],
    ['invalid JSON', () => new Response('not json')],
  ])('does not cache metadata from %s', async (_, respond) => {
    const ui = install({ stored: '["pin-1"]' }); const listener = vi.fn(); ui.api.observe(listener);
    const response = respond(); ui.native.mockResolvedValueOnce(response);
    expect(await ui.window.fetch('/api/v2/sessions')).toBe(response); await tick();
    expect(ui.api.record('pin-1')).toBeUndefined(); expect(listener).not.toHaveBeenCalled();
    expect(ui.localStorage.setItem).not.toHaveBeenCalled();
  });
  it('keeps native fetch successful when pin storage is unreadable', async () => {
    const ui = install({ stored: '["pin-1"]' }); const response = envelope({ items: [pinnedV2] });
    ui.localStorage.getItem.mockImplementation(() => { throw new Error('fixture-denied'); });
    ui.native.mockResolvedValueOnce(response);
    expect(await ui.window.fetch('/api/v1/sessions')).toBe(response); await tick();
    expect(ui.api.record('pin-1')).toBeUndefined(); expect(response.bodyUsed).toBe(false);
  });
});

describe('canonical session navigation and identity', () => {
  it('uses only public history and popstate, preserving query and hash', () => {
    const ui = install({ path: '/?view=flat#fixture' }); const listener = vi.fn();
    ui.window.addEventListener('popstate', listener); ui.api.navigate(forkId);
    expect(ui.history.pushState).toHaveBeenCalledExactlyOnceWith(null, '', `/sessions/${forkId}?view=flat#fixture`);
    expect(ui.location.pathname).toBe(`/sessions/${forkId}`); expect(ui.api.routeId()).toBe(forkId);
    expect(listener).toHaveBeenCalledTimes(1); expect(listener.mock.calls[0][0]).toBeInstanceOf(PopStateEvent);
    expect(ui.native).not.toHaveBeenCalled();
  });
  it.each([
    '/devices/fixture/sessions/source', '/devices/fixture', '/settings', '/sessions', '/sessions/source/extra',
    '/sessions/source:fork', '/sessions/bad%2Fid', '/sessions/%',
  ])('refuses navigation, reads and forks on unsupported route %s', async (path) => {
    const ui = install({ path }); await ui.authorize();
    expect(ui.api.routeSupported()).toBe(false); expect(ui.api.routeId()).toBeNull();
    expect(() => ui.api.navigate(forkId)).toThrow('identity');
    await expect(ui.api.read(sourceId)).rejects.toMatchObject({ code: 'identity' });
    await expect(ui.api.fork(sourceId)).rejects.toMatchObject({ code: 'identity' });
    expect(ui.native).not.toHaveBeenCalled(); expect(ui.history.pushState).not.toHaveBeenCalled();
  });
  it('decodes an exact canonical route and bounds IDs without accepting path syntax', async () => {
    const ui = install({ path: '/sessions/%66ixture_1-2/' }); await ui.authorize();
    expect(ui.api.routeId()).toBe('fixture_1-2'); expect(ui.api.routeSupported()).toBe(true);
    expect(ui.api.validId(sourceId)).toBe(true); expect(ui.api.validId('x'.repeat(256))).toBe(true);
    for (const id of ['', 'x'.repeat(257), 'bad/id', 'bad?id', 'bad%2Fid', '.', 42, null]) {
      expect(ui.api.validId(id)).toBe(false); expect(() => ui.api.navigate(id)).toThrow('identity');
      await expect(ui.api.fork(id)).rejects.toMatchObject({ code: 'identity' });
    }
    expect(ui.native).not.toHaveBeenCalled(); expect(ui.history.pushState).not.toHaveBeenCalled();
  });
});

describe('session action localized failure messages', () => {
  it('follows the shared locale dynamically without displaying raw server failures', () => {
    const ui = install();
    for (const [code, english, chinese] of [
      ['auth', 'Authorization', '授权'], ['identity', 'selected session', '所选会话'],
      ['storage', 'browser storage permissions', '存储权限'], ['busy', 'session is running', '仍在运行'],
      ['uploading', 'Attachments are still preparing', '等上传完成'],
      ['occupied', 'Another process', '其他进程'], ['unavailable', 'does not support', '不支持'],
      ['unknown', 'fork result is unknown', '分叉结果'], ['connection', 'Check the connection', '检查连接'],
      ['pending', 'already in progress', '正在分叉'], ['failed', 'original session was not replaced', '原会话未被替换'],
    ]) {
      const failure = { code, message: 'fixture-server-detail-not-for-display' };
      ui.locale.value = 'en'; expect(ui.api.failure(failure)).toContain(english);
      expect(ui.api.failure(failure)).not.toMatch(/[\u4e00-\u9fff]/);
      ui.locale.value = 'zh'; expect(ui.api.failure(failure)).toContain(chinese);
      expect(ui.api.failure(failure)).not.toContain(failure.message);
    }
    expect(ui.api.failure({ code: 'unexpected' })).toBe(ui.api.failure({ code: 'failed' }));
    delete ui.window.__okwLocale;
    expect(ui.api.failure({ code: 'pending' })).toBe('A fork is already in progress. Please wait.');
    expect(ui.native).not.toHaveBeenCalled();
  });
});
