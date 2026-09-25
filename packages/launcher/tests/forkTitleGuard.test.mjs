import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { addMobilePresentation } from '../src/officialPresentation.mjs';

const source = readFileSync(new URL('../src/mobile/forkTitleGuard.js', import.meta.url), 'utf8');
const origin = 'https://web.example';
const titleUrl = `${origin}/api/v1/sessions/fork-1/title/generate`;
const lookupUrl = `${origin}/api/v1/sessions/fork-1`;

function envelope(data) {
  return new Response(JSON.stringify({ code: 0, msg: 'success', data, request_id: 'upstream-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function install(nativeFetch) {
  const window = { fetch: nativeFetch };
  const context = {
    window,
    location: { origin, href: `${origin}/sessions/fork-1` },
    URL,
    Request,
    Headers,
    Response,
    Symbol,
  };
  runInNewContext(source, context);
  return { window, context };
}

describe('official fork title guard', () => {
  it('loads before the official module and answers automatic generation with the current fork title', async () => {
    const html = '<head><script type="module" src="/assets/index.js"></script></head>';
    const injected = addMobilePresentation(html);
    expect(injected.indexOf('/__open-kimi-mobile/forkTitleGuard.js'))
      .toBeLessThan(injected.indexOf('<script type="module"'));

    const nativeFetch = vi.fn(async () => envelope({ id: 'fork-1', title: 'Fork: Fix login bug' }));
    const { window } = install(nativeFetch);
    const response = await window.fetch(titleUrl, {
      method: 'POST',
      body: JSON.stringify({ source: 'first_turn' }),
      headers: { Authorization: 'Bearer test-token', 'X-Request-Id': 'request-1' },
    });

    expect(await response.json()).toEqual({
      code: 0,
      msg: 'success',
      data: { title: 'Fork: Fix login bug' },
      request_id: 'request-1',
    });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(nativeFetch.mock.calls[0][0]).toBe(lookupUrl);
    expect(nativeFetch.mock.calls[0][1].headers.get('authorization')).toBe('Bearer test-token');
    expect(nativeFetch.mock.calls[0][1].headers.has('x-request-id')).toBe(false);
  });

  it('checks the current server title after a fresh page load, including a fork made elsewhere', async () => {
    const nativeFetch = vi.fn(async () => envelope({ id: 'fork-1', title: 'Fork: Source' }));
    const firstPage = install(nativeFetch);
    const secondPage = install(nativeFetch);

    await firstPage.window.fetch(titleUrl, { method: 'POST', body: '{}' });
    const response = await secondPage.window.fetch(titleUrl, { method: 'POST', body: '{}' });

    expect((await response.json()).data.title).toBe('Fork: Source');
    expect(nativeFetch.mock.calls.map(([url]) => url)).toEqual([lookupUrl, lookupUrl]);
  });

  it('passes through ordinary sessions, renamed forks, and manual regeneration', async () => {
    const nativeFetch = vi.fn(async (url) => url === lookupUrl
      ? envelope({ id: 'fork-1', title: 'Renamed branch' })
      : envelope({ title: 'Generated title' }));
    const { window } = install(nativeFetch);
    const autoInit = { method: 'POST', body: '{"source":"first_turn"}' };

    expect((await (await window.fetch(titleUrl, autoInit)).json()).data.title).toBe('Generated title');
    expect(nativeFetch.mock.calls[1]).toEqual([titleUrl, autoInit]);

    const forced = { method: 'POST', body: '{"force":true,"source":"digest"}' };
    expect((await (await window.fetch(titleUrl, forced)).json()).data.title).toBe('Generated title');
    expect(nativeFetch.mock.calls[2]).toEqual([titleUrl, forced]);
  });
});

describe('fork title guard failure boundaries', () => {
  it('keeps official validation and forwards a failed lookup only once', async () => {
    const nativeFetch = vi.fn(async (url) => {
      if (url === lookupUrl) throw new Error('lookup unavailable');
      return envelope({ title: 'Upstream result' });
    });
    const { window } = install(nativeFetch);

    const invalid = { method: 'POST', body: '{"source":"invalid"}' };
    await window.fetch(titleUrl, invalid);
    expect(nativeFetch.mock.calls[0]).toEqual([titleUrl, invalid]);

    const automatic = { method: 'POST', body: '{"source":"first_turn"}' };
    await window.fetch(titleUrl, automatic);
    expect(nativeFetch.mock.calls.slice(1).map(([url]) => url)).toEqual([lookupUrl, titleUrl]);
  });

  it('supports Request input without consuming its body, and leaves unrelated failures untouched', async () => {
    const nativeFetch = vi.fn(async (input) => {
      if (input === lookupUrl) return envelope({ id: 'fork-1', title: 'Fork: Source' });
      throw new Error('upstream failure');
    });
    const { window } = install(nativeFetch);
    const request = new Request(titleUrl, { method: 'POST', body: '{"source":"first_turn"}' });

    expect((await (await window.fetch(request)).json()).data.title).toBe('Fork: Source');
    expect(await request.text()).toBe('{"source":"first_turn"}');
    await expect(window.fetch(`${origin}/api/v1/sessions/fork-1:fork`, { method: 'POST' }))
      .rejects.toThrow('upstream failure');
    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it('does not wrap fetch twice when the presentation script executes again', async () => {
    const nativeFetch = vi.fn(async () => envelope({ id: 'fork-1', title: 'Fork: Source' }));
    const { window, context } = install(nativeFetch);
    const firstWrapper = window.fetch;
    runInNewContext(source, context);

    expect(window.fetch).toBe(firstWrapper);
    await window.fetch(titleUrl, { method: 'POST', body: '{}' });
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
});
