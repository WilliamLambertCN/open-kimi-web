import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const sources = ['navigationApi.js', 'navigationWorkspaceApi.js']
  .map((name) => readFileSync(new URL(`../src/mobile/${name}`, import.meta.url), 'utf8'));
const envelope = (data, code = 0) => Response.json({ code, data });
const workspace = (root = '/fixture', id = 'fictional') => ({ id, root, name: 'Fixture', kind: 'managed',
  additional_dirs: [], created_at: '2026-01-01T00:00:00Z', last_opened_at: '2026-01-01T00:00:00Z', session_count: 0 });
function install({ items = [], post = (body) => envelope(workspace(body.root)), get = () => envelope({ items }) } = {}) {
  const native = vi.fn((url, options) => {
    if (url === '/api/v1/meta') return envelope({ server_version: '2.6.1' });
    expect(url).toBe('/api/v1/workspaces');
    return options.method === 'POST' ? post(JSON.parse(options.body), options) : get(options);
  });
  const window = { fetch: native, __okwLocale: { text: (_, en) => en } };
  const context = { window, location: { href: 'http://fixture.invalid/', origin: 'http://fixture.invalid' },
    URL, Request, Headers, Error, TextEncoder };
  sources.forEach((source) => runInNewContext(source, context));
  const authorize = () => window.fetch('/api/v1/meta', { headers: { authorization: 'Bearer fictional-only' } });
  return { window, native, context, authorize, add: (...args) => window.__okwNavigationAddWorkspace(...args) };
}
const posts = (ui) => ui.native.mock.calls.filter(([, options]) => options.method === 'POST');
describe('official workspace registration API', () => {
  it('checks the official list then registers a new directory with a stable bounded idempotency key', async () => {
    const ui = install(); await ui.authorize(); ui.native.mockClear();
    const controller = new AbortController();
    expect(await ui.add(' /fixture ', controller.signal)).toEqual({ existing: false, workspace: workspace() });
    expect(ui.native.mock.calls.map(([, options]) => options.method)).toEqual(['GET', 'POST']);
    for (const [url, options] of ui.native.mock.calls) {
      expect(url).toBe('/api/v1/workspaces'); expect(options.signal).toBe(controller.signal);
      expect(options.headers.authorization).toBe('Bearer fictional-only'); expect(options.cache).toBe('no-store');
    }
    const body = JSON.parse(posts(ui)[0][1].body);
    expect(body.root).toBe('/fixture'); expect(body.idempotency_key).toMatch(/^okw-workspace-v1:[a-f0-9]{32}$/);
    expect(body.idempotency_key.length).toBeLessThanOrEqual(200);
    expect(body.idempotency_key).not.toContain('fixture');
    expect(Object.keys(body)).toEqual(['root', 'idempotency_key']);
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
  ])('preserves %s for official server validation', async (_, input, root) => {
    const ui = install(); await ui.authorize();
    const result = await ui.add(input);
    expect(result.workspace.root).toBe(root);
    expect(JSON.parse(posts(ui)[0][1].body).root).toBe(root);
  });
  it.each([
    ['C:\\Fixture Projects\\demo', 'c:/fixture projects/demo///'],
    ['C:\\', 'c:/'],
    ['\\\\server\\share\\Fixture\\', '//SERVER/share/fixture'],
    ['/srv/fixture/', '/srv/fixture'],
    ['/', '/'],
  ])('does not POST an existing equivalent root %j / %j', async (saved, input) => {
    const ui = install({ items: [workspace(saved)] }); await ui.authorize();
    expect(await ui.add(input)).toEqual({ existing: true }); expect(posts(ui)).toHaveLength(0);
  });
  it.each([
    ['/srv/Fixture', '/srv/fixture'],
    ['/srv/other/demo', '/srv/project/demo'],
    ['/srv/a\\b', '/srv/a/b'],
    ['/srv/a/../b', '/srv/b'],
    ['C:/fixture', 'D:/fixture'],
    ['/srv', '/'],
  ])('keeps distinct roots separate %j / %j', async (saved, input) => {
    const ui = install({ items: [workspace(saved)] }); await ui.authorize();
    expect((await ui.add(input)).existing).toBe(false); expect(posts(ui)).toHaveLength(1);
  });
  it('preserves multiple old matches without selecting, deleting or merging any of them', async () => {
    const items = [workspace('/fixture', 'first'), workspace('/fixture', 'second')];
    const ui = install({ items }); await ui.authorize();
    expect(await ui.add('/fixture')).toEqual({ existing: true }); expect(items).toHaveLength(2);
    expect(posts(ui)).toHaveLength(0);
  });
  it('freshly reads the list on repeated additions instead of caching workspace identity', async () => {
    const items = [];
    const ui = install({ items, post: (body) => {
      const item = workspace(body.root); items.push(item); return envelope(item);
    } });
    await ui.authorize(); expect((await ui.add('/fixture')).existing).toBe(false);
    expect(await ui.add('/fixture/')).toEqual({ existing: true }); expect(posts(ui)).toHaveLength(1);
    items.length = 0;
    expect((await ui.add('/fixture')).existing).toBe(false); expect(posts(ui)).toHaveLength(2);
  });
});
describe('workspace idempotency and validation', () => {
  it('uses the same official key across tabs, retries and normalized Windows paths without secure-context crypto', async () => {
    const keys = [];
    for (const root of ['C:\\Fixture\\demo', 'c:/fixture/demo/']) {
      const ui = install(); await ui.authorize(); await ui.add(root);
      keys.push(JSON.parse(posts(ui)[0][1].body).idempotency_key);
    }
    expect(keys[0]).toBe(keys[1]);
    const ui = install(); await ui.authorize(); await ui.add('/srv/Fixture'); await ui.add('/srv/fixture');
    expect(JSON.parse(posts(ui)[0][1].body).idempotency_key).not.toBe(JSON.parse(posts(ui)[1][1].body).idempotency_key);
  });
  it('lets the official idempotency key resolve concurrent registrations even when both lists were empty', async () => {
    const keys = new Map();
    const ui = install({ post: (body) => {
      if (!keys.has(body.idempotency_key)) keys.set(body.idempotency_key, workspace(body.root, 'created-once'));
      return envelope(keys.get(body.idempotency_key));
    } });
    await ui.authorize();
    const results = await Promise.all([ui.add('C:\\Fixture'), ui.add('c:/fixture/')]);
    expect(results.map((result) => result.workspace.id)).toEqual(['created-once', 'created-once']);
    expect(keys.size).toBe(1); expect(posts(ui)).toHaveLength(2);
  });
  it('reuses the official key after an unknown POST outcome instead of silently retrying without it', async () => {
    let lost = true;
    const ui = install({ post: (body) => {
      if (lost) { lost = false; throw new TypeError('Fictional network interruption'); }
      return envelope(workspace(body.root));
    } });
    await ui.authorize(); await expect(ui.add('/fixture')).rejects.toThrow('network interruption');
    expect(posts(ui)).toHaveLength(1); await ui.add('/fixture');
    expect(JSON.parse(posts(ui)[0][1].body)).toEqual(JSON.parse(posts(ui)[1][1].body));
  });
  it.each(['', '  \n\t ', '""', " '' "])('does not request an empty normalized root (%j)', async (input) => {
    const ui = install(); await ui.authorize(); ui.native.mockClear();
    await expect(ui.add(input)).rejects.toThrow('absolute directory path'); expect(ui.native).not.toHaveBeenCalled();
  });
  it('does not read or create workspaces without observed official authorization', async () => {
    const ui = install(); await expect(ui.add('/fixture')).rejects.toThrow('Authorization is not ready');
    expect(ui.native).not.toHaveBeenCalled();
  });
  it.each([{}, { items: null }, { items: [{}] }, { items: [workspace(), { id: 'invalid' }] }])(
    'fails closed when the workspace list is invalid (%j)', async (data) => {
      const ui = install({ get: () => envelope(data) }); await ui.authorize();
      await expect(ui.add('/fixture')).rejects.toThrow('Invalid workspace response'); expect(posts(ui)).toHaveLength(0);
    },
  );
  it('does not POST if the list request failed or was canceled', async () => {
    const controller = new AbortController(); controller.abort();
    const ui = install({ get: ({ signal }) => { signal.throwIfAborted(); } }); await ui.authorize();
    await expect(ui.add('/fixture', controller.signal)).rejects.toThrow(); expect(posts(ui)).toHaveLength(0);
  });
  it.each([[40001, 'absolute'], [40409, 'not exist'], [50001, 'Could not add']])(
    'reports official POST validation %s without leaking backend details', async (code, message) => {
      const ui = install({ post: () => Response.json({ code, msg: 'private server path' }) }); await ui.authorize();
      const result = ui.add('/fixture'); await expect(result).rejects.toThrow(message);
      await expect(result).rejects.not.toThrow('private server path');
    },
  );
  it.each(['GET', 'POST'])('reports expired %s authorization without another mutation', async (method) => {
    for (const status of [401, 403]) {
      const failure = () => new Response('{}', { status });
      const ui = install(method === 'GET' ? { get: failure } : { post: failure }); await ui.authorize();
      await expect(ui.add('/fixture')).rejects.toThrow('Authorization expired');
      expect(posts(ui)).toHaveLength(method === 'GET' ? 0 : 1);
    }
  });
  it.each([{}, { id: '', root: '/fixture' }, { id: 42, root: '/fixture' }, { id: 'fictional', root: null },
    { id: 'fictional', root: '/other' }])('rejects invalid or mismatched created workspaces (%j)', async (data) => {
    const ui = install({ post: () => envelope(data) }); await ui.authorize();
    await expect(ui.add('/fixture')).rejects.toThrow('Invalid workspace response'); expect(posts(ui)).toHaveLength(1);
  });
  it.each(['GET', 'POST'])('rejects invalid JSON at %s without reporting success', async (method) => {
    const invalid = () => new Response('not json');
    const ui = install(method === 'GET' ? { get: invalid } : { post: invalid }); await ui.authorize();
    await expect(ui.add('/fixture')).rejects.toThrow('Could not add');
    expect(posts(ui)).toHaveLength(method === 'GET' ? 0 : 1);
  });
});
