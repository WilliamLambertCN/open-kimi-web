/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('packages/launcher/src/mobile/mobileConversationTocMetadata.js'), 'utf8');
const frames = [];
const path = '/api/v1/sessions/A/transcript?agent_id=main';
const turn = (turnId = 't0', ordinal = 0, extra = {}) => ({
  kind: 'turn', turnId, ordinal, state: 'completed', origin: { kind: 'user' }, prompt: 'Repeated question', steps: [], ...extra,
});
const step = (stepId = 's0', ordinal = 0, extra = {}) => ({
  kind: 'step', stepId, ordinal, turnId: 't0', state: 'running', frames: [], ...extra,
});
const user = (frameId = 'f0', text = 'Steered question', extra = {}) => ({
  kind: 'text', frameId, role: 'user', text, ...extra,
});
const envelope = (items = [turn()], extra = {}) => ({ code: 0, data: { agent_id: 'main', items, has_more: false, ...extra } });
const responseFor = (body = envelope(), extra) => new Response(JSON.stringify(body), extra);
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 3; i += 1) { await Promise.resolve(); await vi.advanceTimersByTimeAsync(1); }
};
function setup(native = vi.fn(async () => responseFor())) {
  vi.useFakeTimers();
  const iframe = document.createElement('iframe'); document.body.append(iframe); frames.push(iframe);
  const view = iframe.contentWindow;
  const location = { origin: window.location.origin, href: `${window.location.origin}/sessions/A`, pathname: '/sessions/A' };
  for (const method of ['pushState', 'replaceState']) view.history[method] = (state, title, value) => {
    const next = new URL(value, location.href); location.pathname = next.pathname; location.href = next.href;
    return state;
  };
  class Socket extends view.EventTarget {
    static OPEN = 1;
    constructor(...args) { super(); this.args = args; }
    send() {}
  }
  view.WebSocket = Socket; view.Request = Request; view.Response = Response; view.fetch = native;
  view.__fixtureLocation = location;
  const storage = vi.spyOn(view.Storage.prototype, 'setItem');
  const install = () => view.eval(`(() => { const location = window.__fixtureLocation; ${source}\n })()`);
  install();
  const metadata = view.__okwMobileTocMetadata;
  const load = async (url = path, method = 'json', options) => {
    const response = await view.fetch(url, options);
    const body = await response[method](); await flush(); return body;
  };
  const emit = (socket, type, payload, extra = {}) => socket.dispatchEvent(new view.MessageEvent('message', {
    data: JSON.stringify({ type, session_id: 'A', payload: { agent_id: 'main', ...payload }, ...extra }),
  }));
  return { view, metadata, native, Socket, location, storage, load, install, emit,
    route: (id, method = 'pushState') => view.history[method](null, '', id.startsWith('/') ? id : `/sessions/${id}`),
    socket: (url = `${location.origin.replace(/^http/, 'ws')}/api/v1/ws`, protocols) => new view.WebSocket(url, protocols),
    ids: () => metadata.items().map((item) => item.id),
  };
}
afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove()); vi.restoreAllMocks(); vi.useRealTimers();
});

describe('passive native transcript metadata', () => {
  it('uses exact turn opening and user steer IDs, keeps duplicate labels and sorts by official ordinals', async () => {
    const body = envelope([turn('later', 5), turn('t0', 0, { steps: [step('second', 2, { frames: [user('f2')] }),
      step('first', 1, { frames: [{ kind: 'text', frameId: 'reply', role: 'assistant', text: 'Assistant only' }, user()] })] })]);
    const test = setup(vi.fn(async () => responseFor(body)));
    await test.load();
    expect(test.ids()).toEqual(['t0:input', 'f0', 'f2', 'later:input']);
    expect(test.metadata.items().filter((item) => item.label === 'Repeated question')).toHaveLength(2);
    expect(test.metadata.items().every((item) => Object.keys(item).sort().join(',') === 'id,label')).toBe(true);
    expect(test.native).toHaveBeenCalledTimes(1); expect(test.storage).not.toHaveBeenCalled();
  });
  it('normalizes origin payloads and uses the user and explicit slash whitelist only', async () => {
    const allowed = [undefined, { kind: 'user' }, { kind: 'user', payload: { kind: 'user' } },
      { kind: 'other', payload: { kind: 'skill_activation', trigger: 'user-slash', skillName: 'explain' } },
      { kind: 'other', payload: { kind: 'plugin_command', trigger: 'user-slash', pluginId: 'demo', commandName: 'run' } }];
    const denied = [{ kind: 'cron' }, { kind: 'task', taskId: 'task' }, { kind: 'hook' }, { kind: 'system_trigger' },
      { kind: 'skill_activation', trigger: 'auto', skillName: 'hidden' }, { kind: 'plugin_command', trigger: 'auto' },
      { kind: 'user', payload: { kind: 'injection' } }, { kind: '' }, { kind: 'user', payload: { taskId: 'hidden' } }];
    const items = [...allowed, ...denied].map((origin, i) => turn(`t${i}`, i, { origin }));
    items.push(turn('task', 100, { taskId: 'hidden' }));
    const test = setup(vi.fn(async () => responseFor(envelope(items)))); await test.load();
    expect(test.ids()).toEqual(allowed.map((_, i) => `t${i}:input`));
    expect(test.metadata.items().slice(-2).map((item) => item.label)).toEqual(['/explain', '/demo:run']);
  });
  it('filters automated, assistant and tool frames without retaining raw prompt or tool payloads', async () => {
    const question = '  A\n question '.repeat(1000);
    const item = turn('t0', 0, { prompt: question, steps: [step('s0', 0, { frames: [user(),
      user('task', 'Hidden', { taskId: 'task' }), user('cron', 'Hidden', { origin: { kind: 'cron_job' } }),
      { kind: 'text', role: 'assistant', frameId: 'assistant', text: 'Assistant private body' },
      { kind: 'tool', frameId: 'tool', input: { prompt: 'Tool private input' }, output: 'Tool private output' },
    ] })] });
    const test = setup(vi.fn(async () => responseFor(envelope([item])))); await test.load();
    expect(test.ids()).toEqual(['t0:input', 'f0']);
    expect(test.metadata.items()[0].label.length).toBeLessThanOrEqual(240);
    expect(test.metadata.items()[0].label).not.toMatch(/\n| {2}/);
    expect(JSON.stringify(test.metadata.items())).not.toMatch(/private|prompt|steps|frames/);
    item.prompt = 'Mutated caller object'; expect(test.metadata.items()[0].label).not.toBe(item.prompt);
  });
  it('supports attachment-only messages and bundled skill summaries but ignores empty or malformed identities', async () => {
    const test = setup(vi.fn(async () => responseFor(envelope([
      turn('file', 0, { prompt: '', attachmentIds: ['file-id'] }),
      turn('skill', 1, { origin: { kind: 'user', payload: { kind: 'user', skillActivations: [
        { skillName: 'one' }, { skillName: 'two' }, { skillName: null },
      ] } } }), turn('', 2), turn('empty', 3, { prompt: '' }), turn('bad', '4'),
    ]))));
    await test.load(); expect(test.metadata.items()).toEqual([
      { id: 'file:input', label: 'Attachment' }, { id: 'skill:input', label: '/one /two' },
    ]);
    test.view.__okwLocale = { text: (zh) => zh };
    expect(test.metadata.items()[0].label).toBe('附件');
    test.view.__okwLocale.text = (zh, en) => en;
    expect(test.metadata.items()[0].label).toBe('Attachment');
    expect(test.native).toHaveBeenCalledOnce();
  });
  it('returns independent copies and accepts idempotent exact DOM label corrections before or after metadata', async () => {
    const test = setup(); const listener = vi.fn(); test.metadata.observe(listener);
    test.metadata.label('t0:input', '  Native\n visible label  '); await test.load();
    expect(test.metadata.items()).toEqual([{ id: 't0:input', label: 'Native visible label' }]);
    const copy = test.metadata.items(); copy[0].label = 'Changed'; copy.length = 0;
    expect(test.metadata.items()).toHaveLength(1);
    listener.mockClear(); test.metadata.label('t0:input', 'Corrected label');
    expect(listener).toHaveBeenCalledOnce(); test.metadata.label('t0:input', 'Corrected label');
    test.metadata.label('unknown', 'Not another message'); test.metadata.label('t0:input', '   ');
    expect(listener).toHaveBeenCalledOnce(); expect(test.ids()).toEqual(['t0:input']);
    expect(test.metadata.items()[0].label).toBe('Corrected label');
  });
});

describe('native page merging and four-session cache', () => {
  it('replaces whole pages, merges before/after and changes hasMore only at the older boundary', async () => {
    const native = vi.fn().mockResolvedValueOnce(responseFor(envelope([turn('current', 3)], { has_more: true })))
      .mockResolvedValueOnce(responseFor(envelope([turn('older', 1)], { has_more: false })))
      .mockResolvedValueOnce(responseFor(envelope([turn('newer', 5)], { has_more: true })))
      .mockResolvedValueOnce(responseFor(envelope([turn('replacement', 9)])));
    const test = setup(native); await test.load(); expect(test.metadata.hasMore()).toBe(true);
    await test.load(`${path}&before_turn=current`); expect(test.metadata.hasMore()).toBe(false);
    await test.load(`${path}&after_turn=current`); expect(test.ids()).toEqual(['older:input', 'current:input', 'newer:input']);
    expect(test.metadata.hasMore()).toBe(false); await test.load(); expect(test.ids()).toEqual(['replacement:input']);
    expect(native).toHaveBeenCalledTimes(4);
  });
  it('restores cached directories without fetching, isolates identical IDs and clears non-session state', async () => {
    const test = setup(vi.fn(async (url) => responseFor(envelope([turn('same', 0, {
      prompt: String(url).includes('/A/') ? 'A label' : 'B label',
    })], { has_more: String(url).includes('/A/') }))));
    await test.load(); test.metadata.label('same:input', 'A DOM label'); test.route('B');
    expect(test.ids()).toEqual([]); await test.load(path.replace('/A/', '/B/'));
    expect(test.metadata.items()[0].label).toBe('B label'); test.route('A');
    expect(test.metadata.items()[0].label).toBe('A DOM label'); expect(test.metadata.hasMore()).toBe(true);
    test.route('/workspaces'); expect(test.metadata.session()).toBe(''); expect(test.ids()).toEqual([]);
    expect(test.metadata.hasMore()).toBe(false); test.route('B', 'replaceState');
    expect(test.metadata.items()[0].label).toBe('B label'); expect(test.native).toHaveBeenCalledTimes(2);
  });
  it('evicts only the least recently visited fifth session and never stores directory data persistently', async () => {
    const test = setup(); await test.load();
    for (const id of ['B', 'C', 'D']) { test.route(id); await test.load(path.replace('/A/', `/${id}/`)); }
    test.route('A'); expect(test.ids()).toEqual(['t0:input']); test.route('E');
    await test.load(path.replace('/A/', '/E/')); test.route('A'); expect(test.ids()).toEqual(['t0:input']);
    test.route('B'); expect(test.ids()).toEqual([]); expect(test.native).toHaveBeenCalledTimes(5);
    expect(test.storage).not.toHaveBeenCalled();
  });
  it('rejects delayed responses across A/B/A while retaining the known A cache', async () => {
    const slow = deferred(); const native = vi.fn().mockResolvedValueOnce(responseFor())
      .mockReturnValueOnce(slow.promise); const test = setup(native); await test.load();
    const pending = test.view.fetch(path); test.route('B'); test.route('A');
    slow.resolve(responseFor(envelope([turn('stale', 10)]))); await (await pending).json(); await flush();
    expect(test.ids()).toEqual(['t0:input']);
  });
  it('accepts pre-navigation fetch only for the immediate target visit', async () => {
    const slow = deferred(); const test = setup(vi.fn(() => slow.promise));
    const pending = test.view.fetch(path.replace('/A/', '/B/')); test.route('B');
    slow.resolve(responseFor()); await (await pending).json(); await flush(); expect(test.ids()).toEqual(['t0:input']);
  });
  it('discards old whole pages and pre-reset history without reparsing stale text', async () => {
    const slow = deferred(); const test = setup(vi.fn().mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(responseFor(envelope([turn('fresh', 5)]))));
    const pending = test.view.fetch(`${path}&before_turn=old`); await test.load();
    const parse = vi.spyOn(test.view.JSON, 'parse'); slow.resolve(responseFor());
    await (await pending).text(); await flush(); expect(test.ids()).toEqual(['fresh:input']);
    expect(parse).not.toHaveBeenCalled();
  });
  it('does not resurrect removed turns or overwrite a changed steer when an older native page arrives last', async () => {
    const slow = deferred(); const item = turn('t0', 0, { steps: [step('s0', 0, { frames: [user()] })] });
    const test = setup(vi.fn().mockResolvedValueOnce(responseFor(envelope([item]))).mockReturnValueOnce(slow.promise));
    await test.load(); const pending = test.view.fetch(`${path}&before_turn=t0`); const socket = test.socket();
    test.emit(socket, 'transcript.ops', { seq: 1, ops: [
      { op: 'frame.upsert', turnId: 't0', stepId: 's0', frame: user('f0', 'Changed steer') },
      { op: 'items.remove', ids: ['removed'] },
    ] });
    slow.resolve(responseFor(envelope([item, turn('removed', 1)]))); await (await pending).json(); await flush();
    expect(test.ids()).toEqual(['t0:input', 'f0']);
    expect(test.metadata.items()[1].label).toBe('Changed steer');
  });
  it('keeps newer same-session snapshots when an earlier whole-page request completes last', async () => {
    const slow = deferred(); const test = setup(vi.fn().mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(responseFor(envelope([turn('fresh', 5)]))));
    const pending = test.view.fetch(path); await test.load();
    slow.resolve(responseFor()); await (await pending).json(); await flush(); expect(test.ids()).toEqual(['fresh:input']);
  });
});

describe('official WebSocket and catch-up operations', () => {
  it('keeps native prototype/statics, constructor arguments, subclassing and other origins untouched', () => {
    const test = setup(); expect(test.view.WebSocket.prototype).toBe(test.Socket.prototype);
    expect(test.view.WebSocket.OPEN).toBe(1); const socket = test.socket(undefined, ['native-protocol']);
    expect(socket).toBeInstanceOf(test.Socket); expect(socket.args[1]).toEqual(['native-protocol']);
    class SubSocket extends test.view.WebSocket {}
    expect(new SubSocket('ws://localhost/api/v1/ws')).toBeInstanceOf(SubSocket);
    const spy = vi.spyOn(test.view.EventTarget.prototype, 'addEventListener');
    test.socket('wss://other.example/api/v1/ws'); test.socket('ws://localhost/other');
    expect(spy).not.toHaveBeenCalled();
  });
  it('applies reset and turn/step header upserts, orders steer frames and retains them on later headers', async () => {
    const test = setup(); const socket = test.socket();
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn()], hasMoreOlder: true }, has_more_older: true, seq: 10 });
    expect(test.metadata.hasMore()).toBe(true);
    const ops = [{ op: 'step.upsert', turnId: 't0', step: step('second', 2) },
      { op: 'frame.upsert', turnId: 't0', stepId: 'second', frame: user('second-frame') },
      { op: 'step.upsert', turnId: 't0', step: step('first', 1) },
      { op: 'frame.upsert', turnId: 't0', stepId: 'first', frame: user('first-frame') },
      { op: 'turn.upsert', turn: turn('t0', 0, { state: 'running', steps: undefined }) }];
    test.emit(socket, 'transcript.ops', { ops, seq: 11 });
    expect(test.ids()).toEqual(['t0:input', 'first-frame', 'second-frame']);
    test.emit(socket, 'transcript.ops', { seq: 12, ops: [{ op: 'step.upsert', turnId: 't0', step: step('second', 0) }] });
    expect(test.ids()).toEqual(['t0:input', 'second-frame', 'first-frame']); await flush();
  });
  it('handles native catch-up batches whose agent_id is only on data, including reset and items.remove', async () => {
    const catchup = { data: { agent_id: 'main', complete: true, latest_seq: 3, batches: [
      { seq: 1, ops: [{ op: 'reset', agentId: 'main', snapshot: { items: [turn()], hasMoreOlder: true } }] },
      { seq: 2, ops: [{ op: 'turn.upsert', turn: turn('next', 1) }] },
      { seq: 3, ops: [{ op: 'items.remove', ids: ['t0'] }] },
    ] } };
    const test = setup(vi.fn(async () => responseFor(catchup))); await test.load(`${path.replace('?', '/ops?')}&since_seq=0`);
    expect(test.ids()).toEqual(['next:input']); expect(test.metadata.hasMore()).toBe(true);
  });
  it('does not lose a known sequence after a reset op without seq and does not invent gaps', () => {
    const test = setup(); const socket = test.socket();
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn()] }, seq: 10 });
    test.emit(socket, 'transcript.ops', { ops: [{ op: 'reset', agentId: 'main', snapshot: { items: [turn('reset', 1)] } }] });
    test.emit(socket, 'transcript.ops', { seq: 9, ops: [{ op: 'turn.upsert', turn: turn('stale', 1) }] });
    expect(test.ids()).toEqual(['reset:input']);
    test.emit(socket, 'transcript.ops', { seq: 15, ops: [{ op: 'turn.upsert', turn: turn('later', 2) }] });
    expect(test.ids()).toEqual(['reset:input', 'later:input']);
  });
});

describe('incremental transcript safety', () => {
  it('removes only exact native item IDs and drops user frames replaced with non-user content', () => {
    const test = setup(); const socket = test.socket();
    const item = turn('t0', 0, { steps: [step('s0', 0, { frames: [user()] })] });
    test.emit(socket, 'transcript.reset', { snapshot: { items: [item] } });
    test.emit(socket, 'transcript.ops', { ops: [{ op: 'items.remove', ids: ['f0'] }] });
    expect(test.ids()).toEqual(['t0:input', 'f0']);
    test.emit(socket, 'transcript.ops', { ops: [{ op: 'frame.upsert', turnId: 't0', stepId: 's0',
      frame: { kind: 'text', frameId: 'f0', role: 'assistant', text: 'Not a question' } }] });
    expect(test.ids()).toEqual(['t0:input']);
    test.emit(socket, 'transcript.ops', { ops: [{ op: 'items.remove', ids: ['t0'] }] }); expect(test.ids()).toEqual([]);
  });
  it('ignores duplicate/older/invalid sequences, wrong session/agent, incomplete catch-up and unknown operations', async () => {
    const test = setup(vi.fn(async () => responseFor({ data: { agent_id: 'main', complete: false,
      batches: [{ seq: 99, ops: [{ op: 'turn.upsert', turn: turn('incomplete', 2) }] }] } })));
    const socket = test.socket(); test.emit(socket, 'transcript.reset', { snapshot: { items: [turn()] }, seq: 5 });
    const upsert = [{ op: 'turn.upsert', turn: turn('bad', 2) }];
    for (const seq of [4, 5, '6', -1]) test.emit(socket, 'transcript.ops', { ops: upsert, seq });
    test.emit(socket, 'transcript.ops', { ops: upsert, seq: 7 }, { session_id: 'B' });
    test.emit(socket, 'transcript.ops', { ops: upsert, seq: 7, agent_id: 'side' });
    test.emit(socket, 'transcript.ops', { seq: 6, ops: [{ op: 'unknown', turn: turn('bad', 2) },
      { op: 'frame.upsert', turnId: 'unknown', stepId: 'unknown', frame: user('bad') }] });
    await test.load(path.replace('?', '/ops?')); expect(test.ids()).toEqual(['t0:input']);
  });
  it('accepts a new epoch reset at a lower sequence but rejects older same-epoch resets', () => {
    const test = setup(); const socket = test.socket();
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn()] }, seq: 9 }, { epoch: 'one' });
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn('stale', 1)] }, seq: 8 }, { epoch: 'one' });
    expect(test.ids()).toEqual(['t0:input']);
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn('fresh', 1)] }, seq: 1 }, { epoch: 'two' });
    expect(test.ids()).toEqual(['fresh:input']);
  });
  it('never notifies or rescans entries on assistant/tool append and unrelated metadata streams', () => {
    const test = setup(); const socket = test.socket();
    test.emit(socket, 'transcript.reset', { snapshot: { items: [turn()] }, seq: 0 }); test.metadata.items();
    const listener = vi.fn(); test.metadata.observe(listener);
    const values = vi.spyOn(test.view.Map.prototype, 'values');
    for (let seq = 1; seq <= 100; seq += 1) test.emit(socket, 'transcript.ops', { seq, ops: [
      { op: 'append', target: { type: 'frame', turnId: 't0', stepId: 's0', frameId: 'assistant' }, offset: seq, text: 'delta' },
      { op: 'frame.upsert', turnId: 't0', stepId: 's0', frame: { kind: 'tool', frameId: 'tool', output: 'tool delta' } },
      { op: 'meta.merge', meta: { activity: 'turn' } },
    ] });
    expect(listener).not.toHaveBeenCalled(); expect(values).not.toHaveBeenCalled();
  });
});

describe('reader identity, bounded work and observer failure isolation', () => {
  it.each(['json', 'text'])('keeps native promises, receiver/arguments and original %s result without clone', async (method) => {
    const body = envelope(); const raw = JSON.stringify(body); const response = new Response('unused');
    const readerPromise = Promise.resolve(method === 'json' ? body : raw);
    const reader = vi.spyOn(response, method).mockReturnValue(readerPromise); const clone = vi.spyOn(response, 'clone');
    const fetchPromise = Promise.resolve(response); const native = vi.fn(() => fetchPromise); const test = setup(native);
    const parse = vi.spyOn(test.view.JSON, 'parse'); const receiver = {}; const options = { credentials: 'same-origin' };
    expect(test.view.fetch.call(receiver, path, options)).toBe(fetchPromise);
    const returned = await fetchPromise; expect(returned).toBe(response);
    const delivered = returned[method](); expect(delivered).toBe(readerPromise);
    expect(await delivered).toBe(await readerPromise);
    expect(native.mock.contexts[0]).toBe(receiver); expect(native).toHaveBeenCalledWith(path, options);
    expect(reader.mock.contexts[0]).toBe(response); expect(test.ids()).toEqual([]); await flush();
    expect(test.ids()).toEqual(['t0:input']); expect(clone).not.toHaveBeenCalled(); expect(reader).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledTimes(method === 'text' ? 1 : 0);
  });
  it('never consumes an unread response and skips non-GET, cross-origin, non-main or unrelated paths', async () => {
    const response = responseFor(); const json = response.json; const text = response.text;
    const test = setup(vi.fn(async () => response));
    for (const [url, options] of [['https://example.org' + path], [path, { method: 'POST' }],
      [path.replace('main', 'side')], [path.replace('?agent_id=main', '')], ['/api/v1/sessions/A/messages']]) {
      expect(await test.view.fetch(url, options)).toBe(response);
      expect(response.json).toBe(json); expect(response.text).toBe(text);
    }
    await test.view.fetch(path); await flush(); expect(response.bodyUsed).toBe(false); expect(test.ids()).toEqual([]);
  });
  it.each(['json', 'text'])('skips oversized %s including UTF-8 text without truncating native delivery', async (method) => {
    const body = envelope([turn('t0', 0, { steps: [step('s0', 0, { frames: [
      { kind: 'text', frameId: 'assistant', role: 'assistant', text: '大'.repeat(800000) },
    ] })] })]);
    const test = setup(vi.fn(async () => responseFor(body))); const parse = vi.spyOn(test.view.JSON, 'parse');
    const returned = await test.load(path, method);
    expect(method === 'text' ? returned : returned.data.items[0].steps[0].frames[0].text).toContain('大');
    expect(test.ids()).toEqual([]); expect(parse).not.toHaveBeenCalled(); test.metadata.label('t0:input', 'Visible only');
    expect(test.ids()).toEqual([]); expect(test.native).toHaveBeenCalledOnce();
  });
  it('caps directory and labels and ignores oversized announced content without touching readers', async () => {
    const many = Array.from({ length: 2100 }, (_, i) => turn(`t${i}`, i, { steps: undefined }));
    const oversized = responseFor(envelope(), { headers: { 'content-length': String(3 * 1024 * 1024) } });
    const reader = oversized.json; const test = setup(vi.fn().mockResolvedValueOnce(responseFor(envelope(many)))
      .mockResolvedValueOnce(oversized));
    await test.load(); expect(test.metadata.items()).toHaveLength(2000); expect(test.ids()[0]).toBe('t100:input');
    expect(await test.view.fetch(path)).toBe(oversized); expect(oversized.json).toBe(reader);
    for (let i = 0; i < 2200; i += 1) test.metadata.label(`unknown-${i}`, 'x'.repeat(2000));
    expect(test.metadata.items().every((item) => item.label.length <= 240)).toBe(true);
  });
  it('keeps rejected/synchronous native fetch and readers, HTTP failures and frozen responses unchanged', async () => {
    const failure = new Error('native failure'); const rejected = responseFor();
    vi.spyOn(rejected, 'json').mockRejectedValue(failure); const frozen = Object.freeze(responseFor());
    const failed = responseFor(envelope(), { status: 403 }); const failedReader = failed.json;
    const test = setup(vi.fn().mockRejectedValueOnce(failure).mockImplementationOnce(() => { throw failure; })
      .mockResolvedValueOnce(rejected).mockResolvedValueOnce(frozen).mockResolvedValueOnce(failed));
    await expect(test.view.fetch(path)).rejects.toBe(failure); expect(() => test.view.fetch(path)).toThrow(failure);
    await expect((await test.view.fetch(path)).json()).rejects.toBe(failure);
    expect(await test.view.fetch(path)).toBe(frozen); expect(await test.view.fetch(path)).toBe(failed);
    expect(failed.json).toBe(failedReader); await flush(); expect(test.ids()).toEqual([]);
  });
  it('isolates throwing listeners, malformed metadata and malformed text from native delivery', async () => {
    const malformed = { code: 0, data: { agent_id: 'main', items: [turn('bad', 0, { steps: 'malformed' })] } };
    const test = setup(vi.fn().mockResolvedValueOnce(responseFor()).mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(responseFor(malformed)));
    test.metadata.observe(() => { throw new Error('observer failed'); }); const listener = vi.fn();
    const off = test.metadata.observe(listener); await test.load(); expect(listener).toHaveBeenCalledOnce(); off();
    expect(await test.load(path, 'text')).toBe('{'); expect(await test.load()).toEqual(malformed);
    test.route('B'); expect(listener).toHaveBeenCalledOnce();
  });
  it('reuses installation and recognizes Request objects, popstate and exact encoded session paths', async () => {
    const test = setup(); const fetch = test.view.fetch; const history = test.view.history.pushState;
    test.install(); expect(test.view.fetch).toBe(fetch); expect(test.view.history.pushState).toBe(history);
    await test.load(new Request(`${test.location.origin}${path}`));
    test.location.pathname = '/sessions/B'; test.view.dispatchEvent(new test.view.PopStateEvent('popstate'));
    expect(test.ids()).toEqual([]); test.location.pathname = '/sessions/A';
    test.view.dispatchEvent(new test.view.PopStateEvent('popstate')); expect(test.ids()).toEqual(['t0:input']);
    test.route('encoded%20id'); expect(test.metadata.session()).toBe('encoded id');
    test.route('/sessions/%E0%A4'); expect(test.metadata.session()).toBe(''); expect(test.ids()).toEqual([]);
  });
});
