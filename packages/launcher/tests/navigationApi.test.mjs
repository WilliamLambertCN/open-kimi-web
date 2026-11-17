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
  it.each(['en', 'zh'])('explains the exact 2.5.2 disabled search response in %s without changing config', async (locale) => {
    const msg = 'global search is disabled; set [database] global_search = true or KIMI_CODE_GLOBAL_SEARCH=1 to enable it';
    const ui = install(() => Response.json({ code: 50001, msg, data: null, stack: 'private stack' }));
    ui.window.__okwLocale.text = (zh, en) => locale === 'zh' ? zh : en;
    await ui.authorize();
    const search = ui.window.__okwNavigationSearch({ query: 'fixture' });
    await expect(search).rejects.toThrow('global_search = true');
    await expect(search).rejects.toThrow('KIMI_CODE_GLOBAL_SEARCH=1');
    await expect(search).rejects.toThrow(locale === 'zh' ? '扫描历史会话' : 'scans historical sessions');
    await expect(search).rejects.not.toThrow('private stack');
    expect(ui.native.mock.calls.map(([path]) => path)).toEqual(['/api/v1/meta', '/api/v1/search']);
  });
  it('does not mislabel unrelated server failures as disabled search', async () => {
    const ui = install(() => Response.json({ code: 50001, msg: 'index unavailable' }));
    await ui.authorize();
    await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow('Search failed');
  });
  it('rejects a malformed response instead of treating it as empty results', async () => {
    const ui = install(() => envelope({ items: [] })); await ui.authorize();
    await expect(ui.window.__okwNavigationSearch({ query: 'fixture' })).rejects.toThrow('Invalid search response');
  });
});
describe('navigation authorization sharing', () => {
  it('shares only the current in-memory authorization with the workspace API', async () => {
    const ui = install();
    expect(ui.window.__okwNavigationAuthorization()).toBe('');
    await ui.authorize();
    expect(ui.window.__okwNavigationAuthorization()).toBe('Bearer fictional-only');
    await ui.window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-next' } });
    expect(ui.window.__okwNavigationAuthorization()).toBe('Bearer fictional-next');
  });
});
