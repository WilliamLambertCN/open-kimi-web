/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, cleanup, assistant, deferred, flush } from './testkit/requestMetrics.mjs';

const value = (extra = {}) => ({ session: 'A', turn: 't_123456789abc', index: 1, item: 'step-uuid:1',
  type: 'assistant_message', state: 'completed', ended: new Date(10000).toISOString(),
  usage: { output: 100, input_other: 10, input_cache_read: 30, input_cache_creation: 0 }, ...extra });
const id = (raw) => JSON.stringify([raw.turn, raw.index, raw.item]);
const slot = (raw = value()) => {
  const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<div class="step-timing" data-okw-step-id="${escape(id(raw))}" ` +
    `data-okw-step-state="${raw.state}" data-okw-conversation="${escape(JSON.stringify(raw))}"></div>`;
};
const timings = (raw = value(), extra = {}) => ({ available: true, pending: false, items: [{ id: id(raw),
  llmTiming: { llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000 }, ...extra }] });
const label = (test) => test.doc.querySelector('.okw-request-metrics')?.textContent;
const settle = async (test) => { await flush(); await vi.advanceTimersByTimeAsync(450); await test.settle(); };
afterEach(cleanup);

describe('conversation-native per-request metrics', () => {
  it('shows cache from ordinary non-debug usage immediately, then the exact official timing', async () => {
    const result = deferred(); const api = vi.fn(() => result.promise);
    const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
    await flush(); expect(label(test)).toBe('TTFT — · Avg TPS — · Cache hit 75.00%');
    await vi.advanceTimersByTimeAsync(210); expect(api).toHaveBeenCalledOnce();
    const [path, options] = api.mock.calls[0];
    expect(path).toBe('/__open-kimi-mobile/request-metrics');
    expect(JSON.parse(options.body)).toMatchObject({ session: 'A', agent: 'main', requests: [{ item: 'step-uuid:1' }] });
    expect(options.body).not.toMatch(/Fictional|text|prompt/);
    result.resolve(timings()); await settle(test);
    expect(label(test)).toBe('TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit 75.00%');
    expect(test.doc.querySelectorAll('.okw-request-metrics')).toHaveLength(1);
    await settle(test); expect(api).toHaveBeenCalledOnce();
  });
  it('uses explicitly supplied official timing without any extra fetch and localizes old history', async () => {
    const api = vi.fn(); const raw = value({ timing: { first_token_ms: 500, stream_ms: 1500 } });
    const test = setup(undefined, { html: assistant('reply', slot(raw)), conversationApi: api });
    await settle(test); expect(label(test)).toContain('Avg TPS 50.0'); expect(api).not.toHaveBeenCalled();
    test.locale('zh'); await test.settle(); expect(label(test)).toContain('平均 TPS 50.0');
    test.doc.querySelector('.chat').innerHTML = assistant('remount', slot(raw));
    await test.settle(); expect(label(test)).toContain('缓存命中 75.00%');
  });
  it('does not confuse absent timing, cache zero, unavailable local source or incomplete usage', async () => {
    const api = vi.fn(async () => ({ available: false, reason: 'unmanaged_target', items: [], pending: false }));
    const raw = value({ usage: { output: 100, input_other: 10, input_cache_read: 0, input_cache_creation: 5 } });
    const test = setup(undefined, { html: assistant('reply', slot(raw)), conversationApi: api });
    await settle(test); expect(label(test)).toBe('TTFT — · Avg TPS — · Cache hit 0.00%');
    test.doc.querySelector('.chat').innerHTML = assistant('reply', slot(value({ usage: { output: 100 } })));
    await settle(test); expect(label(test)).toBe('TTFT — · Avg TPS — · Cache hit —');
  });
  it('rejects wrong, duplicate, running and old-session slots instead of guessing a message', async () => {
    const api = vi.fn(async () => timings());
    const test = setup(undefined, { html: assistant('reply', slot(value({ session: 'B' }))), conversationApi: api });
    await settle(test); expect(label(test)).toBeUndefined(); expect(api).not.toHaveBeenCalled();
    test.doc.querySelector('.chat').innerHTML = assistant('reply', slot(value({ state: 'running' })));
    await settle(test); expect(label(test)).toBeUndefined();
    test.doc.querySelector('.chat').innerHTML = assistant('reply', slot() + slot());
    await settle(test); expect(label(test)).toBeUndefined();
    test.doc.querySelector('.chat').innerHTML = assistant('reply', slot());
    await settle(test); expect(label(test)).toContain('31.3');
  });
  it('batches only connected precise items and resumes bounded local scans', async () => {
    const api = vi.fn().mockResolvedValueOnce({ available: true, items: [], pending: true }).mockResolvedValue(timings());
    const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
    await settle(test); expect(api).toHaveBeenCalledTimes(2); expect(label(test)).toContain('31.3');
    test.doc.querySelector('.chat').innerHTML = '';
    await settle(test); expect(api).toHaveBeenCalledTimes(2);
  });
});

describe('conversation metrics retry and agent isolation', () => {
  it.each(['pending journal write', 'temporary network error'])('retries a %s before settling', async (failure) => {
    const api = vi.fn();
    if (failure === 'temporary network error') api.mockRejectedValueOnce(Error('unavailable'));
    else api.mockResolvedValueOnce({ available: true, items: [], pending: false });
    api.mockResolvedValue(timings());
    const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
    await settle(test); expect(label(test)).toContain('Avg TPS 31.3');
    expect(api).toHaveBeenCalledTimes(2);
    await settle(test); expect(api).toHaveBeenCalledTimes(2);
  });
  it.each(['missing timing', 'network failure', 'unmanaged target', 'continuing scan'])(
    'bounds retries and DOM updates for a %s', async (failure) => {
      const api = vi.fn();
      if (failure === 'network failure') api.mockRejectedValue(Error('unavailable'));
      else api.mockResolvedValue({ available: failure !== 'unmanaged target', items: [],
        pending: failure === 'continuing scan', reason: failure === 'unmanaged target' ? 'unmanaged_target' : undefined });
      const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
      await flush();
      await vi.advanceTimersByTimeAsync(14000); await test.settle();
      expect(api).toHaveBeenCalledTimes(failure === 'continuing scan' ? 64 : failure === 'unmanaged target' ? 1 : 3);
      expect(label(test)).toBe('TTFT — · Avg TPS — · Cache hit 75.00%');
      const count = api.mock.calls.length;
      await settle(test); expect(api).toHaveBeenCalledTimes(count);
    });
  it('ignores a late response after routing away and keeps native state untouched', async () => {
    const result = deferred(); const api = vi.fn(() => result.promise);
    const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
    await vi.advanceTimersByTimeAsync(210); test.route('B'); result.resolve(timings());
    await settle(test); expect(label(test)).toBeUndefined();
    expect(test.doc.querySelector('.msg').textContent).toBe('Fictional reply');
  });
  it('isolates main and side agents even when item IDs collide', async () => {
    const api = vi.fn(async (_path, options) => {
      const data = JSON.parse(options.body);
      return timings(value(), { llmTiming: { llmFirstTokenLatencyMs: 1000,
        llmStreamDurationMs: data.agent === 'main' ? 1000 : 3000 } });
    });
    const test = setup(undefined, { html: assistant('reply', slot()), conversationApi: api });
    const side = test.doc.createElement('div'); side.className = 'pt-body';
    side.innerHTML = `<div class="sc"><div class="chat">${assistant('side', slot())}</div></div>`;
    test.doc.body.append(side); test.view.__okwSideChatModel = { identity: () => ({ session: 'A', agent: 'side' }) };
    await settle(test); await settle(test);
    expect(label(test)).toContain('Avg TPS 50.0');
    expect(side.querySelector('.okw-request-metrics').textContent).toContain('Avg TPS 25.0');
    expect(api.mock.calls.map(([, options]) => JSON.parse(options.body).agent)).toEqual(['main', 'side']);
  });
});
