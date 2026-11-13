/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/conversationMetadata.js'), 'utf8');
const frames = [];
const path = '/api/v1/sessions/A/agents/main/turns?page_size=10';
const created = '2026-11-01T01:00:00.000Z';
const ended = '2026-11-01T01:00:03.000Z';
const user = (item_id = 'u0', text = 'Repeated question', extra = {}) => ({
  type: 'user_message', item_id, status: 'ended', outcome: 'completed', created_at: created,
  prompt_ids: ['p0'], placement: 'opener', origin: { kind: 'user' }, text, attachments: [], skills: [], ...extra,
});
const turn = (turn_id = 't0', ordinal = 0, items = [user()], extra = {}) => ({
  turn_id, ordinal, kind: 'agent', status: 'ended', outcome: 'completed', started_at: created, ended_at: ended,
  steps: [], items, ...extra,
});
const envelope = (turns = [turn()], extra = {}) => ({ code: 0, data: { turns, has_more: false, ...extra } });
const responseFor = (body = envelope(), options) => new Response(JSON.stringify(body), options);
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { resolve, promise };
};
const flush = async () => {
  for (let i = 0; i < 3; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
function setup(native = vi.fn(async () => responseFor())) {
  vi.useFakeTimers();
  const frame = document.createElement('iframe'); document.body.append(frame); frames.push(frame);
  const view = frame.contentWindow;
  const location = { origin: window.location.origin, href: `${window.location.origin}/sessions/A`, pathname: '/sessions/A' };
  for (const method of ['pushState', 'replaceState']) view.history[method] = (state, title, value) => {
    const next = new URL(value, location.href); location.pathname = next.pathname; location.href = next.href;
    return state;
  };
  class Socket extends view.EventTarget {
    static OPEN = 1;
    constructor(...args) { super(); this.args = args; }
  }
  view.WebSocket = Socket; view.Request = Request; view.fetch = native; view.__fixtureLocation = location;
  const storage = vi.spyOn(view.Storage.prototype, 'setItem');
  const install = () => view.eval(`(() => { const location = window.__fixtureLocation; ${source}\n })()`);
  install();
  const metadata = view.__okwMobileTocMetadata;
  const load = async (url = path, method = 'json', options) => {
    const response = await view.fetch(url, options); const body = await response[method](); await flush(); return body;
  };
  const emit = (socket, type, payload = {}, extra = {}) => socket.dispatchEvent(new view.MessageEvent('message', {
    data: JSON.stringify({ type, session_id: 'A', agent_id: 'main', ...payload, ...extra }),
  }));
  return { view, metadata, native, storage, location, Socket, install, emit, load,
    route: (id, method = 'pushState') => view.history[method](null, '', id.startsWith('/') ? id : `/sessions/${id}`),
    socket: (url = `${location.origin.replace(/^http/, 'ws')}/api/v1/ws`, protocols) => new view.WebSocket(url, protocols),
    ids: () => metadata.items().map((item) => item.id),
  };
}
afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove()); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('2.6 conversation item identities and bounded labels', () => {
  it('uses exact item IDs and native ordering, including repeated labels and steered prompts', async () => {
    const test = setup(vi.fn(async () => responseFor(envelope([
      turn('later', 5, [user('u5')]), turn('t0', 0, [user(), user('steer', 'Steered', { placement: 'steer' })]),
    ]))));
    await test.load();
    expect(test.ids()).toEqual(['u0', 'steer', 'u5']);
    expect(test.metadata.items().map((item) => item.label)).toEqual(['Repeated question', 'Steered', 'Repeated question']);
    expect(test.metadata.items().every((item) => Object.keys(item).sort().join(',') === 'id,label')).toBe(true);
    expect(test.native).toHaveBeenCalledOnce(); expect(test.storage).not.toHaveBeenCalled();
  });
  it('includes only user, explicit skills and plugin commands; never cron, goal, hooks or tool bodies', async () => {
    const origins = [{ kind: 'user' }, { kind: 'skill', name: 'explain' },
      { kind: 'plugin_command', plugin_id: 'demo', command: 'run' },
      ...['cron', 'goal', 'hook', 'retry', 'system', 'unknown'].map((kind) => ({ kind }))];
    const items = origins.map((origin, i) => user('u' + i, 'User text', { origin }));
    items.push({ type: 'tool_call', item_id: 'tool', created_at: created, input: 'Private input', output: 'Private output' });
    const test = setup(vi.fn(async () => responseFor(envelope([turn('t0', 0, items)]))));
    await test.load(); expect(test.ids()).toEqual(['u0', 'u1', 'u2']);
    expect(test.metadata.items().map((item) => item.label)).toEqual(['User text', '/explain', '/demo:run']);
    expect(JSON.stringify(test.metadata.items())).not.toMatch(/Private|"origin"|"text"|"input"|"output"/);
  });
  it('handles attachments, skill-only prompts, compact labels and malformed native identifiers', async () => {
    const items = [user('file', '', { attachments: [{ kind: 'file', file_id: 'f0' }] }),
      user('skills', '', { skills: [{ name: 'one' }, { name: 'two' }] }), user('empty', ''),
      user('long', '  A\n question '.repeat(1000)), user('', 'Bad'), null];
    const test = setup(vi.fn(async () => responseFor(envelope([turn('t0', 0, items), turn('', 1), turn('bad', '1')]))));
    await test.load(); expect(test.ids()).toEqual(['file', 'skills', 'long']);
    expect(test.metadata.items()[0].label).toBe('Attachment'); test.view.__okwLocale = { text: (zh) => zh };
    expect(test.metadata.items()[0].label).toBe('附件'); expect(test.metadata.items()[1].label).toBe('/one /two');
    expect(test.metadata.items()[2].label.length).toBeLessThanOrEqual(240);
    expect(test.metadata.items()[2].label).not.toMatch(/\n| {2}/);
  });
  it('keeps exact native DOM corrections, independent copies, listener isolation and installation identity', async () => {
    const test = setup(); const fetch = test.view.fetch; const socket = test.view.WebSocket;
    test.install(); expect(test.view.fetch).toBe(fetch); expect(test.view.WebSocket).toBe(socket);
    test.metadata.label('u0', '  Native\n label '); test.metadata.observe(() => { throw Error('observer'); });
    const listener = vi.fn(); const off = test.metadata.observe(listener); await test.load();
    expect(test.metadata.items()).toEqual([{ id: 'u0', label: 'Native label' }]);
    const copy = test.metadata.items(); copy[0].label = 'Changed'; expect(test.metadata.items()[0].label).toBe('Native label');
    listener.mockClear(); test.metadata.label('u0', 'Corrected'); test.metadata.label('u0', 'Corrected');
    test.metadata.label('unknown', 'Not another prompt'); test.metadata.label('', 'Bad'); test.metadata.label('u0', ' ');
    expect(listener).toHaveBeenCalledOnce(); off(); test.route('B'); expect(listener).toHaveBeenCalledOnce();
  });
});

describe('2.6 native history, reconnect and races', () => {
  it('merges older pages and retains the earlier prefix on an overlapping native reconnect', async () => {
    const test = setup(vi.fn().mockResolvedValueOnce(responseFor(envelope([turn('t3', 3, [user('u3')])], { has_more: true })))
      .mockResolvedValueOnce(responseFor(envelope([turn('t0', 0)], { has_more: false }))));
    await test.load(); expect(test.metadata.hasMore()).toBe(true); await test.load(path + '&before_ordinal=3');
    expect(test.ids()).toEqual(['u0', 'u3']); expect(test.metadata.hasMore()).toBe(false);
    test.emit(test.socket(), 'turns', { turns: [turn('t3', 3, [user('u3', 'Fresh label')]), turn('t4', 4, [user('u4')])],
      has_more: true });
    expect(test.ids()).toEqual(['u0', 'u3', 'u4']); expect(test.metadata.hasMore()).toBe(false);
    expect(test.metadata.items()[1].label).toBe('Fresh label'); expect(test.native).toHaveBeenCalledTimes(2);
  });
  it('replaces history when the reconnect pivot is unknown instead of guessing missing pages', async () => {
    const test = setup(); await test.load();
    test.emit(test.socket(), 'turns', { turns: [turn('new', 10, [user('new-user')])], has_more: true });
    expect(test.ids()).toEqual(['new-user']); expect(test.metadata.hasMore()).toBe(true);
  });
  it('isolates visits and keeps at most four sessions without fetching cached directories', async () => {
    const test = setup(); await test.load();
    for (const id of ['B', 'C', 'D']) { test.route(id); await test.load(path.replace('/A/', `/${id}/`)); }
    test.route('A'); expect(test.ids()).toEqual(['u0']); test.route('E'); await test.load(path.replace('/A/', '/E/'));
    test.route('B'); expect(test.ids()).toEqual([]); test.route('A', 'replaceState'); expect(test.ids()).toEqual(['u0']);
    test.route('/workspaces'); expect(test.metadata.session()).toBe(''); expect(test.metadata.hasMore()).toBe(false);
    expect(test.native).toHaveBeenCalledTimes(5); expect(test.storage).not.toHaveBeenCalled();
  });
  it('ignores delayed A/B/A responses and accepts only the immediate pre-navigation target', async () => {
    const slow = deferred();
    const test = setup(vi.fn().mockResolvedValueOnce(responseFor()).mockReturnValueOnce(slow.promise));
    await test.load(); const pending = test.view.fetch(path); test.route('B'); test.route('A');
    slow.resolve(responseFor(envelope([turn('stale', 9, [user('stale')])]))); await (await pending).json(); await flush();
    expect(test.ids()).toEqual(['u0']);
    test.native.mockResolvedValueOnce(responseFor()); const next = test.view.fetch(path.replace('/A/', '/B/'));
    test.route('B'); await (await next).json(); await flush(); expect(test.ids()).toEqual(['u0']);
  });
  it('does not parse stale text after a newer reset or revive deleted turns from an in-flight page', async () => {
    const slow = deferred(); const test = setup(vi.fn().mockReturnValueOnce(slow.promise));
    const pending = test.view.fetch(path + '&before_ordinal=3'); const socket = test.socket();
    test.emit(socket, 'turns', { turns: [turn('fresh', 3, [user('fresh')])], has_more: false });
    const parse = vi.spyOn(test.view.JSON, 'parse'); slow.resolve(responseFor());
    await (await pending).text(); await flush(); expect(parse).not.toHaveBeenCalled(); expect(test.ids()).toEqual(['fresh']);
    const late = deferred(); test.native.mockReturnValueOnce(late.promise);
    const page = test.view.fetch(path + '&before_ordinal=3');
    test.emit(socket, 'turns.removed', { turn_ids: ['fresh', 'deleted'] });
    late.resolve(responseFor(envelope([turn('deleted', 1, [user('deleted')])]))); await (await page).json(); await flush();
    expect(test.ids()).toEqual([]);
  });
});

describe('2.6 live item events and timestamps', () => {
  it('keeps headers and item identities, updates user labels and exposes precise user/end timestamps', () => {
    const test = setup(); const socket = test.socket();
    test.emit(socket, 'turn.started', { turn: turn('t0', 0, undefined, { status: 'running', ended_at: undefined }) });
    test.emit(socket, 'item.started', { turn_id: 't0', item: user() });
    test.emit(socket, 'item.started', { turn_id: 't0', item: { type: 'assistant_message', item_id: 'a0', created_at: created } });
    expect(test.metadata.time('u0')).toEqual({ role: 'user', time: Date.parse(created) });
    expect(test.metadata.time('a0')).toBeUndefined();
    test.emit(socket, 'item.ended', { turn_id: 't0', item: user('u0', 'Updated opener') });
    test.emit(socket, 'item.started', { turn_id: 't0', item: user('steer', 'Steer', { placement: 'steer' }) });
    test.emit(socket, 'turn.ended', { turn: turn() });
    expect(test.ids()).toEqual(['u0', 'steer']); expect(test.metadata.items()[0].label).toBe('Updated opener');
    expect(test.metadata.time('a0')).toEqual({ role: 'assistant', time: Date.parse(ended) });
    expect(test.metadata.time('missing')).toBeUndefined();
  });
  it('removes exact items and times, prevents late pages from overwriting newer user events', async () => {
    const test = setup(); await test.load(); const socket = test.socket(); const slow = deferred();
    test.native.mockReturnValueOnce(slow.promise); const page = test.view.fetch(path + '&before_ordinal=3');
    test.emit(socket, 'item.ended', { turn_id: 't0', item: user('u0', 'Newer native label') });
    slow.resolve(responseFor()); await (await page).json(); await flush();
    expect(test.metadata.items()[0].label).toBe('Newer native label');
    test.emit(socket, 'item.removed', { turn_id: 'wrong', item_id: 'u0' }); expect(test.ids()).toEqual(['u0']);
    test.emit(socket, 'item.removed', { turn_id: 't0', item_id: 'u0' });
    expect(test.ids()).toEqual([]); expect(test.metadata.time('u0')).toBeUndefined();
    test.emit(socket, 'item.started', { turn_id: 't0',
      item: { type: 'assistant_message', item_id: 'a0', created_at: created } });
    test.emit(socket, 'item.removed', { turn_id: 't0', item_id: 'a0' });
    expect(test.metadata.time('a0')).toBeUndefined();
  });
  it('ignores old sockets, other agents/sessions and delta streams without notifying or scanning labels', () => {
    const test = setup(); const old = test.socket(); const socket = test.socket();
    test.emit(old, 'turns', { turns: [turn()], has_more: false }); expect(test.ids()).toEqual([]);
    test.emit(socket, 'turns', { turns: [turn()], has_more: false }); test.metadata.items();
    const listener = vi.fn(); test.metadata.observe(listener); const values = vi.spyOn(test.view.Map.prototype, 'values');
    for (let i = 0; i < 100; i += 1) test.emit(socket, 'item.delta', { turn_id: 't0', item_id: 'a0', field: 'text', delta: 'a' });
    test.emit(socket, 'turn.started', { turn: turn('wrong', 1) }, { agent_id: 'side' });
    test.emit(socket, 'turn.started', { turn: turn('wrong', 1) }, { session_id: 'B' });
    expect(listener).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled(); expect(test.ids()).toEqual(['u0']);
  });
  it('preserves constructor arguments, statics and subclassing; ignores other socket origins and paths', () => {
    const test = setup(); expect(test.view.WebSocket.prototype).toBe(test.Socket.prototype);
    expect(test.view.WebSocket.OPEN).toBe(1); const socket = test.socket(undefined, ['native']);
    expect(socket.args[1]).toEqual(['native']); class SubSocket extends test.view.WebSocket {}
    expect(new SubSocket('ws://localhost/other')).toBeInstanceOf(SubSocket);
    const spy = vi.spyOn(test.view.EventTarget.prototype, 'addEventListener');
    test.socket('wss://example.org/api/v1/ws'); test.socket('ws://localhost/other'); expect(spy).not.toHaveBeenCalled();
  });
});

describe('2.6 passive reader delivery and bounded work', () => {
  it.each(['json', 'text'])('keeps the native %s promise and body, without clone or extra requests', async (method) => {
    const body = envelope(); const result = Promise.resolve(method === 'text' ? JSON.stringify(body) : body);
    const response = new Response('unused'); const reader = vi.spyOn(response, method).mockReturnValue(result);
    const clone = vi.spyOn(response, 'clone'); const pending = Promise.resolve(response); const native = vi.fn(() => pending);
    const test = setup(native); const receiver = {}; const options = { credentials: 'same-origin' };
    expect(test.view.fetch.call(receiver, path, options)).toBe(pending); expect(await pending).toBe(response);
    expect(response[method]()).toBe(result); expect(test.ids()).toEqual([]); await flush(); expect(test.ids()).toEqual(['u0']);
    expect(native.mock.contexts[0]).toBe(receiver); expect(native).toHaveBeenCalledWith(path, options);
    expect(reader.mock.contexts[0]).toBe(response); expect(clone).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledOnce();
  });
  it('does not consume unread, failed, foreign, non-main, non-GET or unrelated responses', async () => {
    const response = responseFor(); const json = response.json; const text = response.text;
    const test = setup(vi.fn(async () => response));
    for (const [url, options] of [['https://example.org' + path], [path, { method: 'POST' }],
      [path.replace('/main/', '/side/')], [path.replace('/turns', '/transcript')]]) {
      expect(await test.view.fetch(url, options)).toBe(response);
      expect(response.json).toBe(json); expect(response.text).toBe(text);
    }
    await test.view.fetch(path); await flush(); expect(response.bodyUsed).toBe(false); expect(test.ids()).toEqual([]);
  });
  it.each(['json', 'text'])('skips oversized UTF-8 %s while preserving the entire native response', async (method) => {
    const body = envelope([turn('t0', 0, [user(), { type: 'assistant_message', item_id: 'a0', text: '大'.repeat(800000) }])]);
    const test = setup(vi.fn(async () => responseFor(body))); const parse = vi.spyOn(test.view.JSON, 'parse');
    const delivered = await test.load(path, method);
    expect(method === 'text' ? delivered : delivered.data.turns[0].items[1].text).toContain('大');
    expect(test.ids()).toEqual([]); expect(parse).not.toHaveBeenCalled(); expect(test.native).toHaveBeenCalledOnce();
  });
  it('caps metadata at 2000 without retaining raw bodies, and skips huge announced responses', () => {
    const test = setup(); const socket = test.socket();
    for (let i = 0; i < 2100; i += 1) test.emit(socket, 'turn.started', { turn: turn('t' + i, i) });
    for (let i = 100; i < 2100; i += 1) test.emit(socket, 'item.started', { turn_id: 't' + i, item: user('u' + i) });
    expect(test.metadata.items()).toHaveLength(2000); expect(test.ids()[0]).toBe('u100');
    for (let i = 0; i < 2200; i += 1) test.metadata.label('extra' + i, 'x'.repeat(300));
    expect(test.metadata.items().every((item) => item.label.length <= 240)).toBe(true);
    expect(test.storage).not.toHaveBeenCalled();
  });
  it('leaves native failures and frozen responses unchanged, and isolates malformed observers', async () => {
    const failure = Error('native failure'); const frozen = Object.freeze(responseFor());
    const failed = responseFor(envelope(), { status: 403 }); const reader = failed.json;
    const test = setup(vi.fn().mockRejectedValueOnce(failure).mockImplementationOnce(() => { throw failure; })
      .mockResolvedValueOnce(frozen).mockResolvedValueOnce(failed).mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(responseFor({ code: 0, data: { turns: 'bad', has_more: false } })));
    await expect(test.view.fetch(path)).rejects.toBe(failure); expect(() => test.view.fetch(path)).toThrow(failure);
    expect(await test.view.fetch(path)).toBe(frozen); expect(await test.view.fetch(path)).toBe(failed);
    expect(failed.json).toBe(reader); expect(await test.load(path, 'text')).toBe('{');
    await test.load(); expect(test.ids()).toEqual([]);
  });
  it('supports Request, encoded sessions, invalid routes and popstate without persistent writes', async () => {
    const test = setup(); await test.load(new Request(test.location.origin + path));
    test.location.pathname = '/sessions/B'; test.view.dispatchEvent(new test.view.PopStateEvent('popstate'));
    expect(test.ids()).toEqual([]); test.location.pathname = '/sessions/A';
    test.view.dispatchEvent(new test.view.PopStateEvent('popstate')); expect(test.ids()).toEqual(['u0']);
    test.route('encoded%20id'); expect(test.metadata.session()).toBe('encoded id'); test.route('/sessions/%E0%A4');
    expect(test.metadata.session()).toBe(''); expect(test.ids()).toEqual([]); expect(test.storage).not.toHaveBeenCalled();
  });
});
