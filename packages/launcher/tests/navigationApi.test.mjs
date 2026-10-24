import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const logic = readFileSync(new URL('../src/mobile/navigationApi.js', import.meta.url), 'utf8');
const hit = { session_id: 'fixture-1', session_title: 'Fictional session', snippet: '<b>plain text</b>', role: 'assistant' };
const envelope = (data) => new Response(JSON.stringify({ code: 0, data }));
function install(respond = () => envelope({ items: [hit], has_more: false })) {
  const native = vi.fn(respond);
  const window = { fetch: native, __okwLocale: { text: (_, en) => en } };
  const context = { window, location: { href: 'http://fixture.invalid/', origin: 'http://fixture.invalid' },
    URL, Request, Headers, Error };
  runInNewContext(logic, context);
  const authorize = () => window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-only' } });
  return { window, native, context, authorize };
}
describe('official navigation search API', () => {
  it('does not fetch before page authorization is observed', async () => {
    const ui = install();
    await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow('Authorization is not ready');
    expect(ui.native).not.toHaveBeenCalled();
  });
  it('reuses official POST search with bounded pages, filters, cursor and cancellation', async () => {
    const ui = install(); await ui.authorize();
    const controller = new AbortController();
    await ui.window.__okwNavigationSearch({ query: 'needle', role: 'user', mode: 'literal', sort: 'time_desc' },
      { signal: controller.signal, pageToken: 'opaque' });
    const [url, options] = ui.native.mock.calls.at(-1);
    expect(url).toBe('/api/v1/search');
    expect(options.method).toBe('POST'); expect(options.cache).toBe('no-store');
    expect(options.signal).toBe(controller.signal);
    expect(options.headers.authorization).toBe('Bearer fictional-only');
    expect(JSON.parse(options.body)).toEqual({ query: 'needle', role: 'user', mode: 'literal', sort: 'time_desc',
      page_size: 20, page_token: 'opaque' });
  });
  it('ignores authorization on another origin and remains singleton', async () => {
    const ui = install(); const fetch = ui.window.fetch;
    runInNewContext(logic, ui.context); expect(ui.window.fetch).toBe(fetch);
    await ui.window.fetch('https://external.invalid/api/x', { headers: { authorization: 'Bearer other' } });
    await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow('Authorization is not ready');
  });
  it('accepts a Request and rejects malformed hits without executing HTML', async () => {
    const ui = install(() => envelope({ items: [hit, { session_id: 4 }, null], has_more: true }));
    await ui.window.fetch(new Request('http://fixture.invalid/api/v1/meta', {
      headers: { authorization: 'Bearer fictional-only' },
    }));
    const page = await ui.window.__okwNavigationSearch({ query: 'fixture' });
    expect(page.items).toEqual([hit]); expect(page.has_more).toBe(false);
  });
  it.each([[404, 'does not support'], [405, 'does not support'], [401, 'expired'], [403, 'expired'], [500, 'Search failed']])(
    'reports HTTP %s truthfully', async (status, message) => {
      const ui = install(() => new Response('{}', { status })); await ui.authorize();
      await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow(message);
    },
  );
  it('rejects a malformed response instead of treating it as empty results', async () => {
    const ui = install(() => envelope({ items: [] })); await ui.authorize();
    await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow('Invalid search response');
  });
});
describe('official workspace registration API', () => {
  it('adds a workspace only through the official validated directory registration API', async () => {
    const ui = install(() => envelope({ id: 'fictional', root: '/workspace/demo' })); await ui.authorize();
    const controller = new AbortController();
    await ui.window.__okwNavigationAddWorkspace(' /workspace/demo ', controller.signal);
    const [url, options] = ui.native.mock.calls.at(-1);
    expect(url).toBe('/api/v1/workspaces'); expect(options.method).toBe('POST');
    expect(options.signal).toBe(controller.signal); expect(JSON.parse(options.body)).toEqual({ root: '/workspace/demo' });
  });
  it.each([
    ['Windows copy-as-path', '  "C:\\Fixture Projects\\demo"  ', 'C:\\Fixture Projects\\demo'],
    ['Windows single quotes', " 'D:\\Fixture Projects\\demo' ", 'D:\\Fixture Projects\\demo'],
    ['POSIX', '  /srv/fixture project/demo  ', '/srv/fixture project/demo'],
    ['quoted POSIX', " '/srv/fixture project/demo' ", '/srv/fixture project/demo'],
    ['embedded quotes', '/srv/it\'s/"demo"', '/srv/it\'s/"demo"'],
    ['unmatched opening quote', '"C:\\Fixture Projects\\demo', '"C:\\Fixture Projects\\demo'],
    ['unmatched closing quote', '/srv/fixture"', '/srv/fixture"'],
    ['mismatched quotes', '\'/srv/fixture"', '\'/srv/fixture"'],
    ['one outer pair only', '\'"/srv/fixture"\'', '"/srv/fixture"'],
  ])('normalizes %s without interpreting the server path on the browser OS', async (_, input, expected) => {
    const ui = install(() => envelope({ id: 'fictional', root: expected })); await ui.authorize();
    const workspace = await ui.window.__okwNavigationAddWorkspace(input);
    const [url, options] = ui.native.mock.calls.at(-1);
    expect(url).toBe('/api/v1/workspaces'); expect(options.method).toBe('POST');
    expect(options.headers.authorization).toBe('Bearer fictional-only');
    expect(options.cache).toBe('no-store'); expect(JSON.parse(options.body)).toEqual({ root: expected });
    expect(workspace.root).toBe(expected); expect(ui.native).toHaveBeenCalledTimes(2);
  });
  it.each(['', '  \n\t ', '""', " '' "])(
    'does not send an empty normalized workspace path (%j)', async (input) => {
      const ui = install(); await ui.authorize(); ui.native.mockClear();
      await expect(ui.window.__okwNavigationAddWorkspace(input)).rejects.toThrow('absolute directory path');
      expect(ui.native).not.toHaveBeenCalled();
    },
  );
  it('does not register a workspace before official page authorization is ready', async () => {
    const ui = install();
    await expect(ui.window.__okwNavigationAddWorkspace('/fixture')).rejects.toThrow('Authorization is not ready');
    expect(ui.native).not.toHaveBeenCalled();
  });
  it.each([[40001, 'absolute'], [40409, 'not exist'], [50001, 'Could not add']])(
    'reports workspace validation error %s without leaking server paths', async (code, message) => {
      const ui = install(() => new Response(JSON.stringify({ code, msg: 'private server path' }))); await ui.authorize();
      await expect(ui.window.__okwNavigationAddWorkspace('/fixture')).rejects.toThrow(message);
    },
  );
  it.each([401, 403])('reports workspace HTTP %s as expired authorization', async (status) => {
    const ui = install(() => new Response('{}', { status })); await ui.authorize();
    await expect(ui.window.__okwNavigationAddWorkspace('/fixture')).rejects.toThrow('Authorization expired');
  });
  it.each([{}, { id: 42, root: '/fixture' }, { id: 'fictional', root: null }])(
    'requires the official workspace identity and root in the successful response (%j)', async (data) => {
      const ui = install(() => envelope(data)); await ui.authorize();
      await expect(ui.window.__okwNavigationAddWorkspace('/fixture')).rejects.toThrow('Invalid workspace response');
    },
  );
  it('rejects invalid JSON without reporting a successful workspace registration', async () => {
    const ui = install(() => new Response('not json')); await ui.authorize();
    await expect(ui.window.__okwNavigationAddWorkspace('/fixture')).rejects.toThrow('Could not add');
  });
});
