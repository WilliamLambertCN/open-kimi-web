import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../src/mobile/mobileSubagentModelApi.js', import.meta.url), 'utf8');
const envelope = (data, extra = {}) => new Response(JSON.stringify({
  code: 0, msg: 'success', data, request_id: 'fixture', ...extra,
}), { status: 200 });
const model = (id, extra = {}) => ({ id, capabilities: ['thinking'], supportEfforts: ['low', 'medium', 'high'], ...extra });
const config = (section) => ({
  default_model: 'fixture/main', default_permission_mode: 'manual', hooks: ['fixture'],
  models: { 'fixture/fast': { capabilities: ['thinking'], supportEfforts: ['medium'] } },
  secondary_model: section, providers: {},
});

function install() {
  const nativeFetch = vi.fn(async () => envelope({}));
  class XHR {
    open = vi.fn();
    setRequestHeader = vi.fn();
  }
  XHR.prototype.open = vi.fn();
  XHR.prototype.setRequestHeader = vi.fn();
  const window = { fetch: nativeFetch, XMLHttpRequest: XHR };
  const context = {
    window, URL, Request, Headers, Response, Symbol,
    location: { href: 'https://example.test/', origin: 'https://example.test' },
    localStorage: { getItem: vi.fn(), setItem: vi.fn() }, console: { log: vi.fn(), error: vi.fn() },
  };
  runInNewContext(source, context);
  const authorize = (url = '/api/v1/meta', authorization = 'Bearer fixture-token') =>
    window.fetch(url, { headers: { authorization } });
  return { ...context, nativeFetch, api: window.__okwMobileSubagentApi, authorize };
}

describe('subagent config wire and patch semantics', () => {
  it('sends only the outer snake-case section with inner camel-case fields', () => {
    const { api } = install();
    expect(api.patchFor(undefined, { model: 'fixture/fast', effort: 'medium' }, [model('fixture/fast')]))
      .toEqual({ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
  });
  it('retains every model-pool description and adds a newly selected alias without modifying input', () => {
    const { api } = install();
    const section = { defaultModel: 'fixture/slow', models: { 'fixture/slow': 'Preserve me' }, force: false };
    const models = [model('fixture/slow'), model('fixture/fast')];
    expect(api.patchFor(section, { model: 'fixture/fast', effort: 'medium' }, models)).toEqual({
      secondary_model: { defaultModel: 'fixture/fast', defaultEffort: 'medium',
        models: { 'fixture/slow': 'Preserve me', 'fixture/fast': '' } },
    });
    expect(section.models).toEqual({ 'fixture/slow': 'Preserve me' });
    expect(api.patchFor(section, { model: 'fixture/slow', effort: '' }, models)).toBeNull();
  });
  it('does not pretend an empty model selection can clear a merged model', () => {
    const { api } = install();
    const choice = { model: '', effort: '' };
    expect(api.patchFor(undefined, choice, [])).toBeNull();
    for (const section of [{ defaultModel: 'fixture/fast' }, { model: 'fixture/fast' }, { models: {} }]) {
      expect(() => api.patchFor(section, choice, [])).toThrow('cannotFollow');
    }
  });
  it('uses actual config aliases and catalog snake-case metadata, not provider IDs guessed from labels', () => {
    const { api } = install();
    const result = api.modelsFor({ models: {
      custom: { provider: 'fixture', model: 'upstream-id', displayName: 'Alias', adaptiveThinking: true },
      primary: {}, malformed: null,
    } }, { items: [{ model: 'fixture/fast', provider: 'fixture', display_name: 'Fast',
      support_efforts: ['medium'], capabilities: ['always_thinking'] }] });
    expect(result.map(({ id }) => id)).toEqual(['custom', 'fixture/fast']);
    expect(result[0]).toMatchObject({ provider: 'fixture', modelId: 'upstream-id' });
    expect(result[1]).toMatchObject({ provider: 'fixture', modelId: 'fixture/fast' });
    expect(api.effortsFor(result[0])).toEqual(['on', 'off']);
    expect(api.effortsFor(result[1])).toEqual(['on', 'medium']);
  });
});

describe('subagent model metadata and effort compatibility', () => {
  it('retains distinct providers and upstream IDs when configured aliases share a display name', () => {
    const { api } = install();
    const result = api.modelsFor({ models: {
      alpha: { provider: 'old-provider', model: 'upstream-a', displayName: 'Same name' },
      beta: { provider: 'provider-b', model: 'upstream-b', displayName: 'Same name' },
      'provider-looking/alias': { displayName: 'Same name' },
    } }, { items: [{ provider: 'provider-a', model: 'alpha', display_name: 'Same name', max_context_size: 1000 },
      { provider: 'provider-b', model: 'beta', display_name: 'Same name', max_context_size: 1000 }] });
    expect(result.find(({ id }) => id === 'alpha'))
      .toMatchObject({ id: 'alpha', provider: 'provider-a', modelId: 'upstream-a', label: 'Same name' });
    expect(result.find(({ id }) => id === 'beta'))
      .toMatchObject({ id: 'beta', provider: 'provider-b', modelId: 'upstream-b', label: 'Same name' });
    expect(result.find(({ id }) => id === 'provider-looking/alias').provider).toBe('');
    expect(result).toHaveLength(3);
  });
  it('follows official thinking metadata and intersects explicit efforts across a retained pool', () => {
    const { api } = install();
    expect(api.effortsFor(model('a'))).toEqual(['off', 'on', 'low', 'medium', 'high']);
    expect(api.effortsFor(model('a', { capabilities: ['always_thinking'] }))).toEqual(['on', 'low', 'medium', 'high']);
    expect(api.effortsFor(model('a', { capabilities: [], supportEfforts: [] }))).toEqual(['off']);
    expect(api.effortsFor(undefined)).toEqual([]);
    const section = { models: { b: '' } };
    const models = [model('a'), model('b', { capabilities: ['always_thinking'], supportEfforts: ['medium'] })];
    expect(api.availableEfforts(section, 'a', models)).toEqual(['on', 'medium']);
    expect(() => api.patchFor(section, { model: 'a', effort: 'off' }, models)).toThrow('effortUnsupported');
    expect(() => api.patchFor(undefined, { model: 'missing', effort: '' }, models)).toThrow('modelMissing');
  });
  it('allows on when low/high pool efforts have no intersection but never disables an always-thinking member', () => {
    const { api } = install();
    const section = { defaultModel: 'low', models: { low: 'Low only', high: 'High only' } };
    const models = [model('low', { supportEfforts: ['low'] }),
      model('high', { alwaysThinking: true, supportEfforts: ['high'] })];
    expect(api.availableEfforts(section, 'low', models)).toEqual(['on']);
    expect(api.availableEfforts(section, 'high', models)).toEqual(['on']);
    expect(api.patchFor(section, { model: 'low', effort: 'on' }, models))
      .toEqual({ secondary_model: { defaultModel: 'low', defaultEffort: 'on' } });
    for (const effort of ['off', 'low', 'high']) {
      expect(() => api.patchFor(section, { model: 'low', effort }, models)).toThrow('effortUnsupported');
    }
    expect(api.patchFor({ ...section, defaultEffort: 'on' }, { model: 'low', effort: '' }, models))
      .toEqual({ secondary_model: { defaultModel: 'low', defaultEffort: '' } });
  });
});

describe('subagent authenticated API', () => {
  it('waits for observed same-origin authorization without reading credential storage', async () => {
    const ui = install();
    await expect(ui.api.load()).rejects.toThrow('authPending');
    await ui.authorize('https://elsewhere.test/api/v1/config');
    await expect(ui.api.load()).rejects.toThrow('authPending');
    await ui.authorize();
    ui.nativeFetch.mockResolvedValueOnce(envelope(config(undefined))).mockResolvedValueOnce(envelope({ items: [] }));
    await expect(ui.api.load()).resolves.toMatchObject({ models: [{ id: 'fixture/fast' }] });
    expect(ui.nativeFetch.mock.calls.slice(-2).map(([path]) => path)).toEqual(['/api/v1/config', '/api/v1/models']);
    expect(ui.localStorage.getItem).not.toHaveBeenCalled();
    expect(ui.localStorage.setItem).not.toHaveBeenCalled();
    expect(ui.console.log).not.toHaveBeenCalled();
  });
  it('captures Request/init header precedence, XHR authorization and installs just once', async () => {
    const ui = install();
    await ui.window.fetch(new Request('https://example.test/api/v1/meta', {
      headers: { authorization: 'Bearer original' },
    }), { headers: { authorization: 'Bearer replacement' } });
    runInNewContext(source, ui);
    ui.nativeFetch.mockResolvedValueOnce(envelope(config(undefined))).mockResolvedValueOnce(envelope({ items: [] }));
    await ui.api.load();
    expect(ui.nativeFetch.mock.calls.at(-1)[1].headers.authorization).toBe('Bearer replacement');
    const xhr = Object.create(ui.window.XMLHttpRequest.prototype);
    xhr.open('GET', '/api/v1/meta');
    xhr.setRequestHeader('Authorization', 'Bearer xhr-fixture');
    ui.nativeFetch.mockResolvedValueOnce(envelope(config(undefined))).mockResolvedValueOnce(envelope({ items: [] }));
    await ui.api.load();
    expect(ui.nativeFetch.mock.calls.at(-1)[1].headers.authorization).toBe('Bearer xhr-fixture');
  });
  it('re-reads config before saving, posts a precise patch, and verifies returned effective fields', async () => {
    const ui = install();
    await ui.authorize();
    const before = config({ models: { 'fixture/fast': 'New description' }, defaultModel: 'fixture/fast' });
    const saved = config({ ...before.secondary_model, defaultEffort: 'medium' });
    ui.nativeFetch.mockResolvedValueOnce(envelope(before)).mockResolvedValueOnce(envelope({ items: [] }))
      .mockResolvedValueOnce(envelope(saved));
    await ui.api.save({ model: 'fixture/fast', effort: 'medium' });
    const [path, options] = ui.nativeFetch.mock.calls.at(-1);
    expect(path).toBe('/api/v1/config');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: 'medium' } });
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('same-origin');
    expect(saved.hooks).toEqual(['fixture']);
    expect(() => ui.api.verifySaved(before, { model: 'fixture/fast', effort: 'medium' })).toThrow('saveMismatch');
  });
});

describe('subagent automatic effort persistence', () => {
  it('posts an explicit empty effort to restore automatic thinking and verifies the returned value', async () => {
    const ui = install();
    await ui.authorize();
    const before = config({ defaultModel: 'fixture/fast', defaultEffort: 'medium' });
    const saved = config({ ...before.secondary_model, defaultEffort: '' });
    ui.nativeFetch.mockResolvedValueOnce(envelope(before)).mockResolvedValueOnce(envelope({ items: [] }))
      .mockResolvedValueOnce(envelope(saved));
    await expect(ui.api.save({ model: 'fixture/fast', effort: '' })).resolves.toMatchObject({ section: saved.secondary_model });
    expect(ui.nativeFetch.mock.calls.slice(-3).map(([path, options]) => [path, options.method ?? 'GET']))
      .toEqual([['/api/v1/config', 'GET'], ['/api/v1/models', 'GET'], ['/api/v1/config', 'POST']]);
    expect(JSON.parse(ui.nativeFetch.mock.calls.at(-1)[1].body))
      .toEqual({ secondary_model: { defaultModel: 'fixture/fast', defaultEffort: '' } });
    expect(before.secondary_model.defaultEffort).toBe('medium');
    expect(saved.default_model).toBe('fixture/main');
  });
  it.each(['medium', undefined])('rejects an automatic save response that returns effort %s instead of an empty string',
    async (effort) => {
      const ui = install();
      await ui.authorize();
      const before = config({ defaultModel: 'fixture/fast', defaultEffort: 'medium' });
      const returned = effort === undefined
        ? { defaultModel: 'fixture/fast' } : { defaultModel: 'fixture/fast', defaultEffort: effort };
      ui.nativeFetch.mockResolvedValueOnce(envelope(before)).mockResolvedValueOnce(envelope({ items: [] }))
        .mockResolvedValueOnce(envelope(config(returned)));
      await expect(ui.api.save({ model: 'fixture/fast', effort: '' })).rejects.toThrow('saveMismatch');
    });
});

describe('subagent API response failures', () => {
  it.each([
    [envelope(null), 'invalidResponse'], [envelope({}, { code: 7, msg: 'Private fixture' }), 'requestFailed'],
    [new Response('bad JSON'), 'invalidResponse'], [new Response('{}', { status: 401 }), 'authExpired'],
    [new Response('{}', { status: 403 }), 'authExpired'], [new Response('{}', { status: 500 }), 'requestFailed'],
  ])('rejects errors, envelopes and malformed responses without leaking body text', async (response, error) => {
    const ui = install();
    await ui.authorize();
    ui.nativeFetch.mockResolvedValueOnce(response);
    await expect(ui.api.load()).rejects.toThrow(error);
  });
  it('rejects network failures and redirected or external responses', async () => {
    const ui = install();
    await ui.authorize();
    ui.nativeFetch.mockRejectedValueOnce(new Error('private fixture'));
    await expect(ui.api.load()).rejects.toThrow('requestFailed');
    const response = envelope({});
    Object.defineProperty(response, 'url', { value: 'https://elsewhere.test/api/v1/config' });
    ui.nativeFetch.mockResolvedValueOnce(response);
    await expect(ui.api.load()).rejects.toThrow('invalidResponse');
  });
});
