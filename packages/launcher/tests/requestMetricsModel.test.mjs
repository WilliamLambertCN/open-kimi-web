import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/requestMetricsModel.js'), 'utf8');
const setup = () => {
  const window = {};
  vm.runInNewContext(source, { window });
  return window.__okwRequestMetricsModel;
};
const frame = (frameId = 'f0', extra = {}) => ({ kind: 'text', frameId, role: 'assistant', text: 'Fictional reply', ...extra });
const step = (stepId = 's0', ordinal = 0, extra = {}) => ({ kind: 'step', stepId, turnId: 't0', ordinal,
  state: 'completed', usage: { inputOther: 10, inputCacheRead: 30, inputCacheCreation: 0, output: 100 },
  llmTiming: { llmFirstTokenLatencyMs: 1200, llmStreamDurationMs: 2000 }, frames: [frame()], ...extra });
const turn = (turnId = 't0', ordinal = 0, extra = {}) => ({ kind: 'turn', turnId, ordinal, state: 'completed',
  origin: { kind: 'user' }, prompt: 'Fictional question', durationMs: 100000, steps: [step()], ...extra });
const read = (model, items = [turn()], extra = {}, request = { stamp: 1 }) =>
  model.read('A', 'main', { agent_id: 'main', items, ...extra }, request);
const requests = (model, agent = 'main', session = 'A') => model.items(session, agent).flatMap((group) => group.requests);

describe('official per-request metrics projection', () => {
  it('uses TTFT plus stream for average TPS, never total turn or tool duration', () => {
    const api = setup(); const model = api.create(); read(model);
    expect(requests(model)).toEqual([{ id: 's0', state: 'completed', ttft: 1200, stream: 2000, duration: 3200,
      output: 100, tps: 31.25, cacheHitRate: 0.75 }]);
    expect(api.metricsFor(step('s', 0, { llmTiming: { llmFirstTokenLatencyMs: 50,
      llmStreamDurationMs: 0 } })).tps).toBe(2000);
  });
  it('includes initial wait once, without adding timing subcomponents or wall time', () => {
    const api = setup();
    for (const [latency, expected] of [[0, 100], [10000, 50]]) {
      const result = api.metricsFor(step('s', 0, { usage: { output: 1000 },
        llmTiming: { llmFirstTokenLatencyMs: latency, llmStreamDurationMs: 10000,
          llmRequestBuildMs: 20, llmServerFirstTokenMs: 9980, llmServerDecodeMs: 9000, llmClientConsumeMs: 1000 },
        startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:02:00.000Z' }));
      expect(result.tps).toBe(expected); expect(result.ttft).toBe(latency);
    }
  });
  it('does not count reasoning token details twice or infer a pure decoder speed', () => {
    const result = setup().metricsFor(step('s', 0, { usage: { output: 1000, reasoning_tokens: 500,
      raw: { completion_tokens: 1000, completion_tokens_details: { reasoning_tokens: 500 } } },
      llmTiming: { llmFirstTokenLatencyMs: 10000, llmStreamDurationMs: 10000 } }));
    expect(result.output).toBe(1000); expect(result.tps).toBe(50);
  });
  it('computes total-request average even when buffered output arrives as one chunk', () => {
    const result = setup().metricsFor(step('s', 0, { usage: { output: 100 },
      llmTiming: { llmFirstTokenLatencyMs: 2000, llmStreamDurationMs: 0 } }));
    expect(result.ttft).toBe(2000); expect(result.tps).toBe(50);
  });
  it('requires both timings for average TPS without hiding valid TTFT or cache data', () => {
    const api = setup();
    const streamOnly = api.metricsFor(step('s', 0, { llmTiming: { llmStreamDurationMs: 2000 } }));
    expect(streamOnly.ttft).toBeNull(); expect(streamOnly.tps).toBeNull(); expect(streamOnly.cacheHitRate).toBe(0.75);
    const ttftOnly = api.metricsFor(step('s', 0, { llmTiming: { llmFirstTokenLatencyMs: 2000 } }));
    expect(ttftOnly.ttft).toBe(2000); expect(ttftOnly.tps).toBeNull();
  });
  it.each([undefined, null, -1, Infinity, NaN, '20'])('rejects invalid timing %s without fabricating zero', (value) => {
    const metrics = setup().metricsFor({ llmTiming: {
      llmFirstTokenLatencyMs: value, llmStreamDurationMs: value }, usage: { output: 100 } });
    expect(metrics.ttft).toBeNull(); expect(metrics.tps).toBeNull();
  });
  it.each([undefined, null, 0, -1, 1.5, Infinity, '50'])('does not invent output-token rate from %s', (value) => {
    expect(setup().metricsFor(step('s', 0, { usage: { output: value } })).tps).toBeNull();
  });
  it.each([0, 1, 49.9])('does not estimate average TPS for a total duration of %s ms', (duration) => {
    expect(setup().metricsFor(step('s', 0, { llmTiming: { llmFirstTokenLatencyMs: 0,
      llmStreamDurationMs: duration } })).tps).toBeNull();
  });
  it('rejects an unsafe total without hiding an otherwise valid individual timing', () => {
    const result = setup().metricsFor(step('s', 0, { llmTiming: {
      llmFirstTokenLatencyMs: Number.MAX_SAFE_INTEGER, llmStreamDurationMs: 1 } }));
    expect(result.ttft).toBe(Number.MAX_SAFE_INTEGER); expect(result.duration).toBeNull(); expect(result.tps).toBeNull();
  });
});

describe('terminal per-request metric projection', () => {
  it('keeps completed calls separate and omits running calls without storing response or tool bodies', () => {
    const model = setup().create(); read(model, [turn('t0', 0, { steps: [
      step('s0', 0, { frames: [{ kind: 'thinking', frameId: 'think', text: 'Fictional reasoning' },
        { kind: 'tool', frameId: 'tool', input: { secret: 'not retained' }, output: 'not retained' }] }),
      step('s1', 1, { state: 'running', frames: [frame('final')] }),
    ] })]);
    expect(requests(model).map((request) => request.id)).toEqual(['s0']);
    model.apply('A', 'main', [{ op: 'step.upsert', turnId: 't0', step: step('s1', 1) }], { stamp: 2, seq: 1 });
    expect(model.items('A', 'main').map((group) => group.requests.map((request) => request.id))).toEqual([['s0'], ['s1']]);
    expect(JSON.stringify(model.items('A', 'main'))).not.toMatch(/Fictional|secret|retained|input|frames|prompt/);
  });
  it('retains missing values and explicitly distinguishes failed and interrupted calls', () => {
    const model = setup().create(); read(model, [turn('t0', 0, { steps: [
      step('s0', 0, { usage: undefined, llmTiming: undefined, state: 'failed' }),
      step('s1', 1, { state: 'interrupted', frames: [frame('f1')] }),
    ] })]);
    expect(requests(model).map((request) => request.state)).toEqual(['failed', 'interrupted']);
    expect(requests(model)[0].ttft).toBeNull(); expect(requests(model)[0].tps).toBeNull();
    expect(requests(model)[0].cacheHitRate).toBeNull();
  });
  it('does not combine two steps even when the official renderer merges their repeated text', () => {
    const model = setup().create(); read(model, [turn('t0', 0, { steps: [step('s0', 0), step('s1', 1)] })]);
    expect(model.items('A', 'main').map((group) => group.requests.map((request) => request.id))).toEqual([['s0'], ['s1']]);
  });
  it('retains frame-less terminal requests by exact step identity without assigning a different reply', () => {
    const model = setup().create(); read(model, [turn('t0', 0), turn('t1', 1, { steps: [step('s1', 0, { frames: [] })] })]);
    expect(model.items('A', 'main').map((group) => [group.turnId, group.requests[0].id])).toEqual([['t0', 's0'], ['t1', 's1']]);
  });
});

describe('per-call input cache hit rate', () => {
  it.each([
    [10, 30, 0, 0.75], [10, 30, 20, 0.5], [10, 0, 20, 0], [0, 30, 0, 1],
  ])('uses input totals (%s, %s, %s), excluding output and new writes from hits', (other, cached, created, expected) => {
    const result = setup().metricsFor({ usage: { inputOther: other, inputCacheRead: cached,
      inputCacheCreation: created, output: 99999 } });
    expect(result.cacheHitRate).toBe(expected); expect(result.tps).toBeNull();
  });
  it.each(['inputOther', 'inputCacheRead', 'inputCacheCreation'])('requires an explicit valid %s', (field) => {
    const api = setup();
    for (const value of [undefined, null, -1, 0.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
      const usage = { inputOther: 10, inputCacheRead: 30, inputCacheCreation: 0, [field]: value };
      expect(api.metricsFor(step('s', 0, { usage })).cacheHitRate).toBeNull();
    }
  });
  it('does not fabricate cache rates for zero or unsafe total input', () => {
    const api = setup();
    expect(api.metricsFor({ usage: { inputOther: 0, inputCacheRead: 0, inputCacheCreation: 0 } }).cacheHitRate).toBeNull();
    expect(api.metricsFor({ usage: { inputOther: Number.MAX_SAFE_INTEGER, inputCacheRead: 1,
      inputCacheCreation: 0 } }).cacheHitRate).toBeNull();
  });
  it('updates history and late usage in one existing step without changing the speed', () => {
    const model = setup().create(); read(model);
    expect(requests(model)[0].cacheHitRate).toBe(0.75);
    model.apply('A', 'main', [{ op: 'step.upsert', turnId: 't0', step: step('s0', 0,
      { usage: { inputOther: 20, inputCacheRead: 0, inputCacheCreation: 5, output: 100 } }) }], { stamp: 2, seq: 1 });
    expect(requests(model)).toHaveLength(1); expect(requests(model)[0].cacheHitRate).toBe(0);
    expect(requests(model)[0].tps).toBe(31.25);
  });
});

describe('native incremental metric lifecycle', () => {
  it('accepts late timing and retry state without counting intermediate failed attempts twice', () => {
    const model = setup().create(); read(model, [turn('t0', 0, { steps: [step('s0', 0, { state: 'running',
      llmTiming: undefined, usage: undefined, retry: { failedAttempt: 1, nextAttempt: 2 } })] })]);
    expect(requests(model)).toEqual([]);
    model.apply('A', 'main', [{ op: 'step.upsert', turnId: 't0', step: step('s0', 0, { llmTiming: undefined }) }],
      { stamp: 2, seq: 1 });
    expect(requests(model)[0].ttft).toBeNull();
    model.apply('A', 'main', [{ op: 'step.upsert', turnId: 't0', step: step() }], { stamp: 3, seq: 2 });
    expect(requests(model)).toHaveLength(1); expect(requests(model)[0].tps).toBe(31.25);
  });
  it('ignores frame ops before the terminal step header instead of deriving identity from content', () => {
    const model = setup().create();
    expect(model.apply('A', 'main', [{ op: 'frame.upsert', turnId: 't0', stepId: 's0', frame: frame() }],
      { stamp: 1, seq: 1 })).toBe(false);
    model.apply('A', 'main', [{ op: 'append', target: { turnId: 't0', stepId: 's0', frameId: 'f0' }, offset: 0,
      text: 'not retained' }, { op: 'step.upsert', turnId: 't0', step: step() }], { stamp: 2, seq: 2 });
    expect(requests(model)).toHaveLength(1);
  });
  it('ignores streaming body growth without storing it or rebuilding request UI', () => {
    const model = setup().create(); read(model);
    expect(model.apply('A', 'main', [{ op: 'append', target: { turnId: 't0', stepId: 's0', frameId: 'f0' },
      text: 'New fictional body', offset: 1 }], { stamp: 2, seq: 1 })).toBe(false);
    expect(model.apply('A', 'main', [{ op: 'frame.upsert', turnId: 't0', stepId: 's0',
      frame: frame('f0', { text: 'Different fictional body' }) }], { stamp: 3, seq: 2 })).toBe(false);
    expect(requests(model)[0].tps).toBe(31.25);
  });
  it('merges cursor pages but ignores pre-live pages, duplicate ops and removed-turn resurrection', () => {
    const model = setup().create(); read(model, [turn()], { seq: 1 });
    model.apply('A', 'main', [{ op: 'step.upsert', turnId: 't0', step: step('s0', 0, { usage: { output: 200 } }) },
      { op: 'items.remove', ids: ['removed'] }], { stamp: 4, seq: 2 });
    read(model, [turn(), turn('removed', 2, { steps: [step('removed-step', 0)] }),
      turn('older', -1, { steps: [step('older-step', 0)] })], {}, { page: true, stamp: 2 });
    expect(requests(model).map((request) => request.id)).toEqual(['older-step', 's0']);
    expect(requests(model).at(-1).tps).toBe(62.5);
    expect(model.apply('A', 'main', [{ op: 'items.remove', ids: ['t0'] }], { stamp: 5, seq: 2 })).toBe(false);
    expect(read(model, [], { seq: 1 }, { stamp: 6 })).toBe(false);
  });
  it('replaces on reconnect epoch or native reset and does not leak data between agents or sessions', () => {
    const model = setup().create(); read(model, [turn()], { seq: 100 });
    expect(model.reset('A', 'main', { agent_id: 'main', seq: 1, snapshot: { items: [] } }, 'new', 2)).toBe(true);
    expect(requests(model)).toEqual([]);
    model.apply('A', 'main', [{ op: 'reset', agentId: 'main', snapshot: { items: [turn()] } }], { stamp: 3, seq: 2 });
    expect(requests(model)).toHaveLength(1);
    model.read('A', 'side', { agent_id: 'side', items: [turn('side', 0, { steps: [step('side-step', 0)] })] }, { stamp: 4 });
    expect(requests(model, 'side')[0].id).toBe('side-step'); expect(requests(model)[0].id).toBe('s0');
    expect(model.items('B', 'main')).toEqual([]);
    model.items('A', 'main')[0].requests[0].ttft = -1;
    expect(requests(model)[0].ttft).toBe(1200);
  });
  it('bounds sessions, agents and step metadata, rejecting malformed identities', () => {
    const model = setup().create();
    for (const id of ['A', 'B', 'C', 'D', 'E']) model.read(id, 'main', { agent_id: 'main', items: [turn()] }, { stamp: 1 });
    expect(model.items('A', 'main')).toEqual([]); expect(model.items('B', 'main')).toHaveLength(1);
    for (let i = 0; i < 20; i += 1) model.read('E', `agent${i}`, { agent_id: `agent${i}`, items: [turn()] }, { stamp: 2 });
    expect(model.items('E', 'agent14')).toHaveLength(1); expect(model.items('E', 'agent15')).toEqual([]);
    expect(model.read('', 'main', { items: [] }, { stamp: 3 })).toBe(false);
    expect(model.read('E', 'main', { agent_id: 'other', items: [] }, { stamp: 3 })).toBe(false);
    const steps = Array.from({ length: 2100 }, (_, i) => step(`s${i}`, i));
    model.read('E', 'main', { agent_id: 'main', items: [turn('t0', 0, { steps })] }, { stamp: 4 });
    expect(requests(model, 'main', 'E')).toHaveLength(2000);
    expect(requests(model, 'main', 'E')[0].id).toBe('s100');
  });
});
