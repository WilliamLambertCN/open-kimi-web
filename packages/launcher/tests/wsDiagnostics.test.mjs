import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWsTrace } from '../src/wsDiagnostics.mjs';

const identity = { id: 1, clientTag: '0123456789abcdef', route: 'ws', method: 'GET' };

function harness(options) {
  const events = [];
  const onEnd = vi.fn();
  const trace = createWsTrace({ emit: (event, fields) => events.push({ event, ...fields }) }, identity, onEnd, options);
  return { trace, events, onEnd };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WebSocket diagnostics counters', () => {
  it('counts bytes without inspecting messages and retains buffer peaks', () => {
    const { trace, events, onEnd } = harness();
    try {
      trace.toUpstream('é', 7);
      trace.toUpstream(Buffer.from('abc'), 3);
      trace.toClient(Buffer.from('abcd'), 9);
      trace.toClient(new ArrayBuffer(6), 2);
      trace.toClient([Buffer.alloc(2), Buffer.alloc(3)], 4);
      trace.end();
      expect(events.at(-1)).toMatchObject({
        event: 'ws_end', ...identity, outcome: 'closed',
        toClientMessages: 3, toClientBytes: 15, toClientMaxBytes: 6,
        toUpstreamMessages: 2, toUpstreamBytes: 5, toUpstreamMaxBytes: 3,
        clientBufferedBytes: 9, upstreamBufferedBytes: 7,
      });
      expect(onEnd).toHaveBeenCalledTimes(1);
    } finally { trace.end(); }
  });

  it('measures first server message from begin, not ready or upstream-bound messages', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    const { trace, events } = harness();
    vi.advanceTimersByTime(12);
    trace.toUpstream(Buffer.alloc(4), 0);
    trace.ready();
    trace.ready();
    vi.advanceTimersByTime(8);
    trace.toClient(Buffer.alloc(0), 0);
    vi.advanceTimersByTime(5);
    trace.toClient(Buffer.alloc(4), 0);
    trace.end();
    expect(events.map(({ event }) => event)).toEqual(['ws_begin', 'ws_ready', 'ws_first_frame', 'ws_end']);
    expect(events[1].elapsedMs).toBe(12);
    expect(events[2].firstFrameMs).toBe(20);
    expect(events[3]).toMatchObject({ firstFrameMs: 20, elapsedMs: 25, toClientMessages: 2 });
  });
});

describe('WebSocket diagnostics error outcomes', () => {
  it.each([1006, 1011])('retains a protocol failure and the first observed close code %i', (closeCode) => {
    const { trace, events, onEnd } = harness();
    trace.ready();
    trace.error({ code: 'WS_ERR_UNEXPECTED_RSV_1' });
    trace.end('closed', { closeCode });
    trace.end('closed', { closeCode: closeCode === 1006 ? 1011 : 1006 });
    trace.error({ code: 'ECONNRESET' });
    expect(events.map(({ event }) => event)).toEqual(['ws_begin', 'ws_ready', 'ws_error', 'ws_end']);
    expect(events.at(-1)).toMatchObject({ outcome: 'error', closeCode });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it.each(['aborted', 'shutdown', 'rejected'])('preserves an explicit %s outcome after an error', (outcome) => {
    const { trace, events } = harness();
    trace.error({ code: 'ECONNRESET' });
    trace.end(outcome);
    expect(events.at(-1)).toMatchObject({ event: 'ws_end', outcome });
  });
});

describe('WebSocket diagnostics lifecycle', () => {
  it('emits low-frequency snapshots, clamps fast intervals and clears its unreferenced timer', () => {
    vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval'] });
    const unref = vi.fn();
    const fakeInterval = globalThis.setInterval;
    const interval = vi.spyOn(globalThis, 'setInterval');
    interval.mockImplementation((callback, ms) => {
      const timer = fakeInterval(callback, ms);
      timer.unref = unref;
      return timer;
    });
    const { trace, events } = harness({ progressMs: 1 });
    expect(unref).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4999);
    expect(events).toHaveLength(1);
    trace.toClient(Buffer.alloc(3), 8);
    vi.advanceTimersByTime(1);
    expect(events.at(-1)).toMatchObject({ event: 'ws_progress', elapsedMs: 5000, toClientBytes: 3 });
    vi.advanceTimersByTime(5000);
    expect(events.filter(({ event }) => event === 'ws_progress')).toHaveLength(2);
    trace.end('shutdown');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(15000);
    expect(events.at(-1).event).toBe('ws_end');
  });

  it('does not create timers when disabled', () => {
    vi.useFakeTimers();
    const interval = vi.spyOn(globalThis, 'setInterval');
    const onEnd = vi.fn();
    const trace = createWsTrace(undefined, identity, onEnd);
    trace.ready();
    trace.toClient('private-frame', 0);
    trace.end();
    expect(interval).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ends pending attempts once and ignores later signals', () => {
    const { trace, events, onEnd } = harness();
    trace.end('aborted');
    trace.end('closed');
    trace.ready();
    trace.toClient('private-frame', 0);
    trace.toUpstream('private-frame', 0);
    trace.error(new Error('private-error'));
    expect(events.map(({ event }) => event)).toEqual(['ws_begin', 'ws_end']);
    expect(events.at(-1)).not.toHaveProperty('firstFrameMs');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('filters errors and extra end fields rather than serializing raw data', () => {
    const { trace, events } = harness();
    trace.error(Object.assign(new Error('private-message'), { code: 'ECONNRESET', reason: 'private-reason' }));
    trace.error({ code: 'private-code' });
    trace.end('rejected', { status: 403, closeCode: 4001, reason: 'private-reason', error: 'private-error' });
    expect(events[1]).toEqual({ event: 'ws_error', ...identity, errorCode: 'ECONNRESET' });
    expect(events[2]).toEqual({ event: 'ws_error', ...identity, errorCode: 'other' });
    expect(events[3]).toMatchObject({ outcome: 'rejected', status: 403, closeCode: 4001 });
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it.each([{ status: -1, closeCode: 2000 }, { status: '403', closeCode: '1000' }, { status: 600, closeCode: 5000 }])(
    'ignores invalid numeric end metadata %#', (fields) => {
      const { trace, events } = harness();
      trace.end('private-outcome', fields);
      expect(events.at(-1)).not.toHaveProperty('status');
      expect(events.at(-1)).not.toHaveProperty('closeCode');
      expect(events.at(-1).outcome).toBe('closed');
    },
  );

  it('does not let a failed logger affect forwarding or cleanup', () => {
    const onEnd = vi.fn();
    const trace = createWsTrace({ emit() { throw new Error('sink unavailable'); } }, identity, onEnd);
    trace.ready();
    trace.toClient(Buffer.alloc(1), 0);
    trace.error({ code: 'EPIPE' });
    trace.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
