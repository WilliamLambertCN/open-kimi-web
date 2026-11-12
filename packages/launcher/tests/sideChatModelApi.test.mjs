/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, envelope, flush, models, setup } from './testkit/sideChatModel.mjs';

afterEach(cleanup);
const prepare = async (opts) => {
  const env = setup({ display: false, ...opts }); env.tabs(['side-1', 'side-2']); await env.auth(); await env.api.load();
  env.fetch.mockClear(); return env;
};
const selected = (env, agent = 'side-1', model = 'fast', effort = '') => env.api.select('A', agent, { model, effort });
const sent = (env) => JSON.parse(env.fetch.mock.calls.at(-1)[1].body);

describe('side chat prompt model selection', () => {
  it('follows the unmodified native request until explicitly selected', async () => {
    const env = await prepare(); const options = { method: 'POST', body: '{"agent_id":"side-1","model":"main"}' };
    await env.view.fetch('/api/v1/sessions/A/prompts', options);
    expect(env.fetch.mock.calls[0][1]).toBe(options); expect(sent(env).model).toBe('main');
  });
  it('changes only model and compatible thinking in one native send', async () => {
    const env = await prepare(); selected(env);
    const controller = new AbortController();
    const original = { content: [{ type: 'image', file_id: 'fictional-image' }], metadata: { draft: 1 }, prompt_id: 'p1',
      permission_mode: 'manual', plan_mode: true, swarm_mode: false, disabled_tools: ['shell'], profile: 'default' };
    const headers = new Headers({ authorization: 'Bearer fictional-test-token' });
    await env.prompt(original, { signal: controller.signal, headers, credentials: 'same-origin', redirect: 'error' });
    expect(env.fetch).toHaveBeenCalledTimes(1);
    expect(sent(env)).toMatchObject({ ...original, agent_id: 'side-1', model: 'fast', thinking: 'on' });
    expect(env.fetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal, headers, redirect: 'error' });
  });
  it('isolates main, other side chats, subagents and sessions', async () => {
    const env = await prepare(); selected(env);
    for (const agent_id of ['main', 'side-2', 'worker-1']) {
      await env.prompt({ agent_id }); expect(sent(env).model).toBe('main');
    }
    await env.view.fetch('/api/v1/sessions/B/prompts', { method: 'POST',
      body: JSON.stringify({ agent_id: 'side-1', model: 'main' }) });
    expect(sent(env).model).toBe('main'); selected(env, 'side-2', 'plain');
    await env.prompt({ agent_id: 'side-2' }); expect(sent(env)).toMatchObject({ model: 'plain', thinking: 'off' });
  });
  it('preserves a compatible inherited effort and applies explicit effort', async () => {
    const env = await prepare(); selected(env);
    await env.prompt({ thinking: 'low' }); expect(sent(env).thinking).toBe('low');
    selected(env, 'side-1', 'fast', 'off'); await env.prompt(); expect(sent(env).thinking).toBe('off');
  });
  it('restores native following without changing config or secondary_model', async () => {
    const env = await prepare(); selected(env); selected(env, 'side-1', ''); await env.prompt();
    expect(sent(env)).toMatchObject({ model: 'main', thinking: 'high' });
    expect(env.fetch.mock.calls.every(([path]) => String(path).endsWith('/prompts'))).toBe(true);
  });
});

describe('native request preservation', () => {
  it('preserves Request identity, headers and cancellation with an overriding body', async () => {
    const env = await prepare(); selected(env);
    const controller = new AbortController();
    const request = new Request('https://example.test/api/v1/sessions/A/prompts', { method: 'POST',
      body: JSON.stringify({ agent_id: 'side-1', model: 'main' }), headers: { 'content-type': 'application/json' },
      signal: controller.signal, credentials: 'same-origin' });
    await env.view.fetch(request);
    expect(env.fetch.mock.calls[0][0]).toBe(request); expect(sent(env).model).toBe('fast');
    expect(request.bodyUsed).toBe(false); expect(request.headers.get('content-type')).toBe('application/json');
  });
  it('captures the choice at native send time even when a Request body resolves later', async () => {
    const env = await prepare(); selected(env);
    const request = new Request('https://example.test/api/v1/sessions/A/prompts', { method: 'POST',
      body: JSON.stringify({ agent_id: 'side-1', model: 'main' }) });
    const pending = env.view.fetch(request); selected(env, 'side-1', 'plain');
    await pending; expect(sent(env).model).toBe('fast');
    await env.prompt(); expect(sent(env).model).toBe('plain');
  });
  it('honors Request init body precedence and never touches unrelated endpoints', async () => {
    const env = await prepare(); selected(env);
    const request = new Request('https://example.test/api/v1/sessions/A/prompts', { method: 'POST', body: '{}' });
    await env.view.fetch(request, { body: JSON.stringify({ agent_id: 'side-1', model: 'main' }) });
    expect(sent(env).model).toBe('fast');
    for (const path of ['https://other.test/api/v1/sessions/A/prompts', '/api/v1/config', '/api/v1/debug']) {
      const init = { method: 'POST', body: '{"agent_id":"side-1"}' };
      await env.view.fetch(path, init); expect(env.fetch.mock.calls.at(-1)[1]).toBe(init);
    }
  });
  it('preserves malformed and non-JSON request bodies', async () => {
    const env = await prepare(); selected(env);
    for (const body of ['broken', null, new URLSearchParams({ text: 'fixture' })]) {
      const options = { method: 'POST', body }; await env.view.fetch('/api/v1/sessions/A/prompts', options);
      expect(env.fetch.mock.calls.at(-1)[1]).toBe(options);
    }
  });
  it('propagates native failure once without retry or draft handling', async () => {
    const env = await prepare(); selected(env); const error = new DOMException('Fixture abort', 'AbortError');
    env.fetch.mockRejectedValueOnce(error); await expect(env.prompt()).rejects.toBe(error);
    expect(env.fetch).toHaveBeenCalledTimes(1); expect(env.api.choice('A', 'side-1').model).toBe('fast');
  });
});

describe('side chat selection validation', () => {
  it('refuses missing models and unsupported efforts before a prompt', async () => {
    const env = await prepare(); expect(() => selected(env, 'side-1', 'missing')).toThrow('modelMissing');
    expect(() => selected(env, 'side-1', 'fast', 'max')).toThrow('effortUnsupported');
    expect(() => selected(env, 'worker-1')).toThrow('identityLost'); expect(env.fetch).not.toHaveBeenCalled();
  });
  it('does not rewrite closed or invalidated native side targets', async () => {
    const env = await prepare(); selected(env); env.view.localStorage.removeItem('kimi-web.panel-tabs.v1:A');
    await env.prompt(); expect(sent(env).model).toBe('main');
  });
  it('reports removed selected models instead of silently switching providers', async () => {
    const env = await prepare(); selected(env); env.config({ models: { main: models.main } }); await env.api.load();
    env.fetch.mockClear(); await expect(env.prompt()).rejects.toThrow('modelMissing'); expect(env.fetch).not.toHaveBeenCalled();
  });
  it('returns copied choices and bounds page-only choices', async () => {
    const env = await prepare(); selected(env); env.api.choice('A', 'side-1').model = 'plain';
    expect(env.api.choice('A', 'side-1').model).toBe('fast');
    for (let i = 0; i < 70; i += 1) { env.tabs([`side-${i}`]); selected(env, `side-${i}`); }
    expect(env.api.choice('A', 'side-1').model).toBe(''); await flush();
  });
  it('does not publish an aborted catalog or install the wrapper twice', async () => {
    const env = await prepare(); const controller = new AbortController(); controller.abort();
    await expect(env.api.load(controller.signal)).rejects.toThrow('requestFailed');
    const fetch = env.view.fetch; env.install(); expect(env.view.fetch).toBe(fetch);
  });
  it('uses only official read endpoints to load models', async () => {
    const native = vi.fn(async (path) => envelope(String(path).endsWith('/config') ? { models } : { items: [] }));
    const env = setup({ native, display: false }); await expect(env.api.load()).rejects.toThrow('authPending');
    await env.auth(); native.mockClear(); await env.api.load();
    expect(native.mock.calls.map(([path]) => path)).toEqual(['/api/v1/config', '/api/v1/models']);
    expect(native.mock.calls.every(([, init]) => init.method === undefined)).toBe(true);
  });
});
