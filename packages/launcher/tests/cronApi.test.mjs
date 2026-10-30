import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { TextEncoder } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
const logic = ['navigationApi.js', 'cronApi.js'].map((name) =>
  readFileSync(new URL(`../src/mobile/${name}`, import.meta.url), 'utf8'));
const task = { id: 'native-id', cron: '7 * * * *', prompt: 'Fixture', createdAt: 1792371780000 };
function install(response = () => new Response(JSON.stringify({ tasks: [task] }))) {
  const fetch = vi.fn(response); const window = { fetch };
  const context = { window, location: { href: 'http://fixture.invalid/', origin: 'http://fixture.invalid' },
    URL, Headers, Request, Error, TextEncoder };
  logic.forEach((source) => runInNewContext(source, context));
  return { window, fetch, api: window.__okwCronCreateApi(),
    authorize: () => window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-only' } }) };
}
describe('read-only cron browser adapter', () => {
  it.each(['2.3.1', '2.4.1'])(
    'retains %s read-only capabilities and rejects write/restore callbacks before requests', async (version) => {
    const test = install(); await test.authorize();
    const value = { available: true, version, reason: 'read-only-version',
      capabilities: { list: true, inventory: true, history: true, create: false, remove: false } };
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)));
    await expect(test.api.capabilities()).resolves.toEqual(value);
    const before = test.fetch.mock.calls.length;
    await expect(test.api.create('s', { cron: '7 * * * *', prompt: 'Fixture' }))
      .rejects.toMatchObject({ code: 'read-only-version', outcomeUnknown: false });
    await expect(test.api.remove('s', 'id')).rejects.toMatchObject({ code: 'read-only-version', outcomeUnknown: false });
    await expect(test.api.restore('s', true)).rejects.toMatchObject({ code: 'read-only-version', outcomeUnknown: false });
    expect(test.fetch).toHaveBeenCalledTimes(before);
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [task], source: 'live' })));
    await expect(test.api.list('s')).resolves.toEqual({ tasks: [task], source: 'live' });
  });

  it('keeps a server-side read-only rejection known when the browser has not fetched capabilities', async () => {
    const test = install(); await test.authorize();
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'read-only-version' } }), { status: 409 }));
    await expect(test.api.remove('s', 'id')).rejects.toMatchObject({ code: 'read-only-version', outcomeUnknown: false });
    expect(test.fetch).toHaveBeenCalledTimes(2);
  });
});
describe('restricted cron browser adapter', () => {
  it('does not return a token or allow arbitrary URLs/debug methods', async () => {
    const test = install();
    await expect(test.api.list('original')).rejects.toMatchObject({ code: 'auth' });
    await test.authorize();
    await expect(test.window.__okwNavigationRequest('http://external.invalid', { sid: 's' })).rejects.toThrow('Unsupported');
    await test.api.list('original/session');
    const [url, options] = test.fetch.mock.calls.at(-1);
    expect(url).toBe('/__open-kimi-mobile/cron/sessions/original%2Fsession/tasks');
    expect(options.headers.authorization).toBe('Bearer fictional-only'); expect(options.cache).toBe('no-store');
    expect(Object.keys(test.api)).not.toContain('authorization');
    expect(test.window[Symbol.for('open-kimi-web.navigation-api')]).toBe(true);
  });
  it('reads real fixed inventory/history routes with opaque cursor encoding and no history pagination', async () => {
    const test = install(); await test.authorize();
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], hasMore: false, cursor: null })));
    await test.api.sessions(); expect(test.fetch.mock.calls.at(-1)[0]).toBe('/__open-kimi-mobile/cron/sessions');
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], hasMore: false, cursor: null })));
    await test.api.sessions('opaque?&/+=');
    expect(test.fetch.mock.calls.at(-1)[0]).toBe('/__open-kimi-mobile/cron/sessions?cursor=opaque%3F%26%2F%2B%3D');
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ available: true, items: [], hasMore: false,
      quality: { complete: true, reasons: [] } })));
    await test.api.history('native/session', 'ignored');
    expect(test.fetch.mock.calls.at(-1)[0]).toBe('/__open-kimi-mobile/cron/sessions/native%2Fsession/history');
    expect(test.fetch.mock.calls.at(-1)[1]).toMatchObject({ method: 'GET', cache: 'no-store' });
    const sessions = vi.fn(async () => ({ items: [] }));
    await test.window.__okwCronCreateApi({ sessions }).sessions('cursor'); expect(sessions).toHaveBeenCalledWith('cursor');
  });
  it('uses fixed create/remove routes and preserves native task identifiers', async () => {
    const test = install(() => new Response(JSON.stringify({ task }))); await test.authorize();
    await test.api.create('s', { cron: ' 7 * * * * ', prompt: 'Fixture', recurring: true, model: 'ignored' });
    expect(JSON.parse(test.fetch.mock.calls.at(-1)[1].body)).toEqual(
      { cron: '7 * * * *', prompt: 'Fixture', recurring: true });
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ removed: ['native/id'] })));
    await test.api.remove('s', 'native/id');
    expect(test.fetch.mock.calls.at(-1)[0]).toBe('/__open-kimi-mobile/cron/sessions/s/tasks/native%2Fid:delete');
    expect(JSON.parse(test.fetch.mock.calls.at(-1)[1].body)).toEqual({});
  });
  it('checks the actual UTF-8 8KiB limit before writing', async () => {
    const test = install(); await test.authorize(); const count = test.fetch.mock.calls.length;
    await expect(test.api.create('s', { cron: '* * * * *', prompt: '中'.repeat(2731) }))
      .rejects.toMatchObject({ code: 'prompt-limit' });
    expect(test.fetch).toHaveBeenCalledTimes(count);
  });
  it('marks transport and malformed write results unknown and never retries', async () => {
    const test = install(); await test.authorize();
    test.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(test.api.remove('s', 'id')).rejects.toMatchObject({ outcomeUnknown: true });
    test.fetch.mockResolvedValueOnce(new Response('{'));
    await expect(test.api.create('s', { cron: '* * * * *', prompt: 'Fixture' }))
      .rejects.toMatchObject({ outcomeUnknown: true });
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ removed: ['wrong-id'] })));
    await expect(test.api.remove('s', 'id')).rejects.toMatchObject({ outcomeUnknown: true });
    expect(test.fetch).toHaveBeenCalledTimes(4);
  });
  it('preserves coded failures and performs status restoration only after explicit confirmation', async () => {
    const test = install(); await test.authorize();
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'not-loaded', message: 'private' } }),
      { status: 409 }));
    await expect(test.api.list('s')).rejects.toMatchObject({ code: 'not-loaded', outcomeUnknown: false });
    await expect(test.api.restore('s')).rejects.toMatchObject({ code: 'confirmation-required' });
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { status: 'idle' } })));
    await test.api.restore('s', true);
    expect(test.fetch.mock.calls.at(-1)[0]).toBe('/api/v1/sessions/s/status');
    expect(test.fetch.mock.calls.at(-1)[1].method).toBe('GET');
  });
});
describe('native cron inventory DTO validation', () => {
  it('retains saved workspace, quality, model and native history evidence from the real endpoints', async () => {
    const test = install(); await test.authorize();
    const quality = { complete: false, reasons: ['main-wire-missing'] };
    const session = { id: 'native/session', title: 'Fixture session', workspace: { id: 'workspace', name: 'Fixture workspace' },
      archived: true, loaded: null, model: null, modelSource: 'unknown', tasks: [task], quality };
    const inventory = { items: [session], hasMore: true, cursor: 'opaque-next' };
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify(inventory)));
    await expect(test.api.sessions()).resolves.toEqual(inventory);
    const history = { available: true, items: [{ time: 1792371780000, taskId: task.id, kind: 'started', turnId: 3,
      endReason: 'completed', endedAt: 1792371785000, durationMs: 5000, inherited: true,
      models: [{ model: 'fixture/actual', alias: 'Fixture alias', provider: 'Fixture provider', time: 1792371780000 }] }],
    hasMore: false, quality };
    test.fetch.mockResolvedValueOnce(new Response(JSON.stringify(history)));
    await expect(test.api.history(session.id)).resolves.toEqual(history);
    expect(test.fetch.mock.calls.at(-1)[0]).toBe('/__open-kimi-mobile/cron/sessions/native%2Fsession/history');
  });
  it('rejects malformed or incomplete DTOs instead of accepting them as empty inventory or history', async () => {
    const test = install(); await test.authorize();
    const malformed = [{ items: [], hasMore: true, cursor: null }, { items: [{ id: 's', tasks: [] }], hasMore: false }];
    for (const value of malformed) {
      test.fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)));
      await expect(test.api.sessions()).rejects.toMatchObject({ code: 'invalid-response', outcomeUnknown: false });
    }
    const pages = [{ available: true, items: [], hasMore: false }, { available: true, hasMore: false,
      quality: { complete: true, reasons: [] }, items: [{ time: 0, taskId: 'id', kind: 'invented', inherited: false }] },
    { available: true, hasMore: false, quality: { complete: true, reasons: [] },
      items: [{ time: 0, taskId: 'id', kind: 'started', inherited: false, models: [null] }] }];
    for (const value of pages) {
      test.fetch.mockResolvedValueOnce(new Response(JSON.stringify(value)));
      await expect(test.api.history('s')).rejects.toMatchObject({ code: 'invalid-response', outcomeUnknown: false });
    }
  });
});
