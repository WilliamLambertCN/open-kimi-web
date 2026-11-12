/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, cleanup, response, envelope, turn, step, deferred, flush } from './testkit/requestMetrics.mjs';

afterEach(cleanup);
const path = '/api/v1/sessions/A/transcript?agent_id=main';
const rate = (test, agent = 'main') => test.metrics.items(agent)[0]?.requests[0]?.tps;

describe('passive native metrics delivery', () => {
  it('uses an already-consumed text or json body without cloning, extra fetches or altered delivery', async () => {
    const body = envelope(); const result = response(body); const clone = vi.spyOn(result, 'clone');
    const test = setup(vi.fn(async () => result), { view: false });
    expect(await test.load(path, 'text')).toBe(JSON.stringify(body)); expect(rate(test)).toBe(31.25);
    expect(test.metrics.items()[0].requests[0].cacheHitRate).toBe(0.75);
    expect(test.native).toHaveBeenCalledOnce(); expect(clone).not.toHaveBeenCalled();
    test.install(); expect(test.view.fetch).toBe(test.view.fetch);
  });
  it('preserves Request/init/signal, original promise, response failures and unread bodies', async () => {
    const result = response(); const promise = Promise.resolve(result); const native = vi.fn(() => promise);
    const test = setup(native, { view: false });
    const request = new Request('https://example.test' + path); const controller = new AbortController();
    const init = { signal: controller.signal, headers: { authorization: 'Bearer fixture' } };
    expect(test.view.fetch(request, init)).toBe(promise); await promise; await flush();
    expect(native).toHaveBeenLastCalledWith(request, init); expect(test.metrics.items()).toEqual([]);
    await result.json(); await flush(); expect(rate(test)).toBe(31.25);
    const failed = new Error('Native failure'); native.mockRejectedValueOnce(failed);
    await expect(test.view.fetch(path)).rejects.toBe(failed);
  });
  it.each([
    ['https://other.test' + path, {}], [path, { method: 'POST' }], [path + '&before_turn=a&after_turn=b', {}],
    ['/api/v1/sessions/A/transcript', {}], ['/api/v1/sessions/A/prompts', {}], ['https://[bad', {}],
  ])('does not observe unrelated or malformed request %s', async (url, options) => {
    const test = setup(undefined, { view: false }); await test.load(url, 'json', options);
    expect(test.metrics.items()).toEqual([]); expect(test.native).toHaveBeenCalledOnce();
  });
  it.each([response(envelope(), { status: 403 }), response({ code: 50001, data: envelope().data }),
    response(envelope(), { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    new Response('not json')])('keeps failed, invalid or oversized native body untouched', async (result) => {
    const test = setup(vi.fn(async () => result), { view: false }); const text = await result.clone().text();
    expect(await test.load(path, 'text')).toBe(text); expect(test.metrics.items()).toEqual([]);
  });
  it('refuses extra parsing of a giant tool body and keeps the official response complete', async () => {
    const body = envelope([turn({ steps: [step({ frames: [{ kind: 'tool', frameId: 'tool',
      input: { text: 'x'.repeat(3 * 1024 * 1024) }, output: 'Fictional complete result' }] })] })]);
    const test = setup(vi.fn(async () => response(body)), { view: false });
    expect((await test.load(path, 'text')).length).toBeGreaterThan(3 * 1024 * 1024);
    expect(test.metrics.items()).toEqual([]);
  });
  it('isolates route visits and accepts only immediate target navigation for a pre-navigation request', async () => {
    const slow = deferred(); const native = vi.fn(() => slow.promise); const test = setup(native, { view: false });
    const pending = test.view.fetch(path); test.route('B'); test.route('A');
    slow.resolve(response()); await (await pending).json(); await flush(); expect(test.metrics.items()).toEqual([]);
    native.mockResolvedValueOnce(response()); const next = test.view.fetch(path.replace('/A/', '/B/')); test.route('B');
    await (await next).json(); await flush(); expect(rate(test)).toBe(31.25);
  });
});

describe('real transcript reset, ops, catchup and reconnect shapes', () => {
  it('handles completed late metrics and non-main agents without observing unrelated sockets', async () => {
    const test = setup(undefined, { view: false });
    const socket = test.socket(); const external = test.socket('wss://other.test');
    const listener = vi.fn(); test.metrics.observe(listener); test.metrics.observe(() => { throw Error('Observer'); });
    test.emit(external, 'transcript.reset', { seq: 1, snapshot: { items: [turn()] } }); expect(rate(test)).toBeUndefined();
    test.emit(socket, 'transcript.reset', { seq: 1, snapshot: { items: [turn({ steps: [step({ state: 'running' })] })] } });
    expect(rate(test)).toBeUndefined();
    test.emit(socket, 'transcript.ops', { seq: 2, ops: [{ op: 'step.upsert', turnId: 't0', step: step() }] });
    expect(rate(test)).toBe(31.25);
    test.emit(socket, 'transcript.reset', { agent_id: 'side', seq: 1, snapshot: { items: [turn()] } });
    expect(rate(test, 'side')).toBe(31.25); expect(listener).toHaveBeenCalledTimes(3);
  });
  it('accepts lower seq on a new native socket and ignores late events from the replaced connection', () => {
    const test = setup(undefined, { view: false }); const first = test.socket();
    test.emit(first, 'transcript.reset', { seq: 100, snapshot: { items: [turn()] } }); expect(rate(test)).toBe(31.25);
    const second = test.socket();
    test.emit(second, 'transcript.reset', { seq: 0, snapshot: { items: [turn({ steps: [step({ usage: { output: 200 } })] })] } });
    expect(rate(test)).toBe(62.5);
    test.emit(first, 'transcript.reset', { seq: 101, snapshot: { items: [] } }); expect(rate(test)).toBe(62.5);
  });
  it('applies complete native REST catch-up, skips incomplete batches and ignores pre-reset responses', async () => {
    const slow = deferred(); const native = vi.fn().mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ code: 0, data: { agent_id: 'main', complete: true, batches: [
        { seq: 1, ops: [{ op: 'step.upsert', turnId: 't0', step: step({ usage: { output: 200 } }) }] },
      ] } })).mockReturnValueOnce(slow.promise);
    const test = setup(native, { view: false }); await test.load();
    await test.load('/api/v1/sessions/A/transcript/ops?agent_id=main&since_seq=0'); expect(rate(test)).toBe(62.5);
    const pending = test.view.fetch('/api/v1/sessions/A/transcript/ops?agent_id=main&since_seq=1');
    const socket = test.socket(); test.emit(socket, 'transcript.reset', { seq: 3, snapshot: { items: [] } });
    slow.resolve(response({ code: 0, data: { agent_id: 'main', complete: true, batches: [
      { seq: 4, ops: [{ op: 'frame.upsert', turnId: 't0', stepId: 's0', frame: step().frames[0] },
        { op: 'step.upsert', turnId: 't0', step: step() }] },
    ] } })); await (await pending).json(); await flush(); expect(test.metrics.items()).toEqual([]);
    native.mockResolvedValueOnce(response({ code: 0, data: { agent_id: 'main', complete: false, batches: [] } }));
    await test.load('/api/v1/sessions/A/transcript/ops?agent_id=main'); expect(test.metrics.items()).toEqual([]);
  });
});
