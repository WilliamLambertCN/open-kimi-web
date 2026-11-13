import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationTrace } from '../src/wsConversationDiagnostics.mjs';
import { createWsTrace } from '../src/wsDiagnostics.mjs';

const session = 'private-session';
const request = 'private-request';
const agent = 'private-agent';
const encode = (value) => Buffer.from(JSON.stringify(value));
const subscribe = (request_id = request, session_id = session, agent_ids = ['main']) =>
  encode({ type: 'subscribe', request_id, session_id, agent_ids });
const response = (code = 0, request_id = request) => encode({ type: 'response', request_id, code, msg: 'private-error' });
const turns = (agent_id = 'main', session_id = session) => encode({ type: 'turns', session_id, agent_id,
  event_created_at: '2026-01-01T00:00:00.000Z', turns: [{ text: 'private-body' }], has_more: true });

function harness() {
  const events = [];
  let clock = 0;
  const log = { tag: vi.fn(() => '0123456789abcdef') };
  const trace = createConversationTrace(log, (event, fields) => events.push({ event, ...fields }), () => clock);
  const send = (data, upstream = false) => trace[upstream ? 'toUpstream' : 'toClient'](data, data.length);
  return { trace, events, log, send, tick: (value) => { clock += value; } };
}

afterEach(() => vi.restoreAllMocks());

describe('bounded 2.6.0 conversation diagnostics', () => {
  it('distinguishes subscription, acceptance and first history without serializing identities', () => {
    const h = harness();
    h.send(subscribe(request, session, ['main', agent, agent]), true);
    h.tick(140); h.send(response());
    h.tick(80); h.send(turns()); h.send(turns());
    h.tick(10); h.send(turns(agent));
    expect(h.events.map((row) => row.event)).toEqual(['ws_subscribe', 'ws_subscribed', 'ws_turns', 'ws_turns']);
    expect(h.events[1]).toMatchObject({ subscribeMs: 140, resultCode: 0, main: true });
    expect(h.events[2]).toMatchObject({ subscribeMs: 220, frameBytes: turns().length, main: true });
    expect(h.events[3]).toMatchObject({ subscribeMs: 230, main: false });
    expect(h.log.tag).toHaveBeenCalledWith('session', session);
    expect(JSON.stringify(h.events)).not.toContain('private');
  });

  it('matches only exact session, agent and request, and discards rejected subscriptions', () => {
    const h = harness(); h.send(subscribe(), true);
    h.send(response(0, 'unrelated')); h.send(turns('other')); h.send(turns('main', 'other'));
    expect(h.events).toHaveLength(1);
    h.tick(50); h.send(response(40930)); h.send(turns());
    expect(h.events).toHaveLength(2);
    expect(h.events[1]).toMatchObject({ event: 'ws_subscribed', resultCode: 40930 });
    h.send(subscribe('retry'), true); h.send(response(0, 'retry')); h.send(turns());
    expect(h.events.at(-1).event).toBe('ws_turns');
  });

  it('does not let an older rejection erase the latest request for the same agent', () => {
    const h = harness(); h.send(subscribe('first'), true); h.tick(10); h.send(subscribe('second'), true);
    h.send(response(40930, 'first')); h.tick(20); h.send(turns());
    expect(h.events.at(-1)).toMatchObject({ event: 'ws_turns', subscribeMs: 20 });
  });

  it('never JSON-parses a large history frame or examines its complete body', () => {
    const h = harness(); h.send(subscribe(), true);
    const frame = Buffer.concat([Buffer.from('{"type":"turns","session_id":"private-session","agent_id":"main",'),
      Buffer.alloc(8 * 1024 * 1024, 120)]);
    const parse = vi.spyOn(JSON, 'parse'); h.send(frame);
    expect(parse).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ event: 'ws_turns', frameBytes: frame.length });
  });

  it('ignores oversized controls, unsupported data, malformed frames and invalid identities', () => {
    const h = harness();
    for (const value of [null, {}, { type: 'ping' }, { type: 'subscribe', session_id: {}, request_id: request },
      { type: 'subscribe', session_id: 'x\n', request_id: request },
      { type: 'subscribe', session_id: session, request_id: 'x'.repeat(257) },
      { type: 'subscribe', session_id: session, request_id: request, agent_ids: [] },
      { type: 'subscribe', session_id: session, request_id: request, agent_ids: [3] },
      { type: 'subscribe', session_id: session, request_id: request, agent_ids: Array(65).fill('main') }]) {
      h.send(encode(value), true);
    }
    h.send(Buffer.alloc(17000), true); h.send(Buffer.from('invalid'), true);
    h.trace.toUpstream(new ArrayBuffer(1), 1); h.send(response());
    expect(h.events).toEqual([]);
    h.send(subscribe(), true); h.send(response(-1)); h.send(encode({ type: 'response', request_id: request, code: '0' }));
    expect(h.events).toHaveLength(1);
  });

  it('uses native default main, bounds retained subscriptions and clears on close', () => {
    const h = harness();
    for (let i = 0; i < 65; i++) h.send(encode({ type: 'subscribe', request_id: String(i), session_id: 's' + i }), true);
    h.send(response(0, '0')); h.send(turns('main', 's0'));
    expect(h.events).toHaveLength(65);
    h.send(turns('main', 's64').toString());
    expect(h.events.at(-1).event).toBe('ws_turns');
    h.trace.clear(); const before = h.events.length;
    h.send(response(0, '64')); h.send(turns('main', 's63'));
    expect(h.events).toHaveLength(before);
  });

  it('does not construct protocol inspection without an enabled logger tag function', () => {
    expect(createConversationTrace(undefined, vi.fn(), vi.fn())).toBeNull();
    expect(createConversationTrace({ emit: vi.fn() }, vi.fn(), vi.fn())).toBeNull();
  });
});

describe('conversation diagnostics remain observational', () => {
  it('ignores binary, clears tracking at end and prevents late stage events', () => {
    const events = [];
    const trace = createWsTrace({ tag: () => '0123456789abcdef', emit: (event) => events.push(event) }, {}, vi.fn());
    trace.toUpstream(subscribe(), 0, true); trace.toClient(turns(), 0, true);
    expect(events).toEqual(['ws_begin', 'ws_first_frame']);
    trace.toUpstream(subscribe(), 0, false); trace.end(); trace.toClient(response(), 0); trace.toClient(turns(), 0);
    expect(events.at(-1)).toBe('ws_end');
    expect(events).not.toContain('ws_turns');
  });

  it('never propagates protocol inspection or tag failures into forwarding', () => {
    const trace = createWsTrace({ tag() { throw Error('private'); }, emit: vi.fn() }, {}, vi.fn());
    try { expect(() => trace.toUpstream(subscribe(), 0)).not.toThrow(); }
    finally { trace.end(); }
  });
});
