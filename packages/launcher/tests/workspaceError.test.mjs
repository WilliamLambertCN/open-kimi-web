import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/presentation.js', import.meta.url), 'utf8');

function install(nativeFetch, language = 'zh-CN') {
  const window = {
    fetch: nativeFetch,
    matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    addEventListener: vi.fn(),
  };
  const document = {
    documentElement: { lang: '' },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  class MutationObserver {
    observe() {}
  }
  runInNewContext(source, {
    Array,
    Headers,
    Map,
    MutationObserver,
    navigator: { language },
    Request,
    Response,
    URL,
    WeakMap,
    WeakSet,
    decodeURIComponent,
    document,
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    window,
  });
  return window.fetch;
}

describe('missing workspace explanation', () => {
  it('localizes only a session-create 40409 without changing its error fields or request', async () => {
    const requestBody = JSON.stringify({
      workspace_id: 'wd_missing_000000000000',
      metadata: { cwd: 'C:\\projects\\missing' },
    });
    const original = {
      code: 40409,
      msg: 'workspace root C:\\projects\\missing does not exist',
      data: null,
      request_id: 'request-1',
      details: { source: 'server' },
    };
    const nativeFetch = vi.fn(async () => new Response(JSON.stringify(original), {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' },
    }));
    const fetch = install(nativeFetch);

    const result = await fetch('/api/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    });
    const body = await result.json();

    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(nativeFetch.mock.calls[0][0]).toBe('/api/v1/sessions');
    expect(nativeFetch.mock.calls[0][1].body).toBe(requestBody);
    expect(result.status).toBe(404);
    expect(result.statusText).toBe('Not Found');
    expect(result.headers.get('x-request-id')).toBe('request-1');
    expect(body).toMatchObject({
      code: original.code,
      data: original.data,
      request_id: original.request_id,
      details: original.details,
    });
    expect(body.msg).toContain('工作区目录不存在');
    expect(body.msg).toContain('恢复原目录');
    expect(body.msg).toContain('旧会话和配置仍保留');
    expect(body.msg).toContain(original.msg);
  });

  it('passes unrelated responses through unchanged', async () => {
    const original = new Response(JSON.stringify({ code: 40409, msg: 'other request' }));
    const fetch = install(vi.fn(async () => original));

    expect(await fetch('/api/v1/workspaces', { method: 'POST' })).toBe(original);
  });

  it('passes other session-create errors through unchanged', async () => {
    const original = new Response(JSON.stringify({ code: 40001, msg: 'invalid request' }));
    const fetch = install(vi.fn(async () => original));

    expect(await fetch('/api/v1/sessions', { method: 'POST' })).toBe(original);
  });
});
