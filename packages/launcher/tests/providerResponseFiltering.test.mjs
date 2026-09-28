import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const sortingSource = readFileSync(new URL('../src/mobile/providerSorting.js', import.meta.url), 'utf8');
const enhancementSource = readFileSync(new URL('../src/mobile/providerEnhancements.js', import.meta.url), 'utf8');

function install(responseFor) {
  const nativeFetch = vi.fn(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    return responseFor(url, init);
  });
  const window = { fetch: nativeFetch, addEventListener() {} };
  const document = {
    documentElement: { lang: 'en' },
    querySelectorAll: () => [],
  };
  class MutationObserver {
    observe() {}
  }
  const context = {
    document,
    Headers,
    location: { href: 'http://localhost/settings', origin: 'http://localhost' },
    MutationObserver,
    navigator: { language: 'en' },
    queueMicrotask,
    Request,
    URL,
    window,
  };
  runInNewContext(sortingSource, context);
  runInNewContext(enhancementSource, context);
  return window.fetch;
}

describe('provider response filtering', () => {
  it.each([
    ['/api/v1/meta', 'GET'],
    ['/api/v1/workspaces', 'GET'],
    ['/api/v1/sessions/session-fixture', 'GET'],
    ['/api/v1/unrelated', 'GET'],
    ['/api/v1/config/extra', 'GET'],
    ['/api/v1/config', 'POST'],
    ['https://other.invalid/api/v1/config', 'GET'],
  ])('skips clone and JSON parsing for %s %s', async (url, method) => {
    const json = vi.fn(async () => ({}));
    const clone = vi.fn(() => ({ json }));
    const fetch = install(() => ({ ok: true, clone }));

    await fetch(url, { method });

    expect(clone).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('does not clone a non-JSON response from an unrelated endpoint', async () => {
    const response = new Response('plain text', { headers: { 'content-type': 'text/plain' } });
    const clone = vi.spyOn(response, 'clone');
    const fetch = install(() => response);

    await fetch('/api/v1/plain-text');

    expect(clone).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/v1/config', { data: { models: { fixture: { provider: 'fixture', model: 'model-a' } } } }],
    ['/api/v1/models', { data: { items: [{ provider: 'fixture', model: 'model-a' }] } }],
  ])('still reads model data from %s', async (url, body) => {
    const json = vi.fn(async () => body);
    const clone = vi.fn(() => ({ json }));
    const fetch = install(() => ({ ok: true, clone }));

    await fetch(url);
    await Promise.resolve();

    expect(clone).toHaveBeenCalledOnce();
    expect(json).toHaveBeenCalledOnce();
  });
});
