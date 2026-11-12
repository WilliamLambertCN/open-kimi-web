/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setup, cleanup, response, envelope, turn, step, assistant, timingSlot, flush } from './testkit/requestMetrics.mjs';

afterEach(cleanup);
const label = (test) => test.doc.querySelector('.okw-request-metrics')?.textContent;
const complete = (stepId, ordinal, extra = {}) => step({ stepId, ordinal, ...extra });
const calls = (count) => Array.from({ length: count }, (_, i) => complete(`s${i}`, i));
const merged = (count) => '<div class="a-msg" data-turn-id="first-thought"><div class="history-window">' +
  Array.from({ length: count }, (_, i) => `<div class="history-row" data-history-key="text-${i * 2}">` +
    `<div class="msg">Fictional reply ${i}</div></div><div class="history-row" data-history-key="stepTiming-${i * 2 + 1}">` +
    timingSlot(`s${i}`) + '</div>').join('') +
  '</div><div class="a-msg-ft"><button>Copy</button><span class="a-time">08:00</span></div></div>';

describe('request metrics at exact native model-step boundaries', () => {
  it('adds one compact line beside its own response, preserving actions and source text', async () => {
    const test = setup(); const message = test.doc.querySelector('.a-msg');
    const footer = message.querySelector('.a-msg-ft'); const click = vi.fn(); footer.querySelector('button').onclick = click;
    await test.load(); expect(label(test)).toBe('TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit 75.00%');
    expect(message.querySelector('.okw-request-metrics').title).toContain('TTFT plus streaming');
    expect(message.querySelector('.step-timing').nextElementSibling).toBe(footer);
    expect(message.lastElementChild).toBe(footer); expect(footer.textContent).toContain('08:00');
    footer.querySelector('button').click(); expect(click).toHaveBeenCalledOnce();
    expect(message.querySelector('.msg').textContent).toBe('Fictional reply'); await test.settle();
  });
  it('places dozens of calls in their own native internal rows, never a list below the final reply', async () => {
    const test = setup(vi.fn(async () => response(envelope([turn({ steps: calls(30) })]))), { html: merged(30) });
    await test.load();
    expect(test.doc.querySelectorAll('.a-msg')).toHaveLength(1);
    expect(test.doc.querySelectorAll('.okw-request-metrics')).toHaveLength(30);
    for (const slot of test.doc.querySelectorAll('.step-timing')) {
      expect(slot.querySelectorAll('.okw-request-metrics')).toHaveLength(1);
      expect(slot.querySelector('.okw-request-metrics').textContent).not.toMatch(/Request|请求/);
    }
    expect(test.doc.querySelector('.a-msg > .okw-request-metrics')).toBeNull();
    expect(test.doc.querySelector('.a-msg-ft').nextElementSibling).toBeNull(); await test.settle();
  });
  it('localizes average speed, cache, unavailable and interrupted metrics at their own boundary', async () => {
    const test = setup(vi.fn(async () => response(envelope([turn({ steps: [step(), complete('s1', 1,
      { state: 'interrupted', llmTiming: undefined, usage: undefined })] })]))),
    { html: assistant() + assistant('f1', timingSlot('s1', 'interrupted')) });
    await test.load();
    expect([...test.doc.querySelectorAll('.okw-request-metrics')].map((node) => node.textContent)).toEqual([
      'TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit 75.00%', 'TTFT — · Avg TPS — · Cache hit — · Interrupted',
    ]);
    test.locale('zh'); await flush();
    expect(label(test)).toBe('TTFT 1.20 s · 平均 TPS 31.3 tok/s · 缓存命中 75.00%');
    expect(test.doc.querySelectorAll('.okw-request-metrics')[1].textContent)
      .toBe('TTFT — · 平均 TPS — · 缓存命中 — · 已中断');
    const note = test.doc.querySelector('.okw-request-metrics').title;
    expect(note).toContain('流式思考也算首段'); expect(note).toContain('TTFT＋后续流式耗时');
    expect(note).toContain('新写入缓存不算命中'); await test.settle();
  });
  it('distinguishes missing cache usage from explicit zero and keeps cache independent of timing', async () => {
    const test = setup(vi.fn(async () => response(envelope([turn({ steps: [step({ usage: { output: 100 } })] })]))));
    await test.load(); expect(label(test)).toBe('TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit —');
    expect(test.doc.querySelector('.okw-request-metrics').getAttribute('aria-label')).toContain('Unavailable');
    const socket = test.socket();
    test.emit(socket, 'transcript.ops', { seq: 1, ops: [{ op: 'step.upsert', turnId: 't0', step: step({
      llmTiming: undefined, usage: { inputOther: 10, inputCacheRead: 0, inputCacheCreation: 5, output: 100 },
    }) }] });
    await test.settle(); expect(label(test)).toBe('TTFT — · Avg TPS — · Cache hit 0.00%');
    test.emit(socket, 'transcript.ops', { seq: 2, ops: [{ op: 'step.upsert', turnId: 't0', step: step() }] });
    await test.settle(); expect(label(test)).toBe('TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit 75.00%');
    expect(test.doc.querySelectorAll('.okw-request-metrics')).toHaveLength(1);
  });
});

describe('native metrics visibility and identity lifecycle', () => {
  it('does not touch unadapted native debug UI and recovers when official virtual rows remount', async () => {
    const test = setup(undefined, { html: assistant('f0', '<div class="step-timing">Native</div>') });
    await test.load(); expect(label(test)).toBeUndefined();
    const chat = test.doc.querySelector('.chat'); chat.innerHTML = assistant(); await test.settle();
    expect(label(test)).toBe('TTFT 1.20 s · Avg TPS 31.3 tok/s · Cache hit 75.00%');
    test.route('B'); await test.settle(); expect(label(test)).toBeUndefined();
    test.route('A'); await test.settle(); expect(label(test)).toContain('Avg TPS 31.3');
    const slot = chat.querySelector('.step-timing'); slot.querySelector('.okw-request-metrics').remove();
    await test.settle(); expect(label(test)).toContain('75.00%');
  });
  it('waits for a unique exact step ID and matching terminal state, not the merged root or text', async () => {
    const test = setup(undefined, { html: assistant('f0', timingSlot('unknown')) });
    await test.load(); expect(label(test)).toBeUndefined();
    const slot = test.doc.querySelector('.step-timing'); slot.dataset.okwStepId = 's0';
    await test.settle(); expect(label(test)).toContain('31.3');
    slot.dataset.okwStepState = 'running'; await test.settle(); expect(label(test)).toBeUndefined();
    slot.dataset.okwStepState = 'completed'; slot.insertAdjacentHTML('afterend', timingSlot());
    await test.settle(); expect(label(test)).toBeUndefined();
    slot.nextElementSibling.remove(); await test.settle(); expect(label(test)).toContain('31.3');
  });
  it('hides running calls and removes stale metadata on reset or native removal', async () => {
    const test = setup(); await test.load(); const socket = test.socket();
    test.emit(socket, 'transcript.reset', { seq: 1, snapshot: { items: [turn({ steps: [step({ state: 'running' })] })] } });
    await test.settle(); expect(label(test)).toBeUndefined();
    test.emit(socket, 'transcript.ops', { seq: 2, ops: [{ op: 'step.upsert', turnId: 't0', step: step() }] });
    await test.settle(); expect(label(test)).toContain('31.3');
    test.emit(socket, 'transcript.ops', { seq: 3, ops: [{ op: 'items.remove', ids: ['t0'] }] });
    await test.settle(); expect(label(test)).toBeUndefined();
  });
  it('does not mix Side Chat into main or unrelated transcript panels', async () => {
    const test = setup(); const side = test.doc.createElement('div'); side.className = 'pt-body';
    side.innerHTML = `<div class="sc"><div class="sc-body"><div class="chat">${assistant()}</div></div></div>`;
    test.doc.body.append(side); await test.load();
    expect(test.doc.querySelectorAll('.okw-request-metrics')).toHaveLength(1);
    test.view.__okwSideChatModel = { identity: () => ({ session: 'A', agent: 'side' }) };
    await test.load('/api/v1/sessions/A/transcript?agent_id=side');
    expect(side.querySelector('.okw-request-metrics')).toBeNull();
    test.native.mockResolvedValueOnce(response(envelope([turn({ steps: [step({ usage: {
      output: 200, inputOther: 10, inputCacheRead: 0, inputCacheCreation: 0 },
    })] })], { agent_id: 'side' })));
    await test.load('/api/v1/sessions/A/transcript?agent_id=side');
    expect(side.querySelector('.okw-request-metrics')?.textContent).toBe('TTFT 1.20 s · Avg TPS 62.5 tok/s · Cache hit 0.00%');
    expect(label(test)).toContain('Cache hit 75.00%'); await test.settle();
  });
});
