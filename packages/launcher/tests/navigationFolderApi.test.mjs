import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const sources = ['navigationApi.js', 'navigationFolderApi.js']
  .map((name) => readFileSync(new URL(`../src/mobile/${name}`, import.meta.url), 'utf8'));
const envelope = (data, code = 0) => Response.json({ code, data });
const dir = (path) => ({ name: path.split(/[\\/]/).pop(), path, is_dir: true });
const listing = (path = '/fixture', parent = '/', entries = [dir('/fixture/demo')]) =>
  envelope({ path, parent, entries });
const english = (_, en) => en;
const chinese = (zh) => zh;
function install({ get = () => listing(), locale = english } = {}) {
  const native = vi.fn((url, options) => (url === '/api/v1/meta'
    ? envelope({ server_version: '2.6.1' }) : get({ url, options })));
  const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  const logger = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const window = { fetch: native, __okwLocale: { text: locale }, localStorage: storage };
  const context = { window, location: { href: 'http://fixture.invalid/', origin: 'http://fixture.invalid' },
    URL, Request, Headers, Error, console: logger };
  sources.forEach((source) => runInNewContext(source, context));
  const authorize = () => window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-only' } });
  const calls = () => native.mock.calls.filter(([url]) => url.startsWith('/api/v1/fs:browse'));
  return { window, native, storage, logger, authorize, calls, browse: (...args) => window.__okwNavigationBrowseFolder(...args) };
}
describe('official folder browse API', () => {
  it('browses the server home with a header-bearing same-origin GET and no query', async () => {
    const ui = install(); await ui.authorize(); ui.native.mockClear();
    const controller = new AbortController();
    const expected = { path: '/fixture', parent: '/', entries: [dir('/fixture/demo')] };
    expect(await ui.browse(undefined, controller.signal)).toEqual(expected);
    expect(ui.calls()).toHaveLength(1);
    const [url, options] = ui.calls()[0];
    expect(url).toBe('/api/v1/fs:browse');
    expect(options.method).toBe('GET');
    expect(options.headers).toEqual({ authorization: 'Bearer fictional-only' });
    expect(options.cache).toBe('no-store');
    expect(options.signal).toBe(controller.signal);
  });
  it.each([
    ['plain POSIX', '/srv/fixture', '/api/v1/fs:browse?path=%2Fsrv%2Ffixture'],
    ['spaces', '/srv/fixture project/demo', '/api/v1/fs:browse?path=%2Fsrv%2Ffixture%20project%2Fdemo'],
    ['Windows drive', 'C:\\Fixture Projects\\demo', '/api/v1/fs:browse?path=C%3A%5CFixture%20Projects%5Cdemo'],
    ['UNC', '\\\\server\\share\\Fixture Projects', '/api/v1/fs:browse?path=%5C%5Cserver%5Cshare%5CFixture%20Projects'],
    ['reserved characters', "/srv/a?b&c#d=é'é", `/api/v1/fs:browse?path=${encodeURIComponent("/srv/a?b&c#d=é'é")}`],
  ])('encodes the official path query for %s', async (_, path, expected) => {
    const ui = install(); await ui.authorize(); ui.native.mockClear();
    await ui.browse(path);
    expect(ui.calls()).toHaveLength(1);
    const [url] = ui.calls()[0];
    expect(url).toBe(expected);
    expect(url.split('?')).toHaveLength(2);
    expect(decodeURIComponent(url.slice('/api/v1/fs:browse?path='.length))).toBe(path);
  });
  it('keeps the official listing shape including a null parent at the root and an empty directory', async () => {
    const ui = install({ get: () => listing('/home/kimi', null, []) }); await ui.authorize();
    const result = await ui.browse(undefined);
    expect(Object.keys(result)).toEqual(['path', 'parent', 'entries']);
    expect(result).toEqual({ path: '/home/kimi', parent: null, entries: [] });
  });
  it('passes an already-aborted signal through to the official GET', async () => {
    const controller = new AbortController(); controller.abort();
    const ui = install({ get: ({ options }) => { options.signal.throwIfAborted(); } }); await ui.authorize();
    await expect(ui.browse('/fixture', controller.signal)).rejects.toThrow();
    expect(ui.calls()).toHaveLength(1);
    expect(ui.calls()[0][1].signal).toBe(controller.signal);
  });
  it('browses on every call without caching listings, paths, tokens or console noise', async () => {
    const ui = install(); await ui.authorize(); ui.native.mockClear();
    await ui.browse('/fixture'); await ui.browse(undefined); await ui.browse('/fixture');
    expect(ui.calls()).toHaveLength(3);
    for (const [url, options] of ui.calls()) {
      expect(url.startsWith('/api/v1/fs:browse')).toBe(true);
      expect(options.method).toBe('GET');
      expect(options.cache).toBe('no-store');
    }
    expect(ui.native.mock.calls.every(([url]) => url === '/api/v1/meta' || url.startsWith('/api/v1/fs:browse'))).toBe(true);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.storage.removeItem).not.toHaveBeenCalled();
    expect(ui.storage.clear).not.toHaveBeenCalled();
    expect(Object.values(ui.logger).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});
describe('folder browse listing validation', () => {
  it.each([
    ['missing data', undefined],
    ['empty path', { path: '', parent: null, entries: [] }],
    ['empty parent', { path: '/fixture', parent: '', entries: [] }],
    ['missing parent', { path: '/fixture', entries: [] }],
    ['non-list entries', { path: '/fixture', parent: null, entries: null }],
    ['empty entry name', { path: '/fixture', parent: null, entries: [{ name: '', path: '/fixture/a', is_dir: true }] }],
    ['empty entry path', { path: '/fixture', parent: null, entries: [{ name: 'a', path: '', is_dir: true }] }],
    ['missing is_dir', { path: '/fixture', parent: null, entries: [{ name: 'a', path: '/fixture/a' }] }],
    ['non-directory entry', { path: '/fixture', parent: null, entries: [{ name: 'a', path: '/fixture/a', is_dir: false }] }],
  ])('throws on an invalid listing instead of faking a directory (%s)', async (_, data) => {
    const ui = install({ get: () => envelope(data) }); await ui.authorize();
    await expect(ui.browse('/fixture')).rejects.toThrow('Invalid folder browse response');
  });
  it.each([['', 'empty string'], [null, 'null'], [42, 'a number'], [{}, 'an object']])(
    'rejects the out-of-contract path %j without a request', async (path) => {
      const ui = install(); await ui.authorize(); ui.native.mockClear();
      await expect(ui.browse(path)).rejects.toThrow('valid directory path');
      expect(ui.native).not.toHaveBeenCalled();
    },
  );
});
describe('folder browse failure explanations', () => {
  it.each([401, 403, 404, 503])('explains an HTTP %s without echoing backend details', async (status) => {
    const ui = install({ get: () => new Response('{"msg":"private server path"}', { status }) }); await ui.authorize();
    const result = ui.browse('/fixture');
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toThrow('private server path');
  });
  it.each([
    [401, 'Authorization expired'],
    [403, 'not browsable'],
    [404, 'does not exist'],
    [503, 'right now'],
  ])('maps HTTP %s to a distinct %s explanation in English', async (status, fragment) => {
    const ui = install({ get: () => new Response('{}', { status }) }); await ui.authorize();
    await expect(ui.browse('/fixture')).rejects.toThrow(fragment);
  });
  it('explains failures in Chinese when the page locale is Chinese', async () => {
    const ui = install({ get: () => new Response('{"msg":"private server path"}', { status: 500 }), locale: chinese });
    await ui.authorize();
    await expect(ui.browse('/fixture')).rejects.toThrow('浏览文件夹失败');
    const unready = install({ locale: chinese });
    await expect(unready.browse(undefined)).rejects.toThrow('页面授权尚未就绪');
  });
  it('reports an unparseable or failed envelope without leaking the payload', async () => {
    const ui = install({ get: () => new Response('not json') }); await ui.authorize();
    await expect(ui.browse('/fixture')).rejects.toThrow('Could not browse folders');
    const failed = install({ get: () => Response.json({ code: 40409, msg: 'private server path' }, { status: 400 }) });
    await failed.authorize();
    const result = failed.browse('/fixture');
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toThrow('private server path');
  });
  it('does not browse without observed official authorization and never falls back to anonymous', async () => {
    const ui = install();
    await expect(ui.browse('/fixture')).rejects.toThrow('Authorization is not ready');
    expect(ui.native).not.toHaveBeenCalled();
  });
});
